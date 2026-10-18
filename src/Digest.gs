/**
 * Resumo diario (gatilho as 8h). Tambem serve de "sinal de vida":
 * se o resumo nao chegar, algo parou.
 */
function dailyDigest() {
  var tz = Session.getScriptTimeZone();
  var s = getJsonState('STATS', { since: Date.now() });
  var lastOk = Number(cfg('LAST_OK_TS') || 0);
  var healthy = Date.now() - lastOk < 60 * 60 * 1000;
  var ignored = (s.ignored || 0) + (s.discarded || 0);

  var line = (s.sent || 0) + ' avisos enviados, ' + ignored + ' e-mails ignorados';
  if (cfg('MODE') === 'shadow') line += ', ' + (s.shadow || 0) + ' que a IA avisaria (modo teste)';
  if (cfg('PAUSED') === 'true') line = 'PAUSADO. ' + line;
  if (!healthy) {
    line = 'ATENCAO: sem rodar desde ' + (lastOk ? Utilities.formatDate(new Date(lastOk), tz, 'dd/MM HH:mm') : 'nunca') + '. ' + line;
  }

  var res;
  if (isServiceWindowOpen_()) {
    var text = '☀️ *Resumo do Agente de Emails*\n' + line + '.';
    if ((s.shadowSamples || []).length) text += '\nA IA avisaria:\n• ' + s.shadowSamples.join('\n• ');
    res = waSendText_(text);
  } else {
    res = waSendTemplate_(['Agente de Emails (resumo diario)', line, healthy ? 'nenhum' : 'verificar o Apps Script']);
  }
  if (!res.ok) {
    GmailApp.sendEmail(alertEmail(), '[Agente de Emails] Resumo diario (WhatsApp falhou)', line + '\n\nErro do WhatsApp: ' + res.error);
  }
  setJsonState('STATS', { since: Date.now() });
}
