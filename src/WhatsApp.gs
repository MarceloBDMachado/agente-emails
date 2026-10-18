/**
 * Envio para o WhatsApp. Dois provedores (propriedade WA_PROVIDER):
 *
 * 'meta' (padrao): WhatsApp Cloud API oficial. Fora da "janela de 24h" (24h depois da
 *   ultima mensagem SUA para o numero do bot) a Meta so aceita templates aprovados.
 *   Dentro da janela da para mandar texto livre, entao o agente usa texto livre quando
 *   pode (mais legivel) e template quando precisa.
 *
 * 'greenapi': Green API (nao oficial), plano Developer gratuito. Usa um segundo numero
 *   de WhatsApp conectado por QR code e manda texto livre sempre. Veja o README.
 */

var CATEGORY_LABEL = {
  processo_seletivo: '💼 Processo seletivo',
  nota: '📝 Nota',
  academico: '🎓 Faculdade',
  pessoal: '👤 Pessoal',
  financeiro: '💳 Financeiro',
  seguranca: '🔐 Seguranca',
  outro: '📬 E-mail',
  ruido: '📬 E-mail'
};

/** Envia um aviso de e-mail. n = { fromName, summary, deadline, category } */
function notifyWhatsApp_(n) {
  if (isGreenApi_()) return greenSendText_(formatNotificationText_(n));
  if (isServiceWindowOpen_()) {
    var res = waSendText_(formatNotificationText_(n));
    if (res.ok) return res;
    console.warn('Texto livre falhou (' + res.error + '), tentando template.');
  }
  return waSendTemplate_([n.fromName, n.summary, n.deadline || 'nao informado']);
}

function formatNotificationText_(n) {
  var lines = [(CATEGORY_LABEL[n.category] || CATEGORY_LABEL.outro) + ': *' + oneLine_(n.summary, 200) + '*'];
  lines.push('De: ' + oneLine_(n.fromName, 80));
  if (n.deadline) lines.push('Prazo: ' + oneLine_(n.deadline, 40));
  return lines.join('\n');
}

/** A janela de atendimento esta aberta? (ultima mensagem recebida do usuario ha menos de 23h30) */
function isServiceWindowOpen_() {
  if (isGreenApi_()) return true; // sem janela: texto livre sempre
  var last = Number(cfg('LAST_INBOUND_TS') || 0);
  return last > 0 && Date.now() - last < 23.5 * 3600 * 1000;
}

function buildTemplatePayload_(to, templateName, lang, params) {
  return {
    messaging_product: 'whatsapp',
    to: to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: lang },
      components: [{
        type: 'body',
        parameters: params.map(function (p, i) {
          return { type: 'text', text: sanitizeTemplateParam_(p, i === 1 ? 160 : 80) };
        })
      }]
    }
  };
}

function waSendTemplate_(params) {
  if (isGreenApi_()) {
    return greenSendText_('📬 *' + oneLine_(params[1], 300) + '*\nDe: ' + oneLine_(params[0], 80) +
      (params[2] && params[2] !== 'nao informado' ? '\nPrazo: ' + oneLine_(params[2], 60) : ''));
  }
  return waPost_(buildTemplatePayload_(requireCfg('WA_TO'), cfg('WA_TEMPLATE'), cfg('WA_TEMPLATE_LANG'), params));
}

function waSendText_(text) {
  if (isGreenApi_()) return greenSendText_(text);
  return waPost_({
    messaging_product: 'whatsapp',
    to: requireCfg('WA_TO'),
    type: 'text',
    text: { body: String(text).slice(0, 4000), preview_url: false }
  });
}

/**
 * POST na Graph API. Retorna { ok, id, error }.
 * Atencao: "ok" so quer dizer que a Meta ACEITOU. A entrega (ou a falha) chega
 * depois pelo webhook (Webhook.gs), que registra falhas em WA_FAILURES.
 */
function waPost_(body) {
  var url = 'https://graph.facebook.com/' + cfg('WA_API_VERSION') + '/' + requireCfg('WA_PHONE_NUMBER_ID') + '/messages';
  try {
    var resp = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + requireCfg('WA_TOKEN') },
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });
    var json = {};
    try { json = JSON.parse(resp.getContentText()); } catch (e) { /* corpo nao-JSON */ }
    if (resp.getResponseCode() === 200 && json.messages && json.messages[0]) {
      return { ok: true, id: json.messages[0].id };
    }
    var err = json.error ? (json.error.code + ' ' + (json.error.error_data && json.error.error_data.details || json.error.message)) : ('HTTP ' + resp.getResponseCode());
    return { ok: false, error: err };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

function isGreenApi_() {
  return cfg('WA_PROVIDER') === 'greenapi';
}

/** Green API: POST {apiUrl}/waInstance{id}/sendMessage/{token} com { chatId, message }. */
function greenSendText_(text) {
  var base = requireCfg('GREEN_API_URL').replace(/\/+$/, '');
  var url = base + '/waInstance' + requireCfg('GREEN_ID_INSTANCE') + '/sendMessage/' + requireCfg('GREEN_API_TOKEN');
  try {
    var resp = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ chatId: requireCfg('WA_TO') + '@c.us', message: String(text).slice(0, 4000) }),
      muteHttpExceptions: true
    });
    var json = {};
    try { json = JSON.parse(resp.getContentText()); } catch (e) { /* corpo nao-JSON */ }
    if (resp.getResponseCode() === 200 && json.idMessage) return { ok: true, id: json.idMessage };
    return { ok: false, error: 'Green API HTTP ' + resp.getResponseCode() + ' ' + String(resp.getContentText()).slice(0, 200) };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
