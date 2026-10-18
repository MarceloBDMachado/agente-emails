'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./harness');

const BASE_PROPS = {
  WA_TOKEN: 'x', WA_PHONE_NUMBER_ID: '123', WA_TO: '5521999998888',
  GROQ_API_KEY: 'k', WEBHOOK_VERIFY_TOKEN: 'v'
};

test('parseFrom_ separa nome e e-mail', () => {
  const c = load();
  assert.deepEqual({ ...c.parseFrom_('"PwC Brasil" <Vagas@PwC.com>') }, { name: 'PwC Brasil', email: 'vagas@pwc.com' });
  assert.deepEqual({ ...c.parseFrom_('alguem@x.com') }, { name: 'alguem@x.com', email: 'alguem@x.com' });
});

test('cleanBody_ corta historico, troca links e mascara numeros', () => {
  const c = load();
  const t = c.cleanBody_('Oi! Veja https://site.com/a?b=1 CPF 123.456.789-09 cartao 4111 1111 1111 1111\n\nEm seg, 1 de jan, Fulano escreveu:\n> antigo');
  assert.match(t, /\[link\]/);
  assert.match(t, /\[cpf\]/);
  assert.match(t, /\[numero\]/);
  assert.doesNotMatch(t, /antigo/);
  assert.doesNotMatch(t, /\n/);
});

test('sanitizeTemplateParam_ respeita as regras da Meta', () => {
  const c = load();
  assert.equal(c.sanitizeTemplateParam_('a\nb\t c      d'), 'a b c d');
  assert.equal(c.sanitizeTemplateParam_(''), '-');
  assert.ok(c.sanitizeTemplateParam_('x'.repeat(500), 100).length <= 100);
});

test('regras: descarte, obrigatorio e zona cinza', () => {
  const c = load();
  const r = (o) => c.applyRules_(Object.assign({ fromName: '', fromEmail: '', subject: '', labels: [], category: '' }, o)).action;
  assert.equal(r({ fromEmail: 'digest-noreply@quora.com', subject: 'Top stories' }), 'discard');
  assert.equal(r({ fromName: 'PUC Urgente', fromEmail: 'avisos@puc-rio.br', subject: 'Cardápio da semana' }), 'discard');
  assert.equal(r({ fromName: 'PUC Urgente', fromEmail: 'avisos@puc-rio.br', subject: 'Prédio interditado' }), 'llm');
  assert.equal(r({ fromEmail: 'no-reply@accounts.google.com', subject: 'Novo login no Windows' }), 'discard');
  assert.equal(r({ fromEmail: 'x@bank.com', subject: 'Seu código de verificação' }), 'discard');
  assert.equal(r({ fromEmail: 'nao-responda@jobconvo.com', subject: 'PwC - teste online' }), 'mandatory');
  assert.equal(r({ fromEmail: 'news@mail.gupy.io', subject: 'Vagas para você esta semana' }), 'discard');
  assert.equal(r({ fromEmail: 'rh@empresa.com', subject: 'Retorno', labels: ['Processos seletivos'] }), 'mandatory');
  assert.equal(r({ fromEmail: 'rh@empresa.com', subject: 'Vagas recomendadas', labels: ['Processos seletivos'] }), 'discard');
  assert.equal(r({ fromEmail: 'loja@x.com', subject: 'Promo', category: 'promotions' }), 'discard');
  assert.equal(r({ fromEmail: 'loja@x.com', subject: 'Promo', category: 'promotions', labels: ['Processos seletivos'] }), 'mandatory');
  assert.equal(r({ fromEmail: 'prof@puc-rio.br', subject: 'Prova adiada' }), 'llm');
  assert.equal(r({ fromEmail: 'fake@notgupy.io', subject: 'x' }), 'llm'); // dominio parecido nao conta
  // casos reais da caixa de entrada
  assert.equal(r({ fromEmail: 'noreply-accounts@google.com', subject: 'Você compartilhou alguns dados da sua Conta do Google com gupy.io' }), 'discard');
  assert.equal(r({ fromEmail: 'sugestaovagas@catho.com.br', subject: 'Marcelo, chegou a sua vaga do dia (18/10) para QA' }), 'discard');
  assert.equal(r({ fromEmail: 'no-reply@eureca.me', subject: 'Confirme seu e-mail na Eureca' }), 'discard');
  assert.equal(r({ fromEmail: 'noreply@eureca.me', subject: 'Seu cadastro na Eureca está confirmado. 🚀' }), 'discard');
  assert.equal(r({ fromEmail: 'contact@jobconvo.com', subject: 'Adecco | Mensagem sobre o processo Programa de Estágio PwC Brasil 2027' }), 'mandatory');
  assert.equal(r({ fromEmail: 'rh@myworkday.com', subject: 'Obrigado pelo seu interesse na Empresa!' }), 'mandatory');
  assert.equal(r({ fromEmail: 'moodle-rdc@puc-rio.br', subject: 'Vencimento em segunda-feira, 19 out. 2026, 23:59: Trabalho 1' }), 'llm');
});

