/**
 * Instalacao e testes. Rode pelo editor do Apps Script (selecione a funcao e clique em Executar).
 *
 *   setup()          valida a configuracao, cria planilha de log, marcador e gatilhos
 *   testWhatsApp()   manda uma mensagem de teste (template)
 *   testGroq()       classifica e-mails de exemplo (nao usa seus e-mails)
 *   dryRunLast24h()  simula o agente nas ultimas 24h e grava na aba "Simulacao" (nao envia nada)
 *   showStatus()     mostra o estado atual no registro de execucao
 *   uninstall()      remove os gatilhos (o agente para)
 *   senderReport()   levanta quem te manda e-mail e quanto voce le (aba "Remetentes")
 *   simulateSenders() testa a IA nos e-mails reais de alguns remetentes (aba "Teste remetentes")
 */

function requiredProps_() {
  var p = cfg('WA_PROVIDER');
  if (p === 'greenapi') return ['GREEN_API_URL', 'GREEN_ID_INSTANCE', 'GREEN_API_TOKEN', 'WA_TO', 'GROQ_API_KEY'];
  if (p === 'textmebot') return ['TEXTMEBOT_API_KEY', 'WA_TO', 'GROQ_API_KEY'];
  if (p === 'ntfy') return ['NTFY_TOPIC', 'GROQ_API_KEY'];
  if (p === 'gmail') return ['GROQ_API_KEY'];
  return ['WA_TOKEN', 'WA_PHONE_NUMBER_ID', 'WA_TO', 'GROQ_API_KEY', 'WEBHOOK_VERIFY_TOKEN'];
}

function setup() {
  var required = requiredProps_();
  required.forEach(requireCfg);
  if (required.indexOf('WA_TO') >= 0 && !/^\d{10,15}$/.test(cfg('WA_TO'))) throw new Error('WA_TO deve ter so digitos com DDI, ex.: 5521999998888');

  var every = Number(cfg('RUN_EVERY_MINUTES'));
  if ([1, 5, 10, 15, 30].indexOf(every) < 0) throw new Error('RUN_EVERY_MINUTES deve ser 1, 5, 10, 15 ou 30');

  uninstall();
  ScriptApp.newTrigger('runAgent').timeBased().everyMinutes(every).create();
  ScriptApp.newTrigger('dailyDigest').timeBased().atHour(Number(cfg('DIGEST_HOUR'))).nearMinute(0).everyDays(1).create();

  if (!cfg('LAST_RUN_TS')) setState('LAST_RUN_TS', Date.now()); // comeca a partir de agora
  var sheet = getLogSheet_('Log');
  getOrCreateLabel_(cfg('LABEL_NOTIFIED'));

  console.log('Pronto. Agente a cada ' + every + ' min, resumo as ' + cfg('DIGEST_HOUR') + 'h. Modo: ' + cfg('MODE') + '.');
  console.log('Planilha de log: ' + sheet.getParent().getUrl());
}

function uninstall() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['runAgent', 'dailyDigest'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
}

function testWhatsApp() {
  // horario no assunto: o Gmail agrupa mensagens de mesmo assunto numa conversa so
  var hhmm = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'HH:mm');
  var test = { fromName: 'Agente de Emails', summary: 'Teste das ' + hhmm + ': se tocou, as notificacoes estao funcionando', deadline: '', category: 'outro' };
  var res = isGmailChannel_() ? gmailNotify_(test)
    : isNtfy_() ? ntfyNotify_(test)
    : waSendTemplate_(['Agente de Emails', 'Mensagem de teste: se chegou, o WhatsApp esta funcionando', 'nao informado']);
  console.log(JSON.stringify(res));
  console.log('"ok" = o servico aceitou. Na Meta, se nao chegar no celular, rode showStatus() em 1 minuto para ver o erro de entrega.');
}

function testGroq() {
  var samples = [
    { id: 't1', fromName: 'Quora Digest', fromEmail: 'digest-noreply@quora.com', subject: 'Qual o melhor jeito de aprender Python?', snippet: 'Respostas populares da semana...', isBulk: true },
    { id: 't2', fromName: 'Secretaria CCE', fromEmail: 'notas@puc-rio.br', subject: 'Nota da G1 disponivel', snippet: 'Informamos que a nota da G1 da disciplina Calculo a Uma Variavel foi lancada: 7,0.', toMe: true },
    { id: 't3', fromName: 'JobConvo', fromEmail: 'nao-responda@jobconvo.com', subject: 'PwC - Convite para teste online', snippet: 'Voce foi convidado para a etapa de testes online. Prazo: ate 28/10 as 23h59.', mandatory: true },
    { id: 't4', fromName: 'Joao Pedro', fromEmail: 'joao@gmail.com', subject: 'trabalho de grupo', snippet: 'Cara, consegue me mandar tua parte do relatorio ate amanha 18h? A gente precisa entregar.', toMe: true },
    { id: 't5', fromName: 'PUC Urgente', fromEmail: 'pucurgente@puc-rio.br', subject: 'Avisos da semana', snippet: 'Confira os eventos da semana no campus.', isBulk: true }
  ];
  console.log(JSON.stringify(classifyItems_(samples), null, 2));
}

