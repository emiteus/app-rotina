/**
 * Creative image gen — Gemini Flash Image (Nano Banana).
 * Env: GEMINI_API_KEY, JARVIS_CREATIVE=0 to disable, JARVIS_IMAGE_MODEL.
 */
const axios = require('axios');

function creativeEnabled() {
  if (process.env.JARVIS_CREATIVE === '0' || process.env.JARVIS_CREATIVE === 'false') {
    return false;
  }
  return !!String(process.env.GEMINI_API_KEY || '').trim();
}

function imageModels() {
  const primary = process.env.JARVIS_IMAGE_MODEL || 'gemini-2.5-flash-image';
  return [...new Set([primary, 'gemini-2.5-flash-image', 'gemini-2.0-flash-preview-image-generation'])];
}

/**
 * @param {string} prompt
 * @param {{ aspectRatio?: string }} [opts]
 * @returns {Promise<{ base64: string, mime: string, caption?: string, model: string }|null>}
 */
async function generateImage(prompt, opts = {}) {
  if (!creativeEnabled()) return null;
  const text = String(prompt || '').trim().slice(0, 1200);
  if (text.length < 3) throw new Error('prompt curto demais');

  const aspectRatio = opts.aspectRatio || process.env.JARVIS_IMAGE_ASPECT || '1:1';
  let lastErr = null;

  for (const model of imageModels()) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
    try {
      const body = {
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: { aspectRatio }
        }
      };
      const resp = await axios.post(url, body, { timeout: 90000 });
      const parts = resp.data?.candidates?.[0]?.content?.parts || [];
      let caption = '';
      let image = null;
      for (const p of parts) {
        if (p.text) caption += p.text;
        const inline = p.inlineData || p.inline_data;
        if (inline && inline.data) {
          image = {
            base64: String(inline.data).replace(/\s+/g, ''),
            mime: inline.mimeType || inline.mime_type || 'image/png'
          };
        }
      }
      if (image?.base64) {
        console.log(
          JSON.stringify({
            tag: 'jarvis.creative',
            event: 'image_ok',
            model,
            bytesApprox: Math.floor((image.base64.length * 3) / 4),
            promptChars: text.length
          })
        );
        return {
          base64: image.base64,
          mime: image.mime,
          caption: caption.trim().slice(0, 400) || null,
          model
        };
      }
      lastErr = new Error('modelo não devolveu imagem');
    } catch (err) {
      lastErr = err;
      console.log(
        JSON.stringify({
          tag: 'jarvis.creative',
          event: 'image_fail',
          model,
          error: err.message,
          status: err.response?.status || null
        })
      );
      const st = err.response?.status;
      if (st && st !== 404 && st !== 400) break;
    }
  }
  throw lastErr || new Error('falha ao gerar imagem');
}

module.exports = {
  creativeEnabled,
  generateImage
};