test('parseLlmDecisions_ valida ids e normaliza campos', () => {
  const c = load();
  const out = c.parseLlmDecisions_('```json\n{"decisions":[{"id":"a","notify":true,"category":"nota","summary":"Nota G1 de Calculo recebida: 7,0","deadline":"","reason":"nota"},{"id":"zzz","notify":true,"category":"x","summary":"","deadline":"","reason":""}]}\n```', ['a', 'b']);
  assert.deepEqual(Object.keys(out), ['a']);
  assert.equal(out.a.notify, true);
  assert.equal(c.parseLlmDecisions_('nao e json', ['a']), null);
  const bad = c.parseLlmDecisions_('{"decisions":[{"id":"b","notify":"true","category":"inventada","summary":"s","deadline":"","reason":""}]}', ['b']);
  assert.equal(bad.b.category, 'outro');
  assert.equal(bad.b.notify, true);
});

test('payload do template segue o formato da Cloud API', () => {
  const c = load({ props: BASE_PROPS });
  const p = c.buildTemplatePayload_('5521999998888', 'aviso_email', 'pt_BR', ['PwC\n', 'Teste  online', '']);
  assert.equal(p.type, 'template');
  assert.equal(p.template.language.code, 'pt_BR');
  assert.deepEqual(p.template.components[0].parameters.map((x) => x.text), ['PwC', 'Teste online', '-']);
});

test('webhook: registra falha, abre janela e responde comandos so do meu numero', () => {
  const c = load({ props: BASE_PROPS });
  const failed = { entry: [{ changes: [{ value: { statuses: [{ id: 'w1', status: 'failed', errors: [{ code: 130497, title: 'restricted' }] }] } }] }] };
  c.handleWebhookPayload_(failed, '5521999998888');
  assert.equal(JSON.parse(c.__props.store.WA_FAILURES)[0].code, 130497);

  const stranger = { entry: [{ changes: [{ value: { messages: [{ from: '5511000000000', type: 'text', text: { body: 'status' } }] } }] }] };
  assert.equal(c.handleWebhookPayload_(stranger, '5521999998888').replies.length, 0);
  assert.equal(c.__props.store.LAST_INBOUND_TS, undefined);

  const mine = { entry: [{ changes: [{ value: { messages: [{ from: '5521999998888', type: 'text', text: { body: 'Pausar' } }] } }] }] };
  const r = c.handleWebhookPayload_(mine, '5521999998888');
  assert.equal(r.replies.length, 1);
  assert.equal(c.__props.store.PAUSED, 'true');
  assert.ok(c.isServiceWindowOpen_());
});

// ---------- Integracao: uma execucao completa com Gmail, Groq e Meta simulados ----------

function scenario(extraProps, groqHandler) {
  const now = Date.now();
  return load({
    props: Object.assign({}, BASE_PROPS, { LAST_RUN_TS: String(now - 10 * 60 * 1000) }, extraProps),
    threads: [
      { id: 'th1', messages: [{ id: 'm1', from: 'Quora Digest <digest-noreply@quora.com>', subject: 'Top stories', date: now - 60000 }] },
      { id: 'th2', messages: [{ id: 'm2', from: 'JobConvo <nao-responda@jobconvo.com>', subject: 'PwC - Convite para teste online', body: 'Faça o teste até 28/10.', date: now - 60000 }] },
      { id: 'th3', messages: [{ id: 'm3', from: 'Secretaria <notas@puc-rio.br>', subject: 'Nota G1', body: 'Nota da G1 de Cálculo: 7,0', date: now - 60000 }] },
      { id: 'th4', messages: [{ id: 'm4', from: 'Loja <promo@loja.com>', subject: 'Black Friday', date: now - 60000 }], category: 'promotions' },
      { id: 'th5', messages: [{ id: 'm5', from: 'Marcelo <marcelo@example.com>', subject: 'Re: algo', date: now - 60000 }] },
      { id: 'th6', messages: [{ id: 'old', from: 'X <x@x.com>', subject: 'antigo', date: now - 3 * 3600 * 1000 }] }
    ],
    fetch: (url, params) => {
      if (url.includes('groq.com')) return groqHandler(JSON.parse(params.payload));
      return { code: 200, body: JSON.stringify({ messages: [{ id: 'wamid.' + Math.random() }] }) };
    }
  });
}