function dryRunLast24h() {
  var rows = runAgentOnce_({ dryRun: true, sinceMs: Date.now() - 24 * 3600 * 1000 });
  rows.forEach(function (r) { console.log([r[6], r[4], r[2], r[3], r[8]].join(' | ')); });
  console.log(rows.length + ' e-mails. Detalhes na aba "Simulacao": ' + getLogSpreadsheet_().getUrl());
}

function showStatus() {
  console.log(statusText_());
  console.log('Falhas recentes do WhatsApp: ' + JSON.stringify(getJsonState('WA_FAILURES', [])));
  console.log('Pendentes (esperando IA): ' + JSON.stringify(getJsonState('PENDING', {})));
}

/**
 * Levantamento de remetentes dos ultimos 120 dias (sem Promocoes/Social/Foruns), para montar
 * a lista de notificacao prioritaria. Grava na aba "Remetentes" da planilha de log.
 * Sinais: quantos e-mails, quantos voce leu, quantos o Gmail marcou como importantes,
 * e em quantos voce respondeu.
 */
function senderReport() {
  var days = 120, maxThreads = 2500, started = Date.now();
  var q = 'newer_than:' + days + 'd -in:sent -in:chats -category:promotions -category:social -category:forums';
  var me = myAddresses_();
  var stats = {};
  var total = 0;
  for (var start = 0; start < maxThreads; start += 100) {
    if (Date.now() - started > 4 * 60 * 1000) break;
    var threads = GmailApp.search(q, start, 100);
    if (!threads.length) break;
    var msgs = GmailApp.getMessagesForThreads(threads);
    threads.forEach(function (t, i) {
      var first = null, replied = false;
      msgs[i].forEach(function (m) {
        var f = parseFrom_(m.getFrom());
        if (me.indexOf(f.email) >= 0) replied = true;
        else if (!first) first = m;
      });
      if (!first) return;
      total++;
      var from = parseFrom_(first.getFrom());
      var s = stats[from.email] || (stats[from.email] = { name: from.name, email: from.email, n: 0, read: 0, important: 0, replied: 0, last: 0, subjects: [] });
      s.n++;
      if (!t.isUnread()) s.read++;
      if (t.isImportant()) s.important++;
      if (replied) s.replied++;
      var d = t.getLastMessageDate().getTime();
      if (d > s.last) s.last = d;
      if (s.subjects.length < 3) s.subjects.push(oneLine_(t.getFirstMessageSubject(), 70));
    });
  }
  var tz = Session.getScriptTimeZone();
  var rows = Object.keys(stats).map(function (k) { return stats[k]; })
    .sort(function (a, b) { return (b.replied * 5 + b.read) - (a.replied * 5 + a.read) || b.n - a.n; });
  var header = ['E-mail', 'Nome', 'E-mails', 'Lidos', '% lidos', 'Importantes', 'Respondidos', 'Ultimo', 'Exemplos de assunto'];
  var values = rows.map(function (s) {
    return [s.email, s.name, s.n, s.read, Math.round(100 * s.read / s.n), s.important, s.replied,
      Utilities.formatDate(new Date(s.last), tz, 'yyyy-MM-dd'), s.subjects.join(' | ')];
  });
  var ss = getLogSpreadsheet_();
  var sh = ss.getSheetByName('Remetentes') || ss.insertSheet('Remetentes');
  sh.clear();
  sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
  if (values.length) sh.getRange(2, 1, values.length, header.length).setValues(values);
  sh.setFrozenRows(1);
  console.log(total + ' conversas, ' + rows.length + ' remetentes. Aba "Remetentes": ' + ss.getUrl());
  rows.slice(0, 150).forEach(function (s) {
    console.log([s.email, s.name, 'n=' + s.n, 'lidos=' + s.read, 'imp=' + s.important, 'resp=' + s.replied, s.subjects.join(' | ')].join(' ; '));
  });
}

/**
 * Testa a IA nos e-mails reais de alguns remetentes (ate 40 conversas de cada, ultimos 120 dias),
 * sem avisar, marcar ou mudar nada. Resultado na aba "Teste remetentes" e no registro de execucao.
 * Remetentes: propriedade SIM_SENDERS (separados por virgula), LISTA_TESTE do Listas.gs ou,
 * sem nenhuma das duas, a lista prioritaria.
 * Se o tempo acabar, rode de novo: continua de onde parou. Para refazer do zero, apague a aba.
 */
