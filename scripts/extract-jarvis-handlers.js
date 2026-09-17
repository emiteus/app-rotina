/** One-shot: extract executarAcoesCorpo from routes/ia.js → lib/jarvis/tools/handlers.js */
const fs = require('fs');
const path = 'routes/ia.js';
const lines = fs.readFileSync(path, 'utf8').split(/\r?\n/);
const corpo = lines.slice(1019, 2075).join('\n');
const header = `/**
 * Tool action handlers (extracted from routes/ia.js — debt reduction).
 * Behavior unchanged; runToolBatch wraps timeout/HITL/logs.
 */
const { v4: uuid } = require('uuid');
const { all, run, get } = require('../../db');
const { checkinHabito } = require('../../habitos');
const { hojeStr, ymAtual, dataResetSql } = require('../../datas');
const { persistirHistoricoDia } = require('../../historico');
const plano = require('../../plano-financeiro');
const openfinanceRouter = require('../../../routes/openfinance');

`;
const out =
  header +
  corpo +
  '\n\nmodule.exports = { executarAcoesCorpo };\n';
fs.writeFileSync('lib/jarvis/tools/handlers.js', out);

const replacement = `async function executarAcoes(acoes, userId, opts = {}) {
  if (!Array.isArray(acoes) || acoes.length === 0) return [];
  const { executarAcoesCorpo } = require('../lib/jarvis/tools/handlers');
  return runToolBatch({
    acoes,
    userId,
    executeAll: executarAcoesCorpo,
    skipHitl: !!opts.skipHitl
  });
}`;

const before = lines.slice(0, 1008);
const after = lines.slice(2075);
const next = [...before, replacement, '', ...after].join('\n');
fs.writeFileSync(path, next);
console.log('ok handlers', out.split(/\n/).length, 'ia', next.split(/\n/).length);