const goodGroq = (req) => {
  const items = JSON.parse(req.messages[1].content.split('\n').slice(2).join('\n'));
  const decisions = items.map((it) => ({
    id: it.id,
    notify: it.id === 'm3' || it.id === 'm2',
    category: it.id === 'm3' ? 'nota' : 'processo_seletivo',
    summary: it.id === 'm3' ? 'Nota G1 de Cálculo recebida: 7,0' : 'PwC: teste online liberado',
    deadline: it.id === 'm2' ? '28/10' : '',
    reason: 'teste'
  }));
  return { code: 200, body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ decisions }) } }] }) };
};

const waCalls = (c) => c.__calls.fetch.filter((f) => f.url.includes('graph.facebook.com'));

test('modo shadow: so o obrigatorio vai pro WhatsApp; nota fica registrada', () => {
  const c = scenario({ MODE: 'shadow' }, goodGroq);
  const rows = c.runAgentOnce_({});
  const wa = waCalls(c);
  assert.equal(wa.length, 1);
  assert.deepEqual(wa[0].body.template.components[0].parameters.map((p) => p.text), ['JobConvo', 'PwC: teste online liberado', '28/10']);
  const byId = Object.fromEntries(rows.map((r) => [r[1], r[6]]));
  assert.equal(byId.m1, 'descartado');
  assert.equal(byId.m4, 'descartado');
  assert.equal(byId.m3, 'avisaria (modo teste)');
  assert.equal(byId.m5, undefined); // enviado por mim: ignorado
  assert.equal(byId.old, undefined); // fora da janela de busca
  // o que vai para a IA: so remetente, assunto e trecho
  const groqReq = c.__calls.fetch.find((f) => f.url.includes('groq.com')).body;
  const sentItems = JSON.parse(groqReq.messages[1].content.split('\n').slice(2).join('\n'));
  assert.deepEqual(sentItems.map((i) => i.id).sort(), ['m2', 'm3']);
  assert.deepEqual(Object.keys(sentItems[0]).sort(), ['assunto', 'de', 'dicas', 'id', 'recebido', 'trecho']);
});

test('modo live: nota tambem vai; segunda execucao nao repete nada', () => {
  const c = scenario({ MODE: 'live' }, goodGroq);
  c.runAgentOnce_({});
  assert.equal(waCalls(c).length, 2);
  c.runAgentOnce_({});
  assert.equal(waCalls(c).length, 2);
});

test('IA fora do ar: obrigatorio avisa na hora; zona cinza espera e depois avisa por seguranca', () => {
  const c = scenario({ MODE: 'live' }, () => ({ code: 503, body: 'down' }));
  c.runAgentOnce_({});
  assert.equal(waCalls(c).length, 1); // so o PwC
  assert.ok(JSON.parse(c.__props.store.PENDING).m3 === 1);
  c.runAgentOnce_({});
  assert.equal(waCalls(c).length, 1);
  c.runAgentOnce_({});
  assert.equal(waCalls(c).length, 2); // desistiu de esperar a IA
  assert.equal(c.__props.store.PENDING, '{}');
});

test('WhatsApp recusou: aviso vai por e-mail', () => {
  const c = scenario({ MODE: 'live' }, goodGroq);
  c.UrlFetchApp.fetch = (url, params) => {
    const isGroq = url.includes('groq.com');
    const r = isGroq ? goodGroq(JSON.parse(params.payload)) : { code: 400, body: JSON.stringify({ error: { code: 131030, message: 'Recipient not in allowed list' } }) };
    return { getResponseCode: () => r.code, getContentText: () => r.body };
  };
  c.runAgentOnce_({});
  assert.equal(c.__calls.emails.length, 1);
  assert.match(c.__calls.emails[0].body, /131030/);
});

