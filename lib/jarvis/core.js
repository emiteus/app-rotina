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
  const { processarChat } = require('./host').requireRoutes('ia');
  const {
    looksLikeLayoutTweakMessage,
    tryLayoutImageEdit,
    fetchEvolutionMediaBase64
  } = require('./multimodal/ingress');
  const { rememberLayoutImage, getLastLayoutImage } = require('./multimodal/layout-cache');

  function cacheIfLayout(ing) {
    if (ing && ing.layoutReproduce && ing.image_base64 && userId) {
      rememberLayoutImage(userId, {
        base64: ing.image_base64,
        mime: ing.mime,
        caption: ing.caption
      });
    }
  }

  try {
    // Follow-up de ajuste sem anexo: reusa último layout (ou imagem citada já em media)
    if (!opts.skipIngress && looksLikeLayoutTweakMessage(message)) {
      let mediaMeta = media && (media.fromQuote || media.kind === 'image') ? media : null;
      let mediaB64 = null;
      if (mediaMeta) {
        try {
          mediaB64 = await fetchEvolutionMediaBase64(mediaMeta.raw);
        } catch (_) {
          mediaB64 = null;
        }
      }
      if (!mediaB64) {
        const cached = getLastLayoutImage(userId);
        if (cached) {
          mediaMeta = {
            kind: 'image',
            caption: String(message || ''),
            mimetype: cached.mime || 'image/png',
            raw: null,
            fromCache: true
          };
          mediaB64 = cached.base64;
        }
      }
      if (mediaMeta && mediaB64) {
        const edited = await tryLayoutImageEdit({
          mediaMeta,
          mediaB64,
          userAsk: String(message || ''),
          layoutObj: null
        });
        if (edited && edited.directReply && edited.image_base64) {
          cacheIfLayout(edited);
          console.log(
            JSON.stringify({
              tag: 'jarvis.turn',
              ok: true,
              channel,
              userId,
              provider: edited.provider || 'gemini',
              layoutReproduce: true,
              layoutTweak: true,
              fromCache: !!mediaMeta.fromCache,
              fromQuote: !!mediaMeta.fromQuote,
              directReply: true,
              durationMs: Date.now() - t0
            })
          );
          return {
            resposta: edited.message,
            acoes: [
              {
                tipo: 'creative_generate_image',
                ok: true,
                image_base64: edited.image_base64,
                mime: edited.mime || 'image/png',
                caption: String(edited.caption || 'Layout').slice(0, 200),
                texto: edited.message || 'Pronto — ajuste no layout.'
              }
            ],
            provider: edited.provider || 'gemini',
            conversa_id: conversaId
          };
        }
        console.log(
          JSON.stringify({
            tag: 'jarvis.multimodal',
            event: 'layout_tweak_fail',
            fromCache: !!mediaMeta.fromCache,
            hasB64: !!mediaB64
          })
        );
      } else if (!media) {
        // Sem cache/quote: não deixa o LLM inventar arte nova
        console.log(
          JSON.stringify({
            tag: 'jarvis.multimodal',
            event: 'layout_tweak_no_ref',
            userId
          })
        );
        return {
          resposta:
            'Pra ajustar o layout (afastar/aproximar/tamanho), responde **à imagem** ou manda o print de novo com o pedido.',
          acoes: [],
          provider: 'ingress',
          conversa_id: conversaId
        };
      }
    }

    if (media && !opts.skipIngress) {
      const { ingressToText } = require('./multimodal/ingress');
      const ing = await ingressToText({ text: message, mediaMeta: media });
      if (ing.directReply) {
        cacheIfLayout(ing);
        console.log(
          JSON.stringify({
            tag: 'jarvis.turn',
            ok: true,
            channel,
            userId,
            provider: ing.provider || 'vision',
            visionV2: true,
            layoutReproduce: !!ing.layoutReproduce,
            hasImage: !!ing.image_base64,
            directReply: true,
            durationMs: Date.now() - t0
          })
        );
        const acoes = [];
        if (ing.image_base64) {
          acoes.push({
            tipo: 'creative_generate_image',
            ok: true,
            image_base64: ing.image_base64,
            mime: ing.mime || 'image/png',
            caption: String(ing.caption || 'Layout').slice(0, 200),
            texto: ing.message || 'Pronto — mesma estrutura.'
          });
        }
        return {
          resposta: ing.message,
          acoes,
          provider: ing.provider || 'vision',
          conversa_id: conversaId
        };
      }
      // Áudio sem STT → pede texto, sem tools (evita "Recebi…" → confirmar_receita)
      if (ing.needsUserText || ing.sttFailed) {
        console.log(
          JSON.stringify({
            tag: 'jarvis.turn',
            ok: true,
            channel,
            userId,
            provider: 'ingress',
            sttFailed: !!ing.sttFailed,
            durationMs: Date.now() - t0
          })
        );
        return {
          resposta: ing.message,
          acoes: [],
          provider: 'ingress',
          conversa_id: conversaId
        };
      }
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

    const imgOk = (out.acoes || []).find(
      (a) => a && a.ok && a.tipo === 'creative_generate_image' && a.image_base64
    );
    if (imgOk && (imgOk.locked_layout || looksLikeLayoutTweakMessage(message))) {
      rememberLayoutImage(userId, {
        base64: imgOk.image_base64,
        mime: imgOk.mime,
        caption: imgOk.caption
      });
    }

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
    } catch (_) {
      /* ignore */
    }

    return out;
  } catch (err) {
    console.log(
      JSON.stringify({
        tag: 'jarvis.turn',
        ok: false,
        channel,
        userId,
        durationMs: Date.now() - t0,
        error: String(err && err.message ? err.message : err).slice(0, 200)
      })
    );
    try {
      require('./events/bus').emit('turn.fail', {
        channel,
        userId,
        error: String(err.message || err)
      });
    } catch (_) {
      /* ignore */
    }
    throw err;
  }
}

module.exports = { runJarvisTurn };
