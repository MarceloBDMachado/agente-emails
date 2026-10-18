// Carrega os arquivos .gs num contexto isolado com servicos do Google simulados.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src');

function makeProps(initial) {
  const store = Object.assign({}, initial || {});
  return {
    store,
    getProperty: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setProperty: (k, v) => { store[k] = String(v); },
    deleteProperty: (k) => { delete store[k]; }
  };
}

function makeMessage(m) {
  const msg = {
    getId: () => m.id,
    getFrom: () => m.from,
    getTo: () => m.to || 'marcelo@example.com',
    getCc: () => m.cc || '',
    getSubject: () => m.subject,
    getPlainBody: () => m.body || '',
    getDate: () => new Date(m.date || Date.now()),
    getHeader: (h) => (m.headers || {})[h] || '',
    isDraft: () => false,
    isInTrash: () => false,
    isInInbox: () => true
  };
  return msg;
}

function makeThread(t) {
  const thread = {
    labels: (t.labels || []).slice(),
    getId: () => t.id,
    getLabels: () => thread.labels.map((n) => ({ getName: () => n })),
    getMessages: () => t.messages.map(makeMessage),
    addLabel: (l) => { thread.labels.push(l.getName()); }
  };
  return thread;
}

/**
 * Cria o contexto. opts:
 *   props: propriedades iniciais
 *   threads: [{ id, labels, category, messages: [{ id, from, subject, body, date, headers }] }]
 *   fetch(url, params) -> { code, body }   (simula UrlFetchApp)
 */
function load(opts) {
  opts = opts || {};
  const props = makeProps(opts.props);
  const threads = (opts.threads || []).map((t) => Object.assign(makeThread(t), { _category: t.category }));
  const calls = { fetch: [], emails: [], rows: {} };

  const sheets = {};
  const makeSheet = (name) => {
    const rows = [];
    calls.rows[name] = rows;
    const sh = {
      getName: () => name,
      setName: (n) => { delete sheets[name]; name = n; sheets[n] = sh; calls.rows[n] = rows; return sh; },
      getLastRow: () => rows.length,
      appendRow: (r) => rows.push(r),
      setFrozenRows: () => {},
      getRange: (r, c, n, w) => ({
        setFontWeight: () => {},
        setValues: (vals) => vals.forEach((v) => rows.push(v)),
        getValues: () => rows.slice(r - 1, r - 1 + n).map((row) => row.slice(c - 1, c - 1 + w))
      }),
      deleteRows: (start, n) => rows.splice(start - 1, n),
      getParent: () => ss
    };
    sheets[name] = sh;
    return sh;
  };
  const ss = {
    getId: () => 'sheet123',
    getUrl: () => 'https://docs.google.com/spreadsheets/d/sheet123',
    getSheets: () => Object.values(sheets),
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => makeSheet(n)
  };
  makeSheet('Sheet1');

  const ctx = {
    console: opts.quiet === false ? console : { log() {}, warn() {}, error() {} },
    JSON, Math, Date, String, Number, Object, Array, RegExp, Error, Boolean, Buffer,
    PropertiesService: { getScriptProperties: () => props },
    Session: {
      getScriptTimeZone: () => 'America/Sao_Paulo',
      getEffectiveUser: () => ({ getEmail: () => 'marcelo@example.com' })
    },
    Utilities: {
      formatDate: (d) => new Date(d).toISOString().slice(0, 16).replace('T', ' '),
      sleep: () => {},
      getUuid: () => 'uuid-1',
      Charset: { UTF_8: 'UTF-8' },
      base64Encode: (s) => Buffer.from(String(s), 'utf8').toString('base64'),
      base64EncodeWebSafe: (s) => Buffer.from(String(s), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_')
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    ContentService: { createTextOutput: (t) => ({ text: t }) },
    ScriptApp: { getProjectTriggers: () => [], deleteTrigger: () => {}, newTrigger: () => ({}), getOAuthToken: () => 'oauth-token' },
    SpreadsheetApp: { openById: () => ss, create: () => ss },
    UrlFetchApp: {
      fetch: (url, params) => {
        calls.fetch.push({ url, params, body: params && params.payload ? JSON.parse(params.payload) : null });
        const r = (opts.fetch || (() => ({ code: 200, body: '{}' })))(url, params);
        return { getResponseCode: () => r.code, getContentText: () => r.body, getHeaders: () => r.headers || {} };
      }
    },
    GmailApp: {
      search: (q) => {
        const cat = (q.match(/category:(\w+)/) || [])[1];
        const from = (q.match(/from:(\S+)/) || [])[1];
        return threads.filter((t) => (!cat || t._category === cat) &&
          (!from || t.getMessages().some((m) => m.getFrom().toLowerCase().includes(from))));
      },
      getMessagesForThreads: (ts) => ts.map((t) => t.getMessages()),
      getAliases: () => [],
      getMessageById: (id) => {
        for (const t of threads) for (const m of t.getMessages()) if (m.getId() === id) return Object.assign(m, { getThread: () => t });
        return null;
      },
      getThreadById: (id) => threads.find((t) => t.getId() === id),
      getUserLabelByName: (n) => ({ getName: () => n }),
      createLabel: (n) => ({ getName: () => n }),
      sendEmail: (to, subject, body) => calls.emails.push({ to, subject, body })
    }
  };
  vm.createContext(ctx);
  for (const f of fs.readdirSync(SRC).filter((f) => f.endsWith('.gs')).sort()) {
    vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
  }
  ctx.__props = props;
  ctx.__calls = calls;
  ctx.__threads = threads;
  return ctx;
}

module.exports = { load };
