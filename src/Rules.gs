/**
 * Camadas 1 e 2 do funil: regras fixas, baratas e previsiveis.
 *
 *   1. DESCARTE      ruido conhecido -> nunca chega na IA nem no WhatsApp
 *   2. OBRIGATORIO   processos seletivos -> sempre avisa (a IA so resume)
 *   3. IA            todo o resto -> a IA decide (Classifier.gs)
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

/** Assuntos de plataformas de vaga que sao marketing, nao processo seletivo. */
var JOB_MARKETING_SUBJECT = /(vagas? (para voc[eê]|recomendad|que combinam|novas?)|newsletter|webinar|dicas? de carreira|conte[uú]do exclusivo|jobs? for you|recommended jobs)/i;

/** Ruido conhecido (camada 1). Cada regra: from e/ou subject (regex). */
var DISCARD_RULES = [
  { name: 'Quora', from: /(^|[@.])quora\.com$/i },
  { name: 'Cardapio PUC Urgente', any: /puc ?urgente/i, subject: /card[aá]pio|menu|bandej[aã]o|restaurante/i },
  { name: 'Confirmacao de login', subject: /(novo (acesso|login|dispositivo)|new (sign-?in|login|device)|sign-?in (alert|attempt|detected)|login (detectado|realizado|confirm)|acesso (detectado|realizado) [àa] sua conta|someone signed in|voc[eê] (fez|acabou de fazer) login)/i },
  { name: 'Codigo de verificacao', subject: /(c[oó]digo de (verifica[cç][aã]o|acesso|seguran[cç]a|confirma[cç][aã]o)|verification code|security code|one-time (code|password|passcode)|\bOTP\b|seu c[oó]digo|your code)/i }
];

/**
 * Decide a camada de um e-mail.
 * item: { fromEmail, fromName, subject, labels[], category, isFromMe, isAgentMail }
 * retorna { action: 'discard' | 'mandatory' | 'llm', rule: 'nome da regra' }
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
