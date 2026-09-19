/**
 * Tool action handlers (extracted from routes/ia.js — debt reduction).
 * Behavior unchanged; runToolBatch wraps timeout/HITL/logs.
 */
const helpers = require('./handlers/helpers');
const finance = require('./handlers/finance');
const rotina = require('./handlers/rotina');
const ops = require('./handlers/ops');
const memory = require('./handlers/memory');
const dev = require('./handlers/dev');
const research = require('./handlers/research');
const creative = require('./handlers/creative');

async function executarAcoesCorpo(acoes, userId) {
  if (!Array.isArray(acoes) || !acoes.length) return [];
  const ctx = helpers.createHandlerContext(userId);
  const feitos = [];
  for (const acao of acoes.slice(0, 8)) {
    const tipo = acao && acao.tipo;
    try {
      let r = await finance.handle(acao, ctx);
      if (!r) r = await rotina.handle(acao, ctx);
      if (!r) r = await ops.handle(acao, ctx);
      if (!r) r = await memory.handle(acao, ctx);
      if (!r) r = await dev.handle(acao, ctx);
      if (!r) r = await research.handle(acao, ctx);
      if (!r) r = await creative.handle(acao, ctx);
      if (!r) r = { tipo: tipo || 'desconhecido', ok: false, erro: 'tipo não suportado' };
      feitos.push(r);
    } catch (e) {
      feitos.push({ tipo, ok: false, erro: e.message });
    }
  }
  return feitos;
}

module.exports = { executarAcoesCorpo };
