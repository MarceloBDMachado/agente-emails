/**
 * Instalacao e testes. Rode pelo editor do Apps Script (selecione a funcao e clique em Executar).
 *
 *   setup()          valida a configuracao, cria planilha de log, marcador e gatilhos
 *   testWhatsApp()   manda uma mensagem de teste (template)
 *   testGroq()       classifica e-mails de exemplo (nao usa seus e-mails)
 *   dryRunLast24h()  simula o agente nas ultimas 24h e grava na aba "Simulacao" (nao envia nada)
 *   showStatus()     mostra o estado atual no registro de execucao
 *   uninstall()      remove os gatilhos (o agente para)
 */

function requiredProps_() {
  var p = cfg('WA_PROVIDER');
  if (p === 'greenapi') return ['GREEN_API_URL', 'GREEN_ID_INSTANCE', 'GREEN_API_TOKEN', 'WA_TO', 'GROQ_API_KEY'];
  if (p === 'textmebot') return ['TEXTMEBOT_API_KEY', 'WA_TO', 'GROQ_API_KEY'];
  return ['WA_TOKEN', 'WA_PHONE_NUMBER_ID', 'WA_TO', 'GROQ_API_KEY', 'WEBHOOK_VERIFY_TOKEN'];
}

function setup() {
  requiredProps_().forEach(requireCfg);
  if (!/^\d{10,15}$/.test(cfg('WA_TO'))) throw new Error('WA_TO deve ter so digitos com DDI, ex.: 5521999998888');

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
  var res = waSendTemplate_(['Agente de Emails', 'Mensagem de teste: se chegou, o WhatsApp esta funcionando', 'nao informado']);
  console.log(JSON.stringify(res));
  console.log('"ok" = a Meta aceitou. Se nao chegar no celular, rode showStatus() em 1 minuto para ver o erro de entrega.');
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
