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
  return [
    ...new Set([
      primary,
      'gemini-2.5-flash-image',
      'gemini-2.0-flash-preview-image-generation',
      'gemini-2.0-flash-exp-image-generation'
    ])
  ];
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function geminiErrorInfo(err) {
  const status = err?.response?.status || err?.status || null;
  const data = err?.response?.data?.error || {};
  const raw = String(data.message || err?.message || '').slice(0, 500);
  const quotaMetric =
    data.details?.find?.((d) => d.violations)?.violations?.[0]?.quotaMetric || null;
  return { status, raw, quotaMetric };
}

function humanizeCreativeError(err) {
  const { status, raw, quotaMetric } = geminiErrorInfo(err);
  if (status === 429 || /resource.?exhausted|quota|rate.?limit/i.test(raw)) {
    const freeZero = /free_tier|limit:\s*0/i.test(raw) || /free_tier/i.test(quotaMetric || '');
    if (freeZero) {
      return 'Quota Gemini de imagem zerada (free tier). Ativa billing em AI Studio (aistudio.google.com → Rate limit) ou espera o reset diário.';
    }
    return 'Gemini imagem saturado (429). Espera ~1 min e manda de novo.';
  }
  if (status === 403) return 'GEMINI_API_KEY sem permissão pra gerar imagem.';
  if (status === 404) return 'Modelo de imagem não disponível nesta conta Gemini.';
  if (raw && !/^Request failed with status code/i.test(raw)) return raw;
  return status ? `Falha Gemini HTTP ${status}` : raw || 'falha ao gerar imagem';
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
  const maxAttempts = Math.max(1, Number(process.env.JARVIS_IMAGE_RETRIES || 3));
  let lastErr = null;

  for (const model of imageModels()) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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
              attempt,
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
        break;
      } catch (err) {
        lastErr = err;
        const { status, raw } = geminiErrorInfo(err);
        console.log(
          JSON.stringify({
            tag: 'jarvis.creative',
            event: 'image_fail',
            model,
            attempt,
            error: raw || err.message,
            status
          })
        );

        const retryable = status === 429 || status === 503 || status === 500;
        if (retryable && attempt < maxAttempts) {
          const wait = Math.min(25000, 2000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 800));
          await sleep(wait);
          continue;
        }
        // 404/400 → próximo modelo; 429 esgotado → também tenta outro modelo
        if (status === 404 || status === 400 || status === 429 || status === 503) break;
        throw Object.assign(new Error(humanizeCreativeError(err)), { cause: err, status });
      }
    }
  }

  const msg = humanizeCreativeError(lastErr || new Error('falha ao gerar imagem'));
  const out = new Error(msg);
  if (lastErr?.response?.status) out.status = lastErr.response.status;
  throw out;
}

module.exports = {
  creativeEnabled,
  generateImage,
  humanizeCreativeError
};
