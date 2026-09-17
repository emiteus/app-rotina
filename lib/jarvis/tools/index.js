/**
 * Tool batch executor (Phase 3).
 * Wraps legacy handlers: timeout per tool, structured logs, cache invalidate.
 */
const { invalidateProjetosCache } = require('../snapshot-cache');
const {
  resolveToolMeta,
  MAX_TOOLS_PER_TURN
} = require('./registry');

function withTimeout(promise, ms, label) {
  if (!ms || ms <= 0) return promise;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`timeout ${label || 'tool'} após ${ms}ms`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * @param {object} opts
 * @param {Array} opts.acoes
 * @param {string} opts.userId
 * @param {(acoes: Array, userId: string) => Promise<Array>} opts.executeAll
 *   Legacy batch handler (current executarAcoes body). Receives already-sliced list.
 */
async function runToolBatch({ acoes, userId, executeAll }) {
  if (!Array.isArray(acoes) || acoes.length === 0) return [];

  const sliced = acoes.slice(0, MAX_TOOLS_PER_TURN).filter(Boolean);
  const metas = sliced.map((a) => resolveToolMeta(a && a.tipo));

  // Soft signal: unregistered tipos still run (compat) but are logged.
  for (const m of metas) {
    if (!m.registered) {
      console.log(
        JSON.stringify({
          tag: 'jarvis.tool',
          event: 'unregistered',
          tipo: m.name,
          userId
        })
      );
    }
  }

  // Per-tool timeout: race the whole legacy batch against the max timeout
  // of tools in this turn (legacy handler is still one sequential loop).
  const batchTimeout = Math.max(
    30000,
    ...metas.map((m) => m.timeoutMs || 30000)
  );

  const t0 = Date.now();
  let feitos;
  try {
    feitos = await withTimeout(
      executeAll(sliced, userId),
      batchTimeout,
      'tool-batch'
    );
  } catch (err) {
    console.log(
      JSON.stringify({
        tag: 'jarvis.tool',
        event: 'batch_fail',
        userId,
        durationMs: Date.now() - t0,
        error: err.message,
        tipos: metas.map((m) => m.name)
      })
    );
    throw err;
  }

  const results = Array.isArray(feitos) ? feitos : [];

  for (const f of results) {
    const meta = resolveToolMeta(f && f.tipo);
    console.log(
      JSON.stringify({
        tag: 'jarvis.tool',
        tipo: f && f.tipo,
        ok: !!(f && f.ok),
        risk: meta.risk,
        registered: meta.registered,
        ownerOnly: meta.ownerOnly,
        needsApproval: meta.needsApproval,
        erro: f && f.ok === false ? f.erro || null : null,
        userId
      })
    );
  }

  const mutou = results.some((f) => {
    if (!f || !f.ok) return false;
    return resolveToolMeta(f.tipo).mutatesProjetos;
  });
  if (mutou) invalidateProjetosCache(userId);

  console.log(
    JSON.stringify({
      tag: 'jarvis.tool',
      event: 'batch',
      userId,
      durationMs: Date.now() - t0,
      count: results.length,
      ok: results.filter((f) => f && f.ok).length,
      fail: results.filter((f) => f && f.ok === false).length
    })
  );

  return results;
}

module.exports = {
  runToolBatch,
  withTimeout
};
