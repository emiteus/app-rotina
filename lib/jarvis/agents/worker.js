/**
 * Isolated agent workers — child_process.fork per scoped batch.
 * Opt-out: JARVIS_AGENT_WORKERS=0 (in-process only).
 */
const path = require('path');
const { fork } = require('child_process');

function workersEnabled() {
  return String(process.env.JARVIS_AGENT_WORKERS || '1').trim() !== '0';
}

function defaultTimeoutMs() {
  const n = Number(process.env.JARVIS_AGENT_WORKER_TIMEOUT_MS || 120000);
  return Number.isFinite(n) && n >= 5000 ? n : 120000;
}

function forkJob({ userId, agentId, acoes, timeoutMs }) {
  const entry = path.join(__dirname, 'worker-entry.js');
  const jobId = `w_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const ms = timeoutMs || defaultTimeoutMs();

  return new Promise((resolve, reject) => {
    let settled = false;
    // Até o filho confirmar o recebimento, nenhuma ação rodou → fallback in-process é seguro.
    let started = false;
    const fail = (message, code) => {
      const err = new Error(message);
      err.code = code || (started ? 'WORKER_UNCERTAIN' : 'WORKER_NOT_STARTED');
      return err;
    };
    const child = fork(entry, [], {
      env: { ...process.env, JARVIS_AGENT_WORKER: '1' },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc']
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      reject(fail(`agent worker timeout após ${ms}ms (${agentId || 'default'})`));
    }, ms);

    const finish = (err, results) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (!child.killed) child.kill();
      } catch {
        /* ignore */
      }
      if (err) reject(err);
      else resolve(results);
    };

    child.on('message', (msg) => {
      if (!msg || msg.jobId !== jobId) return;
      if (msg.type === 'started') started = true;
      else if (msg.type === 'done') finish(null, msg.results || []);
      else if (msg.type === 'error') {
        finish(fail(msg.erro || 'worker error', msg.notStarted ? 'WORKER_NOT_STARTED' : null));
      }
    });
    child.on('error', (e) => finish(fail(e.message || String(e))));
    child.on('exit', (code, signal) => {
      if (settled) return;
      finish(
        fail(`agent worker exit code=${code} signal=${signal || ''} (${agentId || 'default'})`)
      );
    });

    child.send({ type: 'run', jobId, userId, agentId, acoes });
  });
}

/**
 * Prefer isolated fork when agentId has scope (toolPrefixes) and workers on.
 * Falls back to executeAll on failure / workers off.
 */
async function runScopedBatches({
  acoes,
  userId,
  executeAll,
  agentId = null,
  timeoutMs = null
} = {}) {
  const list = Array.isArray(acoes) ? acoes.filter(Boolean) : [];
  if (!list.length) return [];
  if (typeof executeAll !== 'function') {
    throw new Error('executeAll obrigatório');
  }

  let useWorker = false;
  if (workersEnabled() && agentId) {
    try {
      const { getAgent } = require('./registry');
      const agent = getAgent(agentId);
      const prefixes = agent.toolPrefixes || [];
      useWorker = prefixes.length > 0 && !agent.inProcess;
    } catch {
      useWorker = false;
    }
  }

  if (!useWorker) {
    return executeAll(list, userId);
  }

  try {
    const results = await forkJob({
      userId,
      agentId,
      acoes: list,
      timeoutMs
    });
    console.log(
      JSON.stringify({
        tag: 'jarvis.agent',
        event: 'worker_done',
        agentId,
        n: results.length
      })
    );
    return results;
  } catch (e) {
    // Worker pode ter executado parte do lote antes de cair/estourar o tempo.
    // Rodar de novo duplicaria PR, redeploy, provisionamento… Só refaz se nada começou.
    if (e.code === 'WORKER_NOT_STARTED') {
      console.log(
        JSON.stringify({ tag: 'jarvis.agent', event: 'worker_fallback', agentId, erro: e.message })
      );
      return executeAll(list, userId);
    }
    console.log(
      JSON.stringify({ tag: 'jarvis.agent', event: 'worker_uncertain', agentId, erro: e.message })
    );
    return list.map((a) => ({
      tipo: a.tipo,
      ok: false,
      uncertain: true,
      erro: `sem confirmação (${e.message}) — pode ter rodado; confere antes de repetir`
    }));
  }
}

module.exports = {
  workersEnabled,
  runScopedBatches,
  forkJob
};
