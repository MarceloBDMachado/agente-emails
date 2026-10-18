/**
 * Camadas 1 e 2 do funil: regras fixas, baratas e previsiveis.
 *
 *   1. DESCARTE      ruido conhecido -> nunca chega na IA nem no WhatsApp
 *   2. OBRIGATORIO   processos seletivos -> sempre avisa (a IA so resume)
 *   3. IA            todo o resto -> a IA decide (Classifier.gs); remetentes da
 *                    lista prioritaria chegam nela marcados como importantes
 *
 * Para adaptar ao seu caso, edite as listas abaixo.
 */

/**
 * Plataformas de recrutamento e testes online: e-mail delas = processo seletivo.
 * Complementa o filtro do Gmail que aplica o marcador "Processos seletivos"
 * (empresas especificas ficam no filtro; veja docs/gmail-filter.txt).
 */
var JOB_DOMAINS = [
  'gupy.io', 'gupy.com.br', 'jobconvo.com', 'myworkday.com', 'joinbairesdev.com', 'adecco.com', 'adecco.com.br', 'pwc.com', 'pwc.com.br',
  'kenoby.com', 'vagas.com.br', 'solides.com.br', 'inhire.app', 'greenhouse.io',
  'lever.co', 'myworkdayjobs.com', 'workday.com', 'smartrecruiters.com', 'taleo.net',
  'successfactors.com', 'successfactors.eu', 'eightfold.ai', '99jobs.com', 'ciadetalentos.com',
  'hackerrank.com', 'codility.com', 'mettl.com', 'hirevue.com', 'shl.com', 'cappfinity.com',
  'testgorilla.com', 'eureca.me', 'recrut.ai', 'bettha.com', 'pandape.com.br', 'abler.com.br'
];

/** Assuntos de plataformas de vaga que sao marketing ou cadastro, nao processo seletivo. */
var JOB_MARKETING_SUBJECT = /(vagas? (para voc[eê]|recomendad|que combinam|novas?|do dia)|novas? vagas?|destac\w* (o |seu )?curr[ií]culo|curr[ií]culo em destaque|newsletter|webinar|dicas? de carreira|conte[uú]do exclusivo|jobs? for you|recommended jobs|confirme? (o |seu )?e-?mail|cadastro.{0,30}(confirmad|realizad|conclu[ií]d)|verify your email|redefini[cç][aã]o de senha|reset (your )?password)/i;

/** Ruido conhecido (camada 1). Cada regra: from e/ou subject (regex). */
var DISCARD_RULES = [
  { name: 'Quora', from: /(^|[@.])quora\.com$/i },
  { name: 'Cardapio PUC Urgente', any: /puc ?urgente/i, subject: /card[aá]pio|menu|bandej[aã]o|restaurante/i },
  { name: 'Confirmacao de login', subject: /(novo (acesso|login|dispositivo)|new (sign-?in|login|device)|sign-?in (alert|attempt|detected)|login (detectado|realizado|confirm)|acesso (detectado|realizado) [àa] sua conta|someone signed in|voc[eê] (fez|acabou de fazer) login)/i },
  { name: 'Login com Google em outro site', subject: /(compartilhou alguns dados da sua conta do google|shared some of your google account data)/i },
  { name: 'Sugestao de vagas', subject: /(vagas? do dia|sugest[aã]o de vagas?|job alert|novas vagas para)/i },
  { name: 'Codigo de verificacao', subject: /(c[oó]digo de (verifica[cç][aã]o|acesso|seguran[cç]a|confirma[cç][aã]o)|verification code|security code|one-time (code|password|passcode)|\bOTP\b|seu c[oó]digo|your code)/i }
];

/**
 * Listas pessoais de remetentes. Ficam fora do codigo publico, no arquivo privado
 * Listas.gs do projeto Apps Script (modelo em docs/Listas.example.gs), ou numa
 * propriedade do script com os itens separados por virgula. Item = endereco
 * completo ("prof@puc-rio.br") ou dominio inteiro ("catho.com.br").
 *
 *   PRIORITY_SENDERS / LISTA_PRIORITARIA  sempre passam pela IA (nem regra de descarte
 *       nem aba Promocoes os cortam) e vao com a dica de remetente importante.
 *       Quem decide se avisa continua sendo o conteudo.
 *   MUTED_SENDERS / LISTA_SILENCIADA      descartados direto, sem gastar IA.
 */
function prioritySenders_() {
  return senderList_('PRIORITY_SENDERS', typeof LISTA_PRIORITARIA !== 'undefined' ? LISTA_PRIORITARIA : []);
}

function mutedSenders_() {
  return senderList_('MUTED_SENDERS', typeof LISTA_SILENCIADA !== 'undefined' ? LISTA_SILENCIADA : []);
}

function senderList_(propName, fallback) {
  var prop = cfg(propName);
  var list = prop ? String(prop).split(/[\s,;]+/) : (fallback || []);
  return list.map(function (s) { return String(s).trim().toLowerCase(); }).filter(Boolean);
}

/** true se o e-mail for um dos enderecos da lista ou de um dos dominios dela. */
function senderInList_(email, list) {
  email = String(email || '').toLowerCase();
  var domain = emailDomain_(email);
  return list.some(function (entry) {
    return entry.indexOf('@') >= 0 ? entry === email : domainMatches_(domain, entry);
  });
}

/**
 * Decide a camada de um e-mail.
 * item: { fromEmail, fromName, subject, labels[], category, isFromMe, isAgentMail }
 * retorna { action: 'discard' | 'mandatory' | 'llm', rule: 'nome da regra', priority?: true }
 */
function applyRules_(item) {
  if (item.isAgentMail) return { action: 'discard', rule: 'E-mail do proprio agente' };

  var jobLabel = cfg('LABEL_JOBS');
  var hasJobLabel = (item.labels || []).indexOf(jobLabel) >= 0;
  var domain = emailDomain_(item.fromEmail);
  var jobDomain = null;
  for (var i = 0; i < JOB_DOMAINS.length && !jobDomain; i++) {
    if (domainMatches_(domain, JOB_DOMAINS[i])) jobDomain = JOB_DOMAINS[i];
  }
  if (hasJobLabel || jobDomain) {
    if (JOB_MARKETING_SUBJECT.test(item.subject || '')) {
      return { action: 'discard', rule: 'Marketing de vagas (nao e processo seletivo)' };
    }
    return { action: 'mandatory', rule: hasJobLabel ? 'Marcador "' + jobLabel + '"' : 'Plataforma de recrutamento (' + jobDomain + ')' };
  }

  if (senderInList_(item.fromEmail, prioritySenders_())) {
    return { action: 'llm', rule: 'Remetente prioritario', priority: true };
  }
  if (senderInList_(item.fromEmail, mutedSenders_())) {
    return { action: 'discard', rule: 'Remetente silenciado' };
  }

  var fromText = (item.fromName || '') + ' <' + (item.fromEmail || '') + '>';
  for (var j = 0; j < DISCARD_RULES.length; j++) {
    var r = DISCARD_RULES[j];
    var ok = true;
    if (r.from && !r.from.test(item.fromEmail || '')) ok = false;
    if (ok && r.any && !(r.any.test(fromText) || r.any.test(item.subject || ''))) ok = false;
    if (ok && r.subject && !r.subject.test(item.subject || '')) ok = false;
    if (ok) return { action: 'discard', rule: r.name };
  }

  if (item.category === 'promotions' || item.category === 'social' || item.category === 'forums') {
    return { action: 'discard', rule: 'Aba ' + item.category + ' do Gmail' };
  }

  return { action: 'llm', rule: 'Zona cinza' };
}