test('janela de 24h aberta: manda texto livre formatado', () => {
  const c = scenario({ MODE: 'shadow', LAST_INBOUND_TS: String(Date.now() - 3600 * 1000) }, goodGroq);
  c.runAgentOnce_({});
  const wa = waCalls(c);
  assert.equal(wa[0].body.type, 'text');
  assert.match(wa[0].body.text.body, /Processo seletivo.*PwC: teste online liberado/);
  assert.match(wa[0].body.text.body, /Prazo: 28\/10/);
});

test('simulacao (dryRun) nao envia nem marca nada', () => {
  const c = scenario({ MODE: 'live' }, goodGroq);
  const rows = c.runAgentOnce_({ dryRun: true, sinceMs: Date.now() - 24 * 3600 * 1000 });
  assert.equal(waCalls(c).length, 0);
  assert.equal(c.__props.store.PROCESSED_IDS, undefined);
  assert.ok(rows.some((r) => r[1] === 'old'));
  assert.ok(c.__calls.rows.Simulacao.length > 1);
});

test('limite por execucao agrupa o excesso em um aviso so', () => {
  const now = Date.now();
  const threads = [];
  for (let i = 0; i < 9; i++) threads.push({ id: 't' + i, messages: [{ id: 'j' + i, from: 'Gupy <a@gupy.io>', subject: 'Etapa ' + i, date: now - 1000 }] });
  const c = load({
    props: Object.assign({}, BASE_PROPS, { LAST_RUN_TS: String(now - 600000), MAX_NOTIFICATIONS_PER_RUN: '6' }),
    threads,
    fetch: (url, params) => (url.includes('groq.com') ? goodGroq(JSON.parse(params.payload)) : { code: 200, body: '{"messages":[{"id":"w"}]}' })
  });
  c.runAgentOnce_({});
  const wa = waCalls(c);
  assert.equal(wa.length, 7);
  assert.match(wa[6].body.template.components[0].parameters[1].text, /^\+3 outros avisos/);
});

test('provedor Green API: texto livre para numero@c.us, sem template', () => {
  const c = scenario({ MODE: 'shadow', WA_PROVIDER: 'greenapi', GREEN_API_URL: 'https://7103.api.greenapi.com/', GREEN_ID_INSTANCE: '7103', GREEN_API_TOKEN: 'tok' }, goodGroq);
  c.UrlFetchApp.fetch = (url, params) => {
    c.__calls.fetch.push({ url, body: JSON.parse(params.payload) });
    const r = url.includes('groq.com') ? goodGroq(JSON.parse(params.payload)) : { code: 200, body: '{"idMessage":"ABC"}' };
    return { getResponseCode: () => r.code, getContentText: () => r.body };
  };
  c.runAgentOnce_({});
  const green = c.__calls.fetch.filter((f) => f.url.includes('greenapi.com'));
  assert.equal(green.length, 1);
  assert.equal(green[0].url, 'https://7103.api.greenapi.com/waInstance7103/sendMessage/tok');
  assert.equal(green[0].body.chatId, '5521999998888@c.us');
  assert.match(green[0].body.message, /PwC: teste online liberado/);
});

test('provedor TextMeBot: GET com recipient, apikey e texto codificados', () => {
  const c = scenario({ MODE: 'shadow', WA_PROVIDER: 'textmebot', TEXTMEBOT_API_KEY: 'k3y' }, goodGroq);
  const calls = [];
  c.UrlFetchApp.fetch = (url, params) => {
    calls.push(url);
    const r = url.includes('groq.com') ? goodGroq(JSON.parse(params.payload)) : { code: 200, body: 'Success! Message sent' };
    return { getResponseCode: () => r.code, getContentText: () => r.body };
  };
  c.runAgentOnce_({});
  const tmb = calls.filter((u) => u.includes('textmebot.com'));
  assert.equal(tmb.length, 1);
  const u = new URL(tmb[0]);
  assert.equal(u.searchParams.get('recipient'), '+5521999998888');
  assert.equal(u.searchParams.get('apikey'), 'k3y');
  assert.match(u.searchParams.get('text'), /PwC: teste online liberado/);
  assert.deepEqual([...c.requiredProps_()], ['TEXTMEBOT_API_KEY', 'WA_TO', 'GROQ_API_KEY']);
});

