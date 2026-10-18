/**
 * Estado do agente: e-mails ja processados, pendentes, estatisticas e planilha de log.
 *
 * Por que guardar IDs de mensagem e nao usar marcador do Gmail? Marcadores ficam na
 * CONVERSA inteira; uma resposta nova numa conversa ja marcada passaria despercebida.
 */

var PROCESSED_KEY = 'PROCESSED_IDS';
var PROCESSED_MAX = 300;               // cabe folgado no limite de ~9 KB por propriedade
var PROCESSED_TTL_MS = 6 * 3600 * 1000; // so precisa cobrir a sobreposicao entre execucoes

/** Le "id:minuto,id:minuto" -> { id: minuto } */
function loadProcessed_() {
  var raw = PropertiesService.getScriptProperties().getProperty(PROCESSED_KEY) || '';
  var map = {};
  raw.split(',').forEach(function (pair) {
    var p = pair.split(':');
    if (p[0]) map[p[0]] = Number(p[1] || 0);
  });
  return map;
}

function saveProcessed_(map) {
  var minNow = Math.floor(Date.now() / 60000);
  var ttlMin = PROCESSED_TTL_MS / 60000;
  var entries = Object.keys(map)
    .map(function (id) { return [id, map[id]]; })
    .filter(function (e) { return minNow - e[1] <= ttlMin; })
    .sort(function (a, b) { return b[1] - a[1]; })
    .slice(0, PROCESSED_MAX);
  setState(PROCESSED_KEY, entries.map(function (e) { return e[0] + ':' + e[1]; }).join(','));
}

function markProcessed_(map, id) {
  map[id] = Math.floor(Date.now() / 60000);
}

/** Estatisticas acumuladas desde o ultimo resumo diario. */
function bumpStats_(field, sample) {
  var s = getJsonState('STATS', { since: Date.now() });
  s[field] = (s[field] || 0) + 1;
  if (sample && field === 'shadow') {
    s.shadowSamples = (s.shadowSamples || []).concat([oneLine_(sample, 90)]).slice(-5);
  }
  setJsonState('STATS', s);
}

/** Planilha de log (criada no setup). Uma linha por e-mail analisado. */
var LOG_HEADER = ['Data/hora', 'ID', 'De', 'Assunto', 'Camada', 'Regra', 'Decisao', 'Categoria', 'Resumo', 'Prazo', 'Motivo da IA', 'Envio'];

function getLogSpreadsheet_() {
  var id = cfg('LOG_SHEET_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) { /* apagada: cria outra */ }
  }
  var ss = SpreadsheetApp.create('Agente de Emails - Log');
  setState('LOG_SHEET_ID', ss.getId());
  return ss;
}

function getLogSheet_(name) {
  name = name || 'Log';
  var ss = getLogSpreadsheet_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    var first = ss.getSheets()[0];
    sh = (first.getLastRow() === 0 && first.getName() !== 'Log' && first.getName() !== 'Simulacao')
      ? first.setName(name)
      : ss.insertSheet(name);
  }
  if (sh.getLastRow() === 0) {
    sh.appendRow(LOG_HEADER);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, LOG_HEADER.length).setFontWeight('bold');
  }
  return sh;
}

function appendLogRows_(rows, sheetName) {
  if (!rows.length) return;
  try {
    var sh = getLogSheet_(sheetName);
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, LOG_HEADER.length).setValues(rows);
    var extra = sh.getLastRow() - 5001; // guarda as ultimas ~5000 linhas
    if (extra > 0) sh.deleteRows(2, extra);
  } catch (e) {
    console.error('Nao consegui gravar o log: ' + e);
  }
}
