/**
 * Configuracao do Agente de Emails.
 *
 * Nada sensivel fica no codigo. Segredos (tokens, chaves) e dados pessoais
 * (numero do WhatsApp) ficam em "Propriedades do script":
 * Apps Script > Configuracoes do projeto > Propriedades do script.
 *
 * Obrigatorias:
 *   WA_TOKEN              token permanente do usuario do sistema (Meta)
 *   WA_PHONE_NUMBER_ID    "Identificacao do numero de telefone" (Meta > Configuracao da API)
 *   WA_TO                 seu numero no formato internacional, so digitos (ex.: 5521999998888)
 *   GROQ_API_KEY          chave da API do Groq
 *   WEBHOOK_VERIFY_TOKEN  texto aleatorio usado para validar o webhook na Meta
 *
 * Se usar a Green API (WA_PROVIDER=greenapi), troque WA_TOKEN/WA_PHONE_NUMBER_ID/
 * WEBHOOK_VERIFY_TOKEN por GREEN_API_URL, GREEN_ID_INSTANCE e GREEN_API_TOKEN.
 *
 * Opcionais (tem valor padrao abaixo): MODE, GROQ_MODEL, WA_TEMPLATE, ALERT_EMAIL...
 */

var DEFAULTS = {
  // 'shadow': a IA so registra na planilha o que mandaria (regras fixas continuam avisando).
  // 'live'  : a IA tambem manda WhatsApp.
  MODE: 'shadow',
  WA_PROVIDER: 'meta',          // 'meta' (Cloud API oficial) ou 'greenapi' (veja o README)
  GROQ_MODEL: 'openai/gpt-oss-120b',
  GROQ_FALLBACK_MODEL: 'openai/gpt-oss-20b',
  GROQ_REASONING_EFFORT: 'medium',
  WA_API_VERSION: 'v25.0',
  WA_TEMPLATE: 'aviso_email',
  WA_TEMPLATE_LANG: 'pt_BR',
  RUN_EVERY_MINUTES: '10',
  DIGEST_HOUR: '8',
  LABEL_JOBS: 'Processos seletivos',
  LABEL_NOTIFIED: 'Agente/Avisado',
  ADD_LABELS: 'true',
  MAX_NOTIFICATIONS_PER_RUN: '6',
  PAUSED: 'false'
};

/** Le uma configuracao: propriedade do script ou valor padrao. */
function cfg(key) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  if (v !== null && v !== '') return v;
  return DEFAULTS.hasOwnProperty(key) ? DEFAULTS[key] : null;
}

/** Igual a cfg(), mas falha com mensagem clara se estiver faltando. */
function requireCfg(key) {
  var v = cfg(key);
  if (!v) throw new Error('Falta a propriedade do script "' + key + '". Veja o README, secao Configuracao.');
  return v;
}

function setState(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, String(value));
}

function getJsonState(key, fallback) {
  var raw = PropertiesService.getScriptProperties().getProperty(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch (e) { return fallback; }
}

function setJsonState(key, obj) {
  PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(obj));
}

/** E-mail que recebe alertas de falha (padrao: a propria conta). */
function alertEmail() {
  return cfg('ALERT_EMAIL') || Session.getEffectiveUser().getEmail();
}