test('provedor TextMeBot: erro no corpo vira falha e cai no e-mail', () => {
  const c = scenario({ MODE: 'shadow', WA_PROVIDER: 'textmebot', TEXTMEBOT_API_KEY: 'k3y' }, goodGroq);
  c.UrlFetchApp.fetch = (url, params) => {
    const r = url.includes('groq.com') ? goodGroq(JSON.parse(params.payload)) : { code: 200, body: 'Error: WhatsApp not linked' };
    return { getResponseCode: () => r.code, getContentText: () => r.body };
  };
  c.runAgentOnce_({});
  assert.equal(c.__calls.emails.length, 1);
  assert.match(c.__calls.emails[0].body, /TextMeBot/);
});

test('canal ntfy: JSON na raiz com topico, titulo = resumo, prioridade e link do Gmail', () => {
  const c = scenario({ MODE: 'shadow', WA_PROVIDER: 'ntfy', NTFY_TOPIC: 'agente-xyz' }, goodGroq);
  const calls = [];
  c.UrlFetchApp.fetch = (url, params) => {
    calls.push({ url, body: JSON.parse(params.payload) });
    const r = url.includes('groq.com') ? goodGroq(JSON.parse(params.payload)) : { code: 200, body: '{"id":"abc"}' };
    return { getResponseCode: () => r.code, getContentText: () => r.body };
  };
  c.runAgentOnce_({});
  const n = calls.filter((x) => x.url === 'https://ntfy.sh');
  assert.equal(n.length, 1);
  assert.equal(n[0].body.topic, 'agente-xyz');
  assert.equal(n[0].body.title, 'PwC: teste online liberado');
  assert.match(n[0].body.message, /De: JobConvo\nPrazo: 28\/10/);
  assert.equal(n[0].body.priority, 5);
  assert.deepEqual(n[0].body.tags, ['briefcase']);
  assert.equal(n[0].body.click, 'https://mail.google.com/mail/u/0/#inbox/th2');
  assert.deepEqual([...c.requiredProps_()], ['NTFY_TOPIC', 'GROQ_API_KEY']);
});

test('canal ntfy: 429 tenta de novo uma vez; texto livre sem asteriscos', () => {
  const c = load({ props: Object.assign({}, BASE_PROPS, { WA_PROVIDER: 'ntfy', NTFY_TOPIC: 't' }) });
  let n = 0;
  const bodies = [];
  c.UrlFetchApp.fetch = (url, params) => {
    n++; bodies.push(JSON.parse(params.payload));
    const code = n === 1 ? 429 : 200;
    return { getResponseCode: () => code, getContentText: () => '{}' };
  };
  const res = c.waSendText_('☀️ *Resumo*\nok');
  assert.equal(res.ok, true);
  assert.equal(n, 2);
  assert.equal(bodies[0].message, '☀️ Resumo\nok');
});

test('listas pessoais: prioritario sempre vai pra IA com dica; silenciado e descartado', () => {
  const c = load({ props: { PRIORITY_SENDERS: 'autosau@puc-rio.br, orientadora.com', MUTED_SENDERS: 'catho.com.br;jira@lab.atlassian.net' } });
  const r = (o) => c.applyRules_(Object.assign({ fromName: '', fromEmail: '', subject: '', labels: [], category: '' }, o));
  const p = r({ fromEmail: 'autosau@puc-rio.br', subject: 'Seu código de verificação', category: 'promotions' });
  assert.equal(p.action, 'llm');
  assert.equal(p.priority, true);
  assert.equal(r({ fromEmail: 'ana@mail.orientadora.com', subject: 'x' }).priority, true); // dominio e subdominio
  assert.equal(r({ fromEmail: 'outro@puc-rio.br', subject: 'x' }).priority, undefined);
  assert.equal(r({ fromEmail: 'avisovagas@catho.com.br', subject: 'Trabalhe em Rio de Janeiro: 1 nova vaga' }).rule, 'Remetente silenciado');
  assert.equal(r({ fromEmail: 'jira@lab.atlassian.net', subject: '[JIRA] Review' }).action, 'discard');
  assert.equal(r({ fromEmail: 'jira@outro.atlassian.net', subject: '[JIRA] Review' }).action, 'llm');
  // processo seletivo continua na frente das listas
  assert.equal(r({ fromEmail: 'x@catho.com.br', subject: 'Entrevista', labels: ['Processos seletivos'] }).action, 'mandatory');
  // marketing de plataforma de vaga
  assert.equal(r({ fromEmail: 'no-reply@gupy.com.br', subject: 'Marcelo, que tal destacar seu currículo para novas vagas?' }).action, 'discard');
  // lista no arquivo privado (variavel global) quando nao ha propriedade
  const g = load();
  g.LISTA_PRIORITARIA = ['prof@puc-rio.br'];
  assert.equal(g.applyRules_({ fromEmail: 'prof@puc-rio.br', subject: 'x', labels: [], category: '' }).priority, true);
});

