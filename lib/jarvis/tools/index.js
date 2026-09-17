/**
 * Tool batch executor (Phase 3–5) — HITL gate for high-risk tools.
 */
const { invalidateUserCaches } = require('../snapshot-cache');
const {
  resolveToolMeta,
  MAX_TOOLS_PER_TURN
} = require('./registry');
const {
  hitlEnabled,
  splitByApproval,
  holdForApproval
} = require('../permissions/engine');

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
 * @param {boolean} [opts.skipHitl] — after user approved
 */
async function runToolBatch({
  acoes,
  userId,
  executeAll,
  skipHitl = false,
  channel = null
} = {}) {
  if (!Array.isArray(acoes) || acoes.length === 0) return [];

  const sliced = acoes.slice(0, MAX_TOOLS_PER_TURN).filter(Boolean);
  const { auto, gated } =
    !skipHitl && hitlEnabled()
      ? splitByApproval(sliced)
      : { auto: sliced, gated: [] };

  for (const a of sliced) {
    const m = resolveToolMeta(a && a.tipo);
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

  if (gated.length) {
    console.log(
      JSON.stringify({
        tag: 'jarvis.tool',
        event: 'hitl_hold',
        userId,
        tipos: gated.map((a) => a.tipo),
        autoCount: auto.length
      })
    );
  }

  const toRun = auto;
  const metas = toRun.map((a) => resolveToolMeta(a && a.tipo));
  const batchTimeout = Math.max(
    30000,
    ...(metas.length ? metas.map((m) => m.timeoutMs || 30000) : [30000])
  );

  const t0 = Date.now();
  let feitos = [];
  if (toRun.length) {
    try {
      feitos = await withTimeout(
        executeAll(toRun, userId),
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
  }

  const results = Array.isArray(feitos) ? [...feitos] : [];

  if (gated.length) {
    const held = await holdForApproval(userId, gated, { channel });
    results.push(...held);
  }

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
        pending_approval: !!(f && f.pending_approval),
        approval_id: (f && f.approval_id) || null,
        erro: f && f.ok === false && !f.pending_approval ? f.erro || null : null,
        userId
      })
    );
  }

  const algumOk = results.some((f) => f && f.ok);
  const mutouProjetos = results.some((f) => {
    if (!f || !f.ok) return false;
    return resolveToolMeta(f.tipo).mutatesProjetos;
  });
  if (algumOk) {
    invalidateUserCaches(userId, { projetos: mutouProjetos });
  }

  console.log(
    JSON.stringify({
      tag: 'jarvis.tool',
      event: 'batch',
      userId,
      durationMs: Date.now() - t0,
      count: results.length,
      ok: results.filter((f) => f && f.ok).length,
      fail: results.filter((f) => f && f.ok === false && !f.pending_approval).length,
      pending: results.filter((f) => f && f.pending_approval).length,
      hitl: hitlEnabled() && !skipHitl
    })
  );

  return results;
}

module.exports = {
  runToolBatch,
  withTimeout
};
