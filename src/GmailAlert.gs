/**
 * Canal de notificacao pelo proprio Gmail (WA_PROVIDER=gmail): sem app extra, sem numero, sem custo.
 *
 * Para cada aviso, o agente cria no seu Gmail uma mensagem curta com o resumo da IA
 * (Gmail API users.messages.import), com o marcador "Avisos" e fora da caixa de entrada.
 * No app do Gmail do celular voce liga a notificacao so desse marcador e desliga a da
 * caixa de entrada: o celular so toca quando o agente decide que vale a pena.
 *
 * Por que criar uma mensagem nova em vez de so marcar o e-mail original? Notificacao do
 * Gmail e disparada por mensagem que chega; um marcador colocado depois da chegada nao
 * garante notificacao. A mensagem importada chega como um e-mail novo.
 *
 * Requer a Gmail API ligada no projeto: no editor, Servicos > + > Gmail API > Adicionar.
 */

var GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
var GMAIL_ALERT_FROM = 'agente@agente-de-emails.invalid'; // dominio reservado: nunca recebe resposta

function isGmailChannel_() {
  return cfg('WA_PROVIDER') === 'gmail';
}

/** Aviso de e-mail: remetente original no nome, resumo da IA no assunto, link para o e-mail. */
function gmailNotify_(n) {
  var body = [
    (CATEGORY_LABEL[n.category] || CATEGORY_LABEL.outro) + ': ' + oneLine_(n.summary, 200),
    'De: ' + oneLine_(n.fromName, 80) + (n.fromEmail ? ' <' + n.fromEmail + '>' : ''),
    n.deadline ? 'Prazo: ' + oneLine_(n.deadline, 40) : '',
    n.subject ? 'Assunto original: ' + oneLine_(n.subject, 200) : '',
    n.threadId ? '\nAbrir o e-mail: https://mail.google.com/mail/u/0/#all/' + n.threadId : ''
  ].filter(Boolean).join('\n');
  return gmailImport_({
    fromName: oneLine_(n.fromName, 60) + ' (Agente)',
    subject: oneLine_(n.summary, 150),
    body: body,
    labels: [cfg('LABEL_ALERTS')],
    inbox: false
  });
}

/** Texto livre (resumo diario, alertas do agente): vai para a caixa de entrada, sem o marcador que toca. */
function gmailText_(text) {
  var clean = String(text).replace(/\*/g, '');
  return gmailImport_({
    fromName: 'Agente de Emails',
    subject: oneLine_(clean.split('\n')[0], 120),
    body: clean,
    labels: [],
    inbox: true
  });
}

function gmailImport_(m) {
  var mime = [
    'From: ' + mimeWord_(m.fromName, true) + ' <' + GMAIL_ALERT_FROM + '>',
    'To: ' + Session.getEffectiveUser().getEmail(),
    'Subject: ' + mimeWord_(m.subject),
    'Date: ' + new Date().toUTCString(),
    'Message-ID: <' + Utilities.getUuid() + '@agente-de-emails.invalid>',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Utilities.base64Encode(m.body, Utilities.Charset.UTF_8)
  ].join('\r\n');
  var labelIds = ['UNREAD'];
  if (m.inbox) labelIds.push('INBOX');
  try {
    m.labels.forEach(function (name) { if (name) labelIds.push(gmailLabelId_(name)); });
    var resp = gmailApi_('post', '/messages/import?neverMarkSpam=true&internalDateSource=receivedTime', {
      raw: Utilities.base64EncodeWebSafe(mime, Utilities.Charset.UTF_8),
      labelIds: labelIds
    });
    if (resp.code === 200) return { ok: true, id: resp.json.id || 'gmail' };
    return { ok: false, error: 'Gmail HTTP ' + resp.code + ' ' + resp.text.slice(0, 200) };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** Id do marcador na Gmail API (o GmailApp nao expoe). Cria se nao existir; guarda em cache. */
function gmailLabelId_(name) {
  var cache = getJsonState('GMAIL_LABEL_IDS', {});
  if (cache[name]) return cache[name];
  var list = gmailApi_('get', '/labels');
  if (list.code !== 200) throw new Error('Gmail labels HTTP ' + list.code + ' ' + list.text.slice(0, 200));
  var found = (list.json.labels || []).filter(function (l) { return l.name === name; })[0];
  if (!found) {
    var created = gmailApi_('post', '/labels', { name: name, labelListVisibility: 'labelShow', messageListVisibility: 'show' });
    if (created.code !== 200) throw new Error('Gmail criar marcador HTTP ' + created.code + ' ' + created.text.slice(0, 200));
    found = created.json;
  }
  cache[name] = found.id;
  setJsonState('GMAIL_LABEL_IDS', cache);
  return found.id;
}

function gmailApi_(method, path, body) {
  var params = { method: method, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true };
  if (body) {
    params.contentType = 'application/json';
    params.payload = JSON.stringify(body);
  }
  var resp = UrlFetchApp.fetch(GMAIL_API + path, params);
  var text = String(resp.getContentText() || '');
  var json = {};
  try { json = JSON.parse(text); } catch (e) { /* corpo nao-JSON */ }
  return { code: resp.getResponseCode(), text: text, json: json };
}

/** Texto de cabecalho: acento/emoji vira RFC 2047; nome de remetente ASCII vai entre aspas (ponto e parenteses). */
function mimeWord_(s, isName) {
  s = String(s || '').replace(/[\r\n]+/g, ' ');
  if (!/^[\x20-\x7e]*$/.test(s)) return '=?UTF-8?B?' + Utilities.base64Encode(s, Utilities.Charset.UTF_8) + '?=';
  return isName ? '"' + s.replace(/["\\]/g, '') + '"' : s;
}

/** Manda um aviso de teste pelo canal Gmail (rode pelo editor; e a unica funcao publica deste arquivo). */
function testGmailAlert() {
  var hhmm = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'HH:mm');
  var res = gmailNotify_({ fromName: 'Agente de Emails', summary: 'Teste das ' + hhmm + ': se tocou com som, esta tudo certo', deadline: '', category: 'outro' });
  console.log(JSON.stringify(res));
}
