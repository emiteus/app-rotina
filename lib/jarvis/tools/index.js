/**
 * Tool batch executor (Phase 3–5) — owner gate + HITL for high-risk tools.
 */
const { invalidateUserCaches } = require('../snapshot-cache');
const {
  resolveToolMeta,
  MAX_TOOLS_PER_TURN
} = require('./registry');
const {
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
 * Gate único pra TOOL_DEFS.ownerOnly — não depende de cada handler lembrar.
 * @returns {{ allowed: Array, blocked: Array }}
 */
async function splitByOwner(userId, acoes) {
  const needOwner = [];
  const free = [];
  for (const a of acoes || []) {
    if (resolveToolMeta(a && a.tipo).ownerOnly) needOwner.push(a);
    else free.push(a);
  }
  if (!needOwner.length) return { allowed: acoes || [], blocked: [] };

  let isOwner = false;
  try {
    const { requireLib } = require('../host');
    const { isPlanoOwnerUserId } = requireLib('plano-owner');
    isOwner = !!(await isPlanoOwnerUserId(userId));
  } catch (e) {
    console.warn(
      JSON.stringify({
        tag: 'jarvis.tool',
        event: 'owner_gate_check_fail',
        erro: String((e && e.message) || e).slice(0, 120)
      })
    );
    isOwner = false;
  }

  if (isOwner) return { allowed: acoes || [], blocked: [] };

  console.log(
    JSON.stringify({
      tag: 'jarvis.tool',
      event: 'owner_blocked',
      userId,
      tipos: needOwner.map((a) => a.tipo)
    })
  );

  return {
    allowed: free,
    blocked: needOwner.map((a) => ({
      tipo: a.tipo,
      ok: false,
      erro: 'só owner',
      owner_blocked: true
    }))
  };
}

/**
 * Isolation lite: se o agente tem toolPrefixes, só essas tools passam.
 * default/finance/ops/rotina (sem prefixes) → sem filtro.
 * @returns {{ allowed: Array, blocked: Array }}
 */
function splitByAgentScope(acoes, agentId) {
  if (!agentId || !Array.isArray(acoes) || !acoes.length) {
    return { allowed: acoes || [], blocked: [] };
  }
  let prefixes = [];
  try {
    const { getAgent } = require('../agents/registry');
    prefixes = getAgent(agentId).toolPrefixes || [];
  } catch (_) {
    return { allowed: acoes, blocked: [] };
  }
  if (!prefixes.length) return { allowed: acoes, blocked: [] };

  const allowed = [];
  const blocked = [];
  for (const a of acoes) {
    const tipo = String((a && a.tipo) || '');
    if (prefixes.some((p) => tipo.startsWith(p))) allowed.push(a);
    else {
      blocked.push({
        tipo: a.tipo,
        ok: false,
        erro: `agente ${agentId} só permite ${prefixes.join(', ')}*`,
        agent_scope_blocked: true
      });
    }
  }
  if (blocked.length) {
    console.log(
      JSON.stringify({
        tag: 'jarvis.tool',
        event: 'agent_scope_blocked',
        agentId,
        prefixes,
        tipos: blocked.map((b) => b.tipo)
      })
    );
  }
  return { allowed, blocked };
}

/**
 * @param {object} opts
 * @param {Array} opts.acoes
 * @param {string} opts.userId
 * @param {(acoes: Array, userId: string) => Promise<Array>} opts.executeAll
 * @param {boolean} [opts.skipHitl] — after user approved
 * @param {string} [opts.channel]
 */
async function runToolBatch({
  acoes,
  userId,
  executeAll,
  skipHitl = false,
  channel = null,
  agentId = null
} = {}) {
  if (!Array.isArray(acoes) || acoes.length === 0) return [];

  const sliced = acoes.slice(0, MAX_TOOLS_PER_TURN).filter(Boolean);

  const { allowed: afterScope, blocked: scopeBlocked } = splitByAgentScope(
    sliced,
    agentId
  );

  const { allowed: afterOwner, blocked: ownerBlocked } = await splitByOwner(
    userId,
    afterScope
  );

  // Canal/threshold/critical decididos em toolNeedsHitl. Não curto-circuitar por hitlEnabled(): com JARVIS_HITL=0 as critical ainda pedem SIM
  // (toolNeedsHitl já trata o master off pros outros níveis).
  const useHitl = !skipHitl;
  const { auto, gated } = useHitl
    ? splitByApproval(afterOwner, channel)
    : { auto: afterOwner, gated: [] };

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
      const { runScopedBatches } = require('../agents/worker');
      feitos = await withTimeout(
        runScopedBatches({
          acoes: toRun,
          userId,
          executeAll,
          agentId,
          timeoutMs: batchTimeout
        }),
        batchTimeout + 5000,
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
      feitos = toRun.map((a) => ({
        tipo: a.tipo,
        ok: false,
        erro: err.message || 'tool-batch falhou'
      }));
    }
  }

  const results = [
    ...scopeBlocked,
    ...ownerBlocked,
    ...(Array.isArray(feitos) ? feitos : [])
  ];

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
        owner_blocked: !!(f && f.owner_blocked),
        agent_scope_blocked: !!(f && f.agent_scope_blocked),
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

  try {
    await persistOpsFailures(userId, results);
  } catch (e) {
    console.error('[jarvis.tool] ultima_falha:', e.message);
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
      owner_blocked: results.filter((f) => f && f.owner_blocked).length,
      agent_scope_blocked: results.filter((f) => f && f.agent_scope_blocked).length,
      hitl: useHitl
    })
  );

  return results;
}

function projectIdFromTool(tipo) {
  const t = String(tipo || '');
  if (t.startsWith('attracione_')) return 'attracione';
  if (t.startsWith('socialhub_')) return 'socialhub';
  if (t.startsWith('cinerush_editor_')) return 'cinerush_editor';
  if (t.startsWith('cinerush_') || t.startsWith('chatwoot_')) return 'cinerush';
  if (t.startsWith('clipper_')) return 'clipper';
  if (t.startsWith('cutflix_')) return 'cutflix';
  if (t.startsWith('projeto_milhao_')) return 'projeto_milhao';
  if (t.startsWith('dev_')) return 'jarvis';
  if (t.startsWith('research_')) return 'approtina';
  if (t.startsWith('browser_')) return 'approtina';
  return null;
}

async function persistOpsFailures(userId, results) {
  if (!userId || !Array.isArray(results)) return;
  const { upsertProjectMemory } = require('../memory/projects');
  for (const f of results) {
    if (!f || f.ok !== false || f.pending_approval || f.owner_blocked) continue;
    const pid = projectIdFromTool(f.tipo);
    if (!pid) continue;
    const erro = String(f.erro || f.error || 'falha').slice(0, 350);
    await upsertProjectMemory(userId, {
      project_id: pid,
      ultima_falha: `${f.tipo}: ${erro}`
    });
  }
}

module.exports = {
  runToolBatch,
  splitByOwner,
  splitByAgentScope,
  withTimeout
};