test('remetente prioritario chega na IA com a dica; o conteudo decide', () => {
  const c = scenario({ MODE: 'live', PRIORITY_SENDERS: 'notas@puc-rio.br' }, goodGroq);
  c.runAgentOnce_({});
  const groqReq = c.__calls.fetch.find((f) => f.url.includes('groq.com')).body;
  const sent = JSON.parse(groqReq.messages[1].content.split('\n').slice(2).join('\n'));
  assert.ok(sent.find((i) => i.id === 'm3').dicas.some((h) => /prioritario/.test(h)));
  assert.ok(!sent.find((i) => i.id === 'm2').dicas.some((h) => /prioritario/.test(h)));
});

test('Groq 429: espera o que o Groq pedir e tenta de novo ate 2 vezes', () => {
  let n = 0;
  const waits = [];
  const c = load({
    props: { GROQ_API_KEY: 'k' },
    fetch: () => (++n === 1
      ? { code: 429, body: 'rate limit', headers: { 'retry-after': '2' } }
      : n === 2
        ? { code: 429, body: '{"error":{"message":"Rate limit reached ... Please try again in 13.785s."}}' }
        : { code: 200, body: JSON.stringify({ choices: [{ message: { content: '{"decisions":[]}' } }] }) })
  });
  c.Utilities.sleep = (ms) => waits.push(ms);
  const res = c.callGroq_('openai/gpt-oss-120b', 'oi', true);
  assert.equal(res.ok, true);
  assert.equal(n, 3);
  assert.deepEqual(waits, [3000, 14785]);
  assert.equal(c.__calls.fetch[0].body.max_completion_tokens, 4096);
});

test('simulateSenders: testa so os remetentes pedidos, nao mexe em nada e continua de onde parou', () => {
  const now = Date.now();
  const groq = (req) => {
    const items = JSON.parse(req.messages[1].content.split('\n').slice(2).join('\n'));
    const decisions = items.map((it) => ({ id: it.id, notify: /cancelada/.test(it.assunto), category: 'academico',
      summary: 'ENG4040: aula cancelada', deadline: '', reason: 'so material' }));
    return { code: 200, body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ decisions }) } }] }) };
  };
  const c = load({
    props: Object.assign({}, BASE_PROPS, { SIM_SENDERS: 'autosau@puc-rio.br', PRIORITY_SENDERS: 'autosau@puc-rio.br' }),
    threads: [
      { id: 't1', messages: [{ id: 'a1', from: 'Avisos <autosau@puc-rio.br>', subject: 'Aula cancelada', date: now - 86400000 }] },
      { id: 't2', messages: [{ id: 'a2', from: 'Avisos <autosau@puc-rio.br>', subject: 'Exercícios de revisão', date: now - 2 * 86400000 },
        { id: 'a3', from: 'Marcelo <marcelo@example.com>', subject: 'Re: Exercícios de revisão', date: now - 86400000 }] },
      { id: 't3', messages: [{ id: 'q1', from: 'Quora <digest@quora.com>', subject: 'Top', date: now - 86400000 }] }
    ],
    fetch: (url, params) => (url.includes('groq.com') ? groq(JSON.parse(params.payload)) : { code: 500, body: 'nao devia chamar' })
  });
  c.simulateSenders();
  const rows = c.__calls.rows['Teste remetentes'];
  assert.deepEqual(rows.slice(1).map((r) => [r[1], r[6]]).sort(), [['a1', 'AVISA'], ['a2', 'quieto']]);
  assert.equal(c.__calls.fetch.filter((f) => !f.url.includes('groq.com')).length, 0); // nada enviado
  assert.equal(c.__calls.emails.length, 0);
  assert.deepEqual(c.__threads.map((t) => t.labels.length), [0, 0, 0]); // nada marcado
  assert.equal(c.__props.store.PROCESSED_IDS, undefined);
  const groqCalls = c.__calls.fetch.length;
  c.simulateSenders(); // segunda rodada: tudo ja testado
  assert.equal(c.__calls.fetch.length, groqCalls);
  assert.equal(rows.length, 3);
});

