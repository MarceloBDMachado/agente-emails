/**
 * Webhook da WhatsApp Cloud API (publicado como App da Web).
 *
 * - GET:  verificacao da Meta (hub.challenge).
 * - POST: status das mensagens (entregue, lida, falhou) e mensagens que voce manda para o bot.
 *
 * Limitacao: o Apps Script nao expoe os cabecalhos HTTP, entao nao da para validar
 * a assinatura X-Hub-Signature-256. Por isso o webhook so registra diagnostico e
 * so responde ao seu proprio numero (WA_TO); nada aqui le ou envia e-mails.
 */

function doGet(e) {
  var p = (e && e.parameter) || {};
  var expected = cfg('WEBHOOK_VERIFY_TOKEN');
  if (p['hub.mode'] === 'subscribe' && expected && p['hub.verify_token'] === expected) {
    return ContentService.createTextOutput(p['hub.challenge']);
  }
  return ContentService.createTextOutput('forbidden');
}

function doPost(e) {
  var body = (e && e.postData && e.postData.contents) || '';
  try {
    var payload = JSON.parse(body);
    var actions = handleWebhookPayload_(payload, cfg('WA_TO'));
    actions.replies.forEach(function (text) { waSendText_(text); });
  } catch (err) {
    console.error('Webhook: ' + err + ' | corpo: ' + body.slice(0, 500));
  }
  return ContentService.createTextOutput('ok');
}

/**
 * Processa o JSON da Meta e atualiza o estado. Retorna { replies: [textos a responder] }.
 */
function handleWebhookPayload_(payload, myNumber) {
  var result = { replies: [] };
  var entries = (payload && payload.entry) || [];
  entries.forEach(function (entry) {
    (entry.changes || []).forEach(function (change) {
      var v = change.value || {};
      (v.statuses || []).forEach(function (st) { recordStatus_(st); });
      (v.messages || []).forEach(function (msg) {
        if (myNumber && String(msg.from) !== String(myNumber)) return; // so voce comanda o bot
        setState('LAST_INBOUND_TS', Date.now());
        var text = msg.type === 'text' && msg.text ? String(msg.text.body || '') : '';
        var reply = handleCommand_(text);
        if (reply) result.replies.push(reply);
      });
    });
  });
  return result;
}

function recordStatus_(st) {
  if (st.status === 'failed') {
    var failures = getJsonState('WA_FAILURES', []);
    var err = (st.errors && st.errors[0]) || {};
    failures.push({ t: Date.now(), id: st.id, code: err.code, title: err.title || err.message || '' });
    setJsonState('WA_FAILURES', failures.slice(-20));
  } else if (st.status === 'delivered' || st.status === 'read') {
    setState('LAST_DELIVERED_TS', Date.now());
  }
}

/** Comandos que voce pode mandar para o bot no WhatsApp. */
function handleCommand_(text) {
  var cmd = String(text || '').trim().toLowerCase();
  if (!cmd) return null;
  if (cmd === 'status') return statusText_();
  if (cmd === 'pausar') { setState('PAUSED', 'true'); return '⏸️ Agente pausado. Mande "retomar" para voltar.'; }
  if (cmd === 'retomar') { setState('PAUSED', 'false'); return '▶️ Agente ativo de novo.'; }
  if (cmd === 'ajuda' || cmd === 'help' || cmd === 'menu') {
    return 'Comandos: *status*, *pausar*, *retomar*.\nResponder qualquer coisa tambem abre a janela de 24h, e os avisos chegam em texto livre.';
  }
  return 'Recebido. Janela de 24h aberta: os proximos avisos chegam em texto livre. Mande *ajuda* para ver os comandos.';
}

function statusText_() {
  var tz = Session.getScriptTimeZone();
  var fmt = function (ts) { return ts ? Utilities.formatDate(new Date(Number(ts)), tz, 'dd/MM HH:mm') : 'nunca'; };
  var stats = getJsonState('STATS', {});
  return [
    '🤖 *Agente de Emails*',
    'Modo: ' + cfg('MODE') + (cfg('PAUSED') === 'true' ? ' (PAUSADO)' : ''),
    'Ultima verificacao: ' + fmt(cfg('LAST_RUN_TS')),
    'Desde o ultimo resumo: ' + (stats.sent || 0) + ' avisos, ' + (stats.shadow || 0) + ' sugestoes da IA em teste, ' +
      ((stats.ignored || 0) + (stats.discarded || 0)) + ' ignorados'
  ].join('\n');
}
