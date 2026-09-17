/**
 * JARVIS Core façade (Phase 1 + multimodal/agent hooks).
 */
async function runJarvisTurn(opts = {}) {
  const userId = opts.userId;
  let message = opts.message != null ? opts.message : opts.mensagem;
  const conversaId = opts.conversaId != null ? opts.conversaId : opts.conversa_id || null;
  const historico = Array.isArray(opts.historico) ? opts.historico : [];
  const channel = String(opts.channel || 'unknown');
  const agentId = opts.agentId || null;
  const media = opts.media || null;
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;

  const t0 = Date.now();
  const { processarChat } = require('../../routes/ia');

  try {
    if (media && !opts.skipIngress) {
      const { ingressToText } = require('./multimodal/ingress');
      const ing = await ingressToText({ text: message, mediaMeta: media });
      message = ing.message;
    }

    const out = await processarChat({
      userId,
      mensagem: message,
      conversaId,
      historico,
      channel,
      agentId,
      onProgress
    });

    const actionTypes = (out.acoes || [])
      .map((a) => a && a.tipo)
      .filter(Boolean);
    const failed = (out.acoes || []).filter(
      (a) => a && a.ok === false && !a.pending_approval
    ).length;

    console.log(
      JSON.stringify({
        tag: 'jarvis.turn',
        ok: true,
        channel,
        userId,
        conversaId: out.conversa_id || conversaId || null,
        provider: out.provider || null,
        agent: out.agent || agentId || null,
        durationMs: Date.now() - t0,
        actionTypes,
        actionsOk: actionTypes.length - failed,
        actionsFail: failed
      })
    );

    try {
      require('./events/bus').emit('turn.ok', {
        channel,
        userId,
        durationMs: Date.now() - t0
      });
    } catch (_) { /* ignore */ }

    return out;
  } catch (err) {
    console.log(
      JSON.stringify({
        tag: 'jarvis.turn',
        ok: false,
        channel,
        userId,
        conversaId: conversaId || null,
        durationMs: Date.now() - t0,
        error: err && err.message ? err.message : String(err),
        status: err && err.status ? err.status : null
      })
    );
    try {
      require('./events/bus').emit('turn.fail', {
        channel,
        userId,
        error: err.message
      });
    } catch (_) { /* ignore */ }
    throw err;
  }
}

module.exports = { runJarvisTurn };