test('canal gmail: aviso vira mensagem nova com marcador Avisos, fora da caixa de entrada', () => {
  const imports = [];
  let labelCalls = 0;
  const c = scenario({ MODE: 'live', WA_PROVIDER: 'gmail' }, goodGroq);
  c.UrlFetchApp.fetch = (url, params) => {
    c.__calls.fetch.push({ url, params });
    if (url.includes('groq.com')) {
      const r = goodGroq(JSON.parse(params.payload));
      return { getResponseCode: () => r.code, getContentText: () => r.body, getHeaders: () => ({}) };
    }
    assert.equal(params.headers.Authorization, 'Bearer oauth-token');
    let body = '{}';
    if (url.endsWith('/labels') && params.method === 'get') { labelCalls++; body = JSON.stringify({ labels: [{ id: 'INBOX', name: 'INBOX' }] }); }
    if (url.endsWith('/labels') && params.method === 'post') { labelCalls++; body = JSON.stringify({ id: 'Label_7', name: 'Avisos' }); }
    if (url.includes('/messages/import')) {
      assert.match(url, /neverMarkSpam=true/);
      imports.push(JSON.parse(params.payload));
      body = JSON.stringify({ id: 'msg' + imports.length });
    }
    return { getResponseCode: () => 200, getContentText: () => body, getHeaders: () => ({}) };
  };
  const rows = c.runAgentOnce_({});
  assert.equal(imports.length, 2); // processo seletivo + nota
  assert.equal(labelCalls, 2); // procura e cria o marcador uma vez so
  imports.forEach((imp) => assert.deepEqual(imp.labelIds, ['UNREAD', 'Label_7']));
  const mime = Buffer.from(imports[1].raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  assert.match(mime, /^From: "Secretaria \(Agente\)" <agente@agente-de-emails\.invalid>/m);
  assert.match(mime, /^Subject: =\?UTF-8\?B\?/m); // "Cálculo" tem acento
  const body = Buffer.from(mime.split('\r\n\r\n')[1], 'base64').toString('utf8');
  assert.match(body, /Nota G1 de Cálculo recebida: 7,0/);
  assert.match(body, /De: Secretaria <notas@puc-rio\.br>/);
  assert.match(body, /#all\/th3/);
  assert.ok(rows.some((r) => r[1] === 'm3' && r[11] === 'enviado'));
  // resumo diario: caixa de entrada, sem o marcador que toca
  c.dailyDigest();
  assert.deepEqual(imports[2].labelIds, ['UNREAD', 'INBOX']);
});

test('IA devolveu so parte dos ids: pergunta de novo uma vez pelos que faltaram', () => {
  const asked = [];
  const c = load({
    props: { GROQ_API_KEY: 'k' },
    fetch: (url, params) => {
      const req = JSON.parse(params.payload);
      const items = JSON.parse(req.messages[1].content.split('\n').slice(2).join('\n'));
      asked.push(items.map((i) => i.id));
      const only = asked.length === 1 ? items.slice(0, 1) : items; // 1a resposta incompleta
      const decisions = only.map((i) => ({ id: i.id, notify: false, category: 'academico', summary: 's', deadline: '', reason: 'r' }));
      return { code: 200, body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ decisions }) } }] }) };
    }
  });
  const mk = (id) => ({ id, fromName: 'X', fromEmail: 'x@x.com', subject: 's', snippet: '', date: new Date() });
  const out = c.classifyBatch_([mk('a'), mk('b'), mk('c')]);
  assert.deepEqual(Object.keys(out).sort(), ['a', 'b', 'c']);
  assert.deepEqual(asked, [['a', 'b', 'c'], ['b', 'c']]);
  assert.match(c.__calls.fetch[0].body.messages[1].content, /exatamente 3 decisoes/);
});
