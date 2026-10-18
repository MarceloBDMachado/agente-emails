/**
 * Agente de Emails: roda a cada 10 minutos (gatilho criado por setup()).
 *
 *   Gmail (novos e-mails) -> camada 1 descarte -> camada 2 obrigatorio -> camada 3 IA
 *        -> WhatsApp (o que importa) + planilha de log (tudo)
 */

var MAX_RUN_MS = 4.5 * 60 * 1000;  // limite do Apps Script e 6 min por execucao
var OVERLAP_MS = 20 * 60 * 1000;   // sobreposicao entre buscas (IDs processados evitam duplicatas)
var MAX_LLM_RETRIES = 2;           // execucoes extras esperando a IA antes de avisar por seguranca

/** Ponto de entrada do gatilho. */
function runAgent() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) { console.log('Outra execucao em andamento; pulando.'); return; }
  try {
    if (cfg('PAUSED') === 'true') { console.log('Agente pausado.'); return; }
    var rows = runAgentOnce_({});
    setState('CONSECUTIVE_ERRORS', 0);
    setState('LAST_OK_TS', Date.now());
    console.log('Execucao ok: ' + rows.length + ' e-mail(s) analisado(s).');
  } catch (e) {
    handleRunError_(e);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Uma passada completa. opts.dryRun = true: nao envia, nao marca, nao altera nada
 * (so grava o resultado na aba "Simulacao" da planilha). opts.sinceMs: inicio da busca.
 */
function runAgentOnce_(opts) {
  var started = Date.now();
  var dry = !!opts.dryRun;
  var lastRun = Number(cfg('LAST_RUN_TS')) || (started - 3600 * 1000);
  var sinceMs = opts.sinceMs || (lastRun - OVERLAP_MS);

  var processed = dry ? {} : loadProcessed_();
  var pending = dry ? {} : getJsonState('PENDING', {});
  var me = myAddresses_();

  var items = fetchNewItems_(sinceMs, processed, me);
  var seen = {};
  items.forEach(function (it) { seen[it.id] = true; });
  Object.keys(pending).forEach(function (id) {
    if (seen[id] || processed[id]) return;
    var it = itemFromId_(id, me);
    if (it) items.push(it); else delete pending[id];
  });

  // Camadas 1 e 2
  items.forEach(function (it) {
    var r = applyRules_(it);
    it.action = r.action;
    it.rule = r.rule;
    it.mandatory = r.action === 'mandatory';
    it.priority = !!r.priority;
  });

  // Camada 3 (obrigatorios primeiro: so precisam de resumo)
  var toLlm = items.filter(function (it) { return it.action !== 'discard'; })
    .sort(function (a, b) { return (b.mandatory ? 1 : 0) - (a.mandatory ? 1 : 0); });
  var decisions = toLlm.length ? classifyItems_(toLlm) : {};

  var mode = cfg('MODE');
  var maxSend = Number(cfg('MAX_NOTIFICATIONS_PER_RUN')) || 6;
  var sent = 0, overflow = [], sendErrors = [], rows = [], timedOut = false;
  var tz = Session.getScriptTimeZone();

  items.forEach(function (it) {
    if (Date.now() - started > MAX_RUN_MS) { timedOut = true; return; }
    var d = decisions[it.id];
    var decision, status = '';

    if (it.action === 'discard') {
      decision = 'descartado';
      if (!dry) bumpStats_('discarded');
    } else {
      if (!d && !it.mandatory && (pending[it.id] || 0) < MAX_LLM_RETRIES && !dry) {
        pending[it.id] = (pending[it.id] || 0) + 1;
        rows.push(logRow_(it, null, 'pendente (IA indisponivel, tento de novo)', '', tz));
        return; // nao marca como processado
      }
      if (!d) {
        d = { notify: true, category: it.mandatory ? 'processo_seletivo' : 'outro', summary: it.subject,
              deadline: '', reason: 'IA indisponivel: aviso por seguranca' };
      }
      it.decision = d;
      if (!(it.mandatory || d.notify)) {
        decision = 'ignorado';
        if (!dry) bumpStats_('ignored');
      } else if (it.mandatory || mode === 'live') {
        decision = 'avisar';
        if (dry) {
          status = '(simulacao)';
        } else if (sent >= maxSend) {
          overflow.push(it);
          status = 'agrupado no aviso extra';
        } else {
          var res = notifyWhatsApp_(notificationFor_(it));
          sent++;
          status = res.ok ? 'enviado' : 'ERRO: ' + res.error;
          if (res.ok) { bumpStats_('sent'); labelNotified_(it); } else { sendErrors.push({ item: it, error: res.error }); }
        }
      } else {
        decision = 'avisaria (modo teste)';
        if (!dry) bumpStats_('shadow', d.summary || it.subject);
      }
    }
    delete pending[it.id];
    if (!dry) markProcessed_(processed, it.id);
    rows.push(logRow_(it, it.decision, decision, status, tz));
  });

  if (overflow.length && !dry) {
    var res = notifyWhatsApp_({
      fromName: 'Agente de Emails',
      category: 'outro',
      summary: '+' + overflow.length + ' outros avisos: ' + overflow.map(function (it) {
        return oneLine_((it.decision && it.decision.summary) || it.subject, 40);
      }).join('; '),
      deadline: ''
    });
    if (!res.ok) overflow.forEach(function (it) { sendErrors.push({ item: it, error: res.error }); });
    else overflow.forEach(function (it) { bumpStats_('sent'); labelNotified_(it); });
  }

  if (dry) {
    appendLogRows_(rows, 'Simulacao');
    return rows;
  }

  saveProcessed_(processed);
  setJsonState('PENDING', pending);
  if (!timedOut) setState('LAST_RUN_TS', started);
  appendLogRows_(rows);
  if (sendErrors.length) emailSendErrors_(sendErrors);
  reportAsyncFailures_();
  return rows;
}

/** Busca mensagens novas da caixa de entrada desde sinceMs. */
function fetchNewItems_(sinceMs, processed, me) {
  var sinceSec = Math.floor(sinceMs / 1000);
  var base = 'in:inbox after:' + sinceSec;
  var threads = GmailApp.search(base, 0, 100);

  var catOf = {};
  ['promotions', 'social', 'forums'].forEach(function (c) {
    GmailApp.search(base + ' category:' + c, 0, 100).forEach(function (t) { catOf[t.getId()] = c; });
  });

  var items = [];
  threads.forEach(function (thread) {
    var labels = thread.getLabels().map(function (l) { return l.getName(); });
    thread.getMessages().forEach(function (m) {
      if (processed[m.getId()]) return;
      if (m.getDate().getTime() < sinceMs) return;
      if (m.isDraft() || m.isInTrash() || !m.isInInbox()) return;
      var it = itemFromMessage_(m, thread, labels, catOf[thread.getId()] || '', me);
      if (!it.isFromMe) items.push(it);
    });
  });
  return items;
}

function itemFromId_(id, me) {
  try {
    var m = GmailApp.getMessageById(id);
    if (!m || m.isInTrash()) return null;
    var thread = m.getThread();
    var labels = thread.getLabels().map(function (l) { return l.getName(); });
    return itemFromMessage_(m, thread, labels, '', me);
  } catch (e) {
    return null;
  }
}

function itemFromMessage_(m, thread, labels, category, me) {
  var from = parseFrom_(m.getFrom());
  var recipients = (String(m.getTo() || '') + ',' + String(m.getCc() || '')).toLowerCase();
  var precedence = String(m.getHeader('Precedence') || '');
  return {
    id: m.getId(),
    threadId: thread.getId(),
    fromName: from.name,
    fromEmail: from.email,
    subject: String(m.getSubject() || '(sem assunto)'),
    snippet: cleanBody_(m.getPlainBody()),
    date: m.getDate(),
    labels: labels,
    category: category,
    isBulk: !!(m.getHeader('List-Unsubscribe') || m.getHeader('List-Id')) || /bulk|list/i.test(precedence),
    toMe: me.some(function (a) { return recipients.indexOf(a) >= 0; }),
    isFromMe: me.indexOf(from.email) >= 0,
    isAgentMail: false
  };
}

/** Seus enderecos (conta + aliases), em minusculas. */
function myAddresses_() {
  var list = [Session.getEffectiveUser().getEmail()];
  try { list = list.concat(GmailApp.getAliases()); } catch (e) { /* sem aliases */ }
  return list.map(function (a) { return String(a).toLowerCase(); });
}

function notificationFor_(it) {
  var d = it.decision || {};
  return {
    fromName: it.fromName || it.fromEmail,
    summary: d.summary || it.subject,
    deadline: d.deadline || '',
    category: it.mandatory ? 'processo_seletivo' : (d.category || 'outro'),
    threadId: it.threadId,
    fromEmail: it.fromEmail,
    subject: it.subject
  };
}

function logRow_(it, d, decision, status, tz) {
  d = d || {};
  return [
    Utilities.formatDate(it.date || new Date(), tz, 'yyyy-MM-dd HH:mm'),
    it.id,
    oneLine_(it.fromName + ' <' + it.fromEmail + '>', 120),
    oneLine_(it.subject, 200),
    it.action === 'discard' ? '1 descarte' : (it.mandatory ? '2 obrigatorio' : '3 IA'),
    it.rule || '',
    decision,
    d.category || '',
    d.summary || '',
    d.deadline || '',
    d.reason || '',
    status
  ];
}

var labelCache_ = {};
function getOrCreateLabel_(name) {
  if (!labelCache_[name]) labelCache_[name] = GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
  return labelCache_[name];
}

function labelNotified_(it) {
  if (cfg('ADD_LABELS') !== 'true') return;
  try { GmailApp.getThreadById(it.threadId).addLabel(getOrCreateLabel_(cfg('LABEL_NOTIFIED'))); } catch (e) { /* opcional */ }
}

/** WhatsApp recusou na hora: manda o aviso por e-mail para nao perder nada. */
function emailSendErrors_(errors) {
  var body = 'O WhatsApp recusou estes avisos, entao eles vao por e-mail:\n\n' + errors.map(function (x) {
    var n = notificationFor_(x.item);
    return '- ' + n.summary + ' (de ' + n.fromName + (n.deadline ? ', prazo ' + n.deadline : '') + ')\n  Erro: ' + x.error;
  }).join('\n');
  GmailApp.sendEmail(alertEmail(), '[Agente de Emails] ' + errors.length + ' aviso(s) nao enviado(s) no WhatsApp', body);
}

/** Falhas que chegam depois pelo webhook (ex.: 130497). Avisa por e-mail no maximo 1x por hora. */
function reportAsyncFailures_() {
  var failures = getJsonState('WA_FAILURES', []);
  var reported = Number(cfg('FAILURES_REPORTED_TS') || 0);
  var fresh = failures.filter(function (f) { return f.t > reported; });
  if (!fresh.length || Date.now() - Number(cfg('LAST_FAILURE_EMAIL_TS') || 0) < 3600 * 1000) return;
  var body = 'A Meta aceitou, mas nao entregou ' + fresh.length + ' mensagem(ns) no WhatsApp:\n\n' +
    fresh.map(function (f) { return '- erro ' + f.code + ': ' + f.title; }).join('\n') +
    '\n\nConfira a planilha de log para ver quais e-mails eram. Veja o README, secao "Problemas comuns".';
  GmailApp.sendEmail(alertEmail(), '[Agente de Emails] Falha de entrega no WhatsApp', body);
  setState('FAILURES_REPORTED_TS', fresh[fresh.length - 1].t);
  setState('LAST_FAILURE_EMAIL_TS', Date.now());
}

function handleRunError_(e) {
  console.error('Erro na execucao: ' + (e && e.stack || e));
  var n = Number(cfg('CONSECUTIVE_ERRORS') || 0) + 1;
  setState('CONSECUTIVE_ERRORS', n);
  if (n === 3) {
    var msg = 'O agente falhou 3 vezes seguidas. Ultimo erro: ' + e;
    try { GmailApp.sendEmail(alertEmail(), '[Agente de Emails] Agente com erro', msg); } catch (x) { /* nada */ }
    try { waSendTemplate_(['Agente de Emails', oneLine_('Agente com erro: ' + e, 150), 'verificar o Apps Script']); } catch (x) { /* nada */ }
  }
}