function simulateSenders() {
  // um lote pode levar ~1,5 min se o Groq pedir para esperar; o Apps Script corta em 6 min
  var started = Date.now(), days = 120, perSender = 40, budgetMs = 3.5 * 60 * 1000;
  var sheetName = 'Teste remetentes';
  var senders = senderList_('SIM_SENDERS', typeof LISTA_TESTE !== 'undefined' ? LISTA_TESTE : prioritySenders_())
    .filter(function (s) { return s.indexOf('@') > 0; });

  var done = {};
  var old = getLogSpreadsheet_().getSheetByName(sheetName);
  if (old && old.getLastRow() > 1) {
    old.getRange(2, 2, old.getLastRow() - 1, 1).getValues().forEach(function (r) { done[r[0]] = true; });
  }

  var me = myAddresses_();
  var items = [];
  senders.forEach(function (s) {
    var threads = GmailApp.search('from:' + s + ' newer_than:' + days + 'd', 0, perSender);
    if (!threads.length) return;
    var msgs = GmailApp.getMessagesForThreads(threads);
    threads.forEach(function (t, i) {
      var labels = t.getLabels().map(function (l) { return l.getName(); });
      msgs[i].forEach(function (m) {
        if (done[m.getId()] || parseFrom_(m.getFrom()).email !== s) return;
        items.push(itemFromMessage_(m, t, labels, '', me));
      });
    });
  });
  items.forEach(function (it) {
    var r = applyRules_(it);
    it.action = r.action;
    it.rule = r.rule;
    it.mandatory = r.action === 'mandatory';
    it.priority = !!r.priority;
  });

  var tz = Session.getScriptTimeZone();
  var rows = [], lines = [], left = 0;
  var add = function (it, d, decision, note) {
    rows.push(logRow_(it, d, decision, '', tz));
    lines.push([decision, Utilities.formatDate(it.date, tz, 'dd/MM'), it.fromEmail, oneLine_(it.subject, 90), note].join(' | '));
  };
  items.forEach(function (it) { if (it.action === 'discard') add(it, null, 'descartado', it.rule); });
  appendLogRows_(rows.splice(0), sheetName);
  var toLlm = items.filter(function (it) { return it.action !== 'discard'; });
  var lastCall = 0;
  for (var i = 0; i < toLlm.length; i += LLM_BATCH_SIZE) {
    if (Date.now() - started > budgetMs) { left += toLlm.length - i; break; }
    // plano gratuito do Groq: ~1 lote por minuto no 120b; espera em vez de cair no modelo menor
    if (lastCall) Utilities.sleep(Math.max(0, 62000 - (Date.now() - lastCall)));
    lastCall = Date.now();
    var batch = toLlm.slice(i, i + LLM_BATCH_SIZE);
    var dec = classifyBatch_(batch) || {};
    batch.forEach(function (it) {
      var d = dec[it.id];
      if (!d) { left++; return; } // sem resposta da IA: fica para a proxima rodada
      var notify = it.mandatory || d.notify;
      add(it, d, notify ? 'AVISA' : 'quieto', notify ? d.summary : d.reason);
    });
    appendLogRows_(rows.splice(0), sheetName); // grava a cada lote: se o tempo estourar, nada se perde
  }

  var avisa = lines.filter(function (l) { return l.indexOf('AVISA') === 0; }).length;
  console.log(lines.length + ' e-mails testados agora (' + avisa + ' avisariam). ' +
    (left ? 'Faltam ' + left + ': rode de novo.' : 'Concluido.') + ' Aba "' + sheetName + '": ' + getLogSpreadsheet_().getUrl());
  lines.forEach(function (l) { console.log(l); });
}

/**
 * Diagnostico do canal Gmail: manda tres testes de uma vez, cada um entregue de um jeito,
 * para descobrir qual faz o celular tocar.
 *   A: mensagem importada so no marcador Avisos (o jeito atual)
 *   B: mensagem importada na caixa de entrada + Avisos
 *   C: e-mail normal (SMTP) de voce para voce mesmo
 */
function testGmailDelivery() {
  var hhmm = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'HH:mm');
  var body = 'Teste de entrega do Agente de Emails. Diga qual das letras (A, B, C) tocou no celular.';
  var label = cfg('LABEL_ALERTS');
  var a = gmailImport_({ fromName: 'Agente de Emails', subject: 'Teste A ' + hhmm + ' (so Avisos)', body: body, labels: [label], inbox: false });
  var b = gmailImport_({ fromName: 'Agente de Emails', subject: 'Teste B ' + hhmm + ' (caixa de entrada + Avisos)', body: body, labels: [label], inbox: true });
  var c = 'ok';
  try {
    GmailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'Teste C ' + hhmm + ' (e-mail normal para voce mesmo)', body, { name: 'Agente de Emails' });
  } catch (e) { c = String(e); }
  console.log(JSON.stringify({ A: a, B: b, C: c }));
}
