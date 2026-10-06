/**
 * Remove fundo de imagem via Gemini (edição com referência) → PNG.
 * Usa a última imagem do layout-cache se não mandarem outra.
 */
async function removeBackground({ base64, mime = 'image/png', ask = '' } = {}) {
  const b64 = String(base64 || '')
    .replace(/^data:[^;]+;base64,/, '')
    .replace(/\s+/g, '');
  if (b64.length < 200) throw new Error('falta a imagem (manda o print ou fala depois de gerar uma)');
  const { generateImage, creativeEnabled } = require('./creative');
  if (!creativeEnabled()) throw new Error('GEMINI_API_KEY ausente');

  const prompt = [
    'Remove the background completely. Keep the main subject sharp and intact.',
    'Output a PNG with a fully transparent background (alpha), not white or checkerboard.',
    'Do not add shadows, borders, text, or new objects.',
    ask ? `User note: ${String(ask).slice(0, 200)}` : ''
  ]
    .filter(Boolean)
    .join(' ');

  const out = await generateImage(prompt, {
    referenceImage: { base64: b64, mime: mime || 'image/png' },
    aspectRatio: '1:1',
    matchReferenceAspect: true,
    maxPromptChars: 800
  });
  if (!out || !out.base64) throw new Error('sem imagem na resposta');
  return {
    base64: out.base64,
    mime: out.mime && /png/i.test(out.mime) ? out.mime : 'image/png',
    model: out.model
  };
}

module.exports = { removeBackground };
