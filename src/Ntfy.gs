/**
 * Canal de notificacao alternativo: ntfy (https://ntfy.sh), app gratuito de notificacoes push.
 *
 * Sem conta e sem numero de telefone: o agente publica num "topico" (um nome secreto)
 * e o app ntfy no celular, inscrito nesse topico, mostra a notificacao na hora.
 * Ative com WA_PROVIDER=ntfy e NTFY_TOPIC=<nome secreto>. Opcionais: NTFY_SERVER, NTFY_TOKEN.
 *
 * Quem souber o nome do topico consegue ler as mensagens: use um nome longo e aleatorio.
 */

var NTFY_PRIORITY = { processo_seletivo: 4, nota: 4, seguranca: 4, academico: 3, pessoal: 3, financeiro: 3, outro: 3, ruido: 2 };
var NTFY_TAG = {
  processo_seletivo: 'briefcase', nota: 'memo', academico: 'mortar_board', pessoal: 'bust_in_silhouette',
  financeiro: 'credit_card', seguranca: 'lock', outro: 'email', ruido: 'email'
};

function isNtfy_() {
  return cfg('WA_PROVIDER') === 'ntfy';
}

/** Aviso de e-mail: o resumo vira o titulo; remetente e prazo vao no corpo; tocar abre o Gmail. */
function ntfyNotify_(n) {
  var body = 'De: ' + oneLine_(n.fromName, 80) + (n.deadline ? '\nPrazo: ' + oneLine_(n.deadline, 40) : '');
  return ntfySend_({
    title: oneLine_(n.summary, 150),
    message: body,
    priority: NTFY_PRIORITY[n.category] || 3,
    tags: [NTFY_TAG[n.category] || 'email'],
    click: n.threadId ? 'https://mail.google.com/mail/u/0/#inbox/' + n.threadId : ''
  });
}

/** Texto livre (resumo diario, alertas do agente). Tira o *negrito* do WhatsApp. */
function ntfyText_(text) {
  return ntfySend_({ title: 'Agente de Emails', message: String(text).replace(/\*/g, ''), priority: 3, tags: ['robot'] });
}

/** Publica em JSON na raiz do servidor (evita problema de acento/emoji em cabecalho HTTP). */
function ntfySend_(msg) {
  var server = String(cfg('NTFY_SERVER') || 'https://ntfy.sh').replace(/\/+$/, '');
  var payload = {
    topic: requireCfg('NTFY_TOPIC'),
    title: msg.title,
    message: String(msg.message || ' ').slice(0, 3500),
    priority: msg.priority || 3,
    tags: msg.tags || []
  };
  if (msg.click) payload.click = msg.click;
  var params = { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true };
  if (cfg('NTFY_TOKEN')) params.headers = { Authorization: 'Bearer ' + cfg('NTFY_TOKEN') };
  for (var attempt = 0; attempt < 2; attempt++) {
    try {
      var resp = UrlFetchApp.fetch(server, params);
      var code = resp.getResponseCode();
      if (code === 200) {
        var json = {};
        try { json = JSON.parse(resp.getContentText()); } catch (e) { /* ok mesmo assim */ }
        return { ok: true, id: json.id || 'ntfy' };
      }
      if (code !== 429 || attempt === 1) {
        return { ok: false, error: 'ntfy HTTP ' + code + ' ' + String(resp.getContentText()).slice(0, 200) };
      }
      Utilities.sleep(3000); // limite de taxa: espera e tenta mais uma vez
    } catch (e) {
      if (attempt === 1) return { ok: false, error: String(e) };
    }
  }
  return { ok: false, error: 'ntfy: falha desconhecida' };
}
