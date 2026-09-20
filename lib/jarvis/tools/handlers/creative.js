/**
 * Creative tools — image + landing copy (owner).
 */
const TYPES = new Set(['creative_generate_image', 'creative_landing_copy']);

async function handleGenerateImage(acao) {
  if (process.env.JARVIS_CREATIVE === '0') {
    return {
      tipo: 'creative_generate_image',
      ok: false,
      erro: 'Creative off (JARVIS_CREATIVE=0)'
    };
  }
  const prompt = String(
    acao.prompt || acao.texto || acao.description || acao.descricao || ''
  ).trim();
  if (prompt.length < 3) {
    return {
      tipo: 'creative_generate_image',
      ok: false,
      erro: 'Falta o prompt (ex.: gera imagem de um robô no escritório)'
    };
  }

  try {
    const { generateImage, creativeEnabled } = require('../../multimodal/creative');
    if (!creativeEnabled()) {
      return {
        tipo: 'creative_generate_image',
        ok: false,
        erro: 'GEMINI_API_KEY ausente'
      };
    }
    const aspect = acao.aspect || acao.aspect_ratio || acao.aspectRatio || undefined;
    const refB64 = acao.reference_image_base64 || acao.referenceImageBase64 || null;
    const locked = !!(acao.locked_layout || refB64);
    let finalPrompt = prompt;
    if (locked) {
      const { buildLockedReproducePrompt } = require('../../multimodal/creative');
      finalPrompt = buildLockedReproducePrompt(acao.layout || null, prompt);
    }
    const out = await generateImage(finalPrompt, {
      aspectRatio: aspect,
      referenceImage: refB64
        ? { base64: refB64, mime: acao.reference_mime || acao.mime || 'image/jpeg' }
        : undefined,
      maxPromptChars: locked ? 3200 : 1200
    });
    if (!out?.base64) {
      return { tipo: 'creative_generate_image', ok: false, erro: 'sem imagem na resposta' };
    }
    const cap = String(acao.caption || (locked ? prompt : null) || prompt).slice(0, 200);
    return {
      tipo: 'creative_generate_image',
      ok: true,
      prompt: finalPrompt.slice(0, 200),
      model: out.model,
      mime: out.mime,
      image_base64: out.base64,
      caption: cap,
      locked_layout: locked,
      model_caption: out.caption || null,
      texto: locked
        ? 'Pronto — mesma estrutura, só a troca pedida.'
        : 'Pronto — imagem no chat.'
    };
  } catch (e) {
    const { humanizeCreativeError } = require('../../multimodal/creative');
    const erro = humanizeCreativeError(e);
    const quota = /limit 0|free tier|quota|saturado|429|billing/i.test(erro);
    return {
      tipo: 'creative_generate_image',
      ok: false,
      erro,
      hint: quota
        ? 'Ativa billing pago no Google AI Studio (mesmo projeto da GEMINI_API_KEY)'
        : 'Confere GEMINI_API_KEY e modelo de imagem na conta Google AI'
    };
  }
}

async function handle(acao, ctx) {
  const tipo = acao && acao.tipo;
  if (!TYPES.has(tipo)) return null;

  const { requireLib } = require('../../host');
  const { isPlanoOwnerUserId } = requireLib('plano-owner');
  if (!(await isPlanoOwnerUserId(ctx.userId))) {
    return { tipo, ok: false, erro: 'só owner' };
  }

  console.log(
    JSON.stringify({
      tag: 'jarvis.creative',
      event: 'tool',
      tipo,
      userId: ctx.userId
    })
  );

  if (tipo === 'creative_generate_image') return handleGenerateImage(acao);
  if (tipo === 'creative_landing_copy') {
    const { generateLandingCopy } = require('../../multimodal/landing-copy');
    return generateLandingCopy(acao, ctx);
  }
  return null;
}

module.exports = { TYPES, handle };
