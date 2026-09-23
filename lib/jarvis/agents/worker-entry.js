/**
 * Agent worker entry — runs in a forked child process.
 * Parent sends { type:'run', jobId, userId, agentId, acoes }
 * Child replies { type:'done'|'error', jobId, results?, erro? }
 */
process.on('message', async (msg) => {
  if (!msg || msg.type !== 'run') return;
  const jobId = msg.jobId;
  let executarAcoesCorpo;
  try {
    ({ executarAcoesCorpo } = require('../tools/handlers'));
  } catch (e) {
    // Falhou antes de qualquer ação — o pai pode rodar in-process sem duplicar
    if (process.send) {
      process.send({ type: 'error', jobId, notStarted: true, erro: e.message || String(e) });
    }
    return;
  }
  if (process.send) process.send({ type: 'started', jobId });
  try {
    const acoes = Array.isArray(msg.acoes) ? msg.acoes : [];
    const results = await executarAcoesCorpo(acoes, msg.userId);
    // O pai mata o worker logo após "done" — o timer de flush do budget não chegaria a rodar
    try {
      await require('../budget').flushToDb();
    } catch (_) {
      /* best-effort */
    }
    if (process.send) {
      process.send({ type: 'done', jobId, results, agentId: msg.agentId || null });
    }
  } catch (e) {
    if (process.send) {
      process.send({
        type: 'error',
        jobId,
        erro: e.message || String(e),
        agentId: msg.agentId || null
      });
    }
  }
});

process.on('uncaughtException', (e) => {
  if (process.send) {
    process.send({ type: 'error', jobId: null, erro: e.message || String(e) });
  }
  process.exit(1);
});
