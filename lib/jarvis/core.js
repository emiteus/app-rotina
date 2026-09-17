/**
 * JARVIS Core façade (Phase 1).
 * Interface-agnostic entrypoint. Behavior still lives in routes/ia.js processarChat;
 * adapters (web / whatsapp) must call runJarvisTurn — not processarChat directly.
 */

/**
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} opts.message
 * @param {string|null} [opts.conversaId]
 * @param {Array<{role:string,content:string}>} [opts.historico]
 * @param {'web'|'whatsapp'|'api'|string} [opts.channel]
 */
async function runJarvisTurn(opts = {}) {
  const userId = opts.userId;
  const message = opts.message != null ? opts.message : opts.mensagem;
  const conversaId = opts.conversaId != null ? opts.conversaId : opts.conversa_id || null;
  const historico = Array.isArray(opts.historico) ? opts.historico : [];
  const channel = String(opts.channel || 'unknown');

  const t0 = Date.now();
  // Lazy require evita ciclo: whatsapp → core → ia (ia não importa core no load)
  const { processarChat } = require('../../routes/ia');

  try {
    const out = await processarChat({
      userId,
      mensagem: message,
      conversaId,
      historico,
      channel
    });

    const actionTypes = (out.acoes || [])
      .map((a) => a && a.tipo)
      .filter(Boolean);
    const failed = (out.acoes || []).filter((a) => a && a.ok === false).length;

    console.log(
      JSON.stringify({
        tag: 'jarvis.turn',
        ok: true,
        channel,
        userId,
        conversaId: out.conversa_id || conversaId || null,
        provider: out.provider || null,
        durationMs: Date.now() - t0,
        actionTypes,
        actionsOk: actionTypes.length - failed,
        actionsFail: failed
      })
    );

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
    throw err;
  }
}

module.exports = { runJarvisTurn };
