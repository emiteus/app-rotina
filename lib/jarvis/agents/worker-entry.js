/**
 * Agent worker entry — runs in a forked child process.
 * Parent sends { type:'run', jobId, userId, agentId, acoes }
 * Child replies { type:'done'|'error', jobId, results?, erro? }
 */
process.on('message', async (msg) => {
  if (!msg || msg.type !== 'run') return;
  const jobId = msg.jobId;
  try {
    const { executarAcoesCorpo } = require('../tools/handlers');
    const acoes = Array.isArray(msg.acoes) ? msg.acoes : [];
    const results = await executarAcoesCorpo(acoes, msg.userId);
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
