/**
 * Creative tools — image generation (owner).
 */
const TYPES = new Set(['creative_generate_image']);

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
    const out = await generateImage(prompt, { aspectRatio: aspect });
    if (!out?.base64) {
      return { tipo: 'creative_generate_image', ok: false, erro: 'sem imagem na resposta' };
    }
    return {
      tipo: 'creative_generate_image',
      ok: true,
      prompt: prompt.slice(0, 200),
      model: out.model,
      mime: out.mime,
      image_base64: out.base64,
      caption: out.caption,
      texto: `*Imagem gerada*\n_${prompt.slice(0, 120)}_`
    };
  } catch (e) {
    return {
      tipo: 'creative_generate_image',
      ok: false,
      erro: e.message,
      hint: 'Confere GEMINI_API_KEY e se o modelo de imagem está liberado na conta Google AI'
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
  return null;
}

module.exports = { TYPES, handle };
