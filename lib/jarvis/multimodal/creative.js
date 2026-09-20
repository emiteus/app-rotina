/**
 * Creative image gen — Gemini Flash Image (Nano Banana).
 * Env: GEMINI_API_KEY, JARVIS_CREATIVE=0 to disable, JARVIS_IMAGE_MODEL.
 *
 * Image models often have free_tier limit:0 — needs paid AI Studio billing.
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
      'gemini-3.1-flash-lite-image',
      'gemini-3.1-flash-image',
      'gemini-3.1-flash-image-preview'
    ])
  ];
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function geminiErrorInfo(err) {
  const status = err?.response?.status || err?.status || null;
  const data = err?.response?.data?.error || {};
  const raw = String(data.message || err?.message || '').slice(0, 800);
  const violations = [];
  for (const d of data.details || []) {
    for (const v of d.violations || []) violations.push(v);
  }
  const quotaMetric = violations[0]?.quotaMetric || null;
  const retryMatch = raw.match(/retry in\s+([\d.]+)s/i);
  const retryAfterMs = retryMatch ? Math.ceil(Number(retryMatch[1]) * 1000) : null;
  return { status, raw, quotaMetric, retryAfterMs, violations };
}

/** Prefer actionable quota errors over dead-model 404s. */
function preferErr(current, next) {
  if (!current) return next;
  if (!next) return current;
  const a = geminiErrorInfo(current);
  const b = geminiErrorInfo(next);
  const score = (info) => {
    if (info.status === 429 || /free_tier|quota|resource.?exhausted/i.test(info.raw)) return 100;
    if (info.status === 403) return 80;
    if (info.status === 503 || info.status === 500) return 60;
    if (info.status === 400) return 40;
    if (info.status === 404) return 10;
    return 20;
  };
  return score(b) >= score(a) ? next : current;
}

function humanizeCreativeError(err) {
  const { status, raw, quotaMetric } = geminiErrorInfo(err);
  const freeZero =
    /free_tier.*limit:\s*0|limit:\s*0.*free_tier/i.test(raw) ||
    /free_tier/i.test(quotaMetric || '');
  if (status === 429 || /resource.?exhausted|quota|rate.?limit/i.test(raw)) {
    if (freeZero) {
      return
        'Gemini imagem: free tier = **limit 0**. Ativa billing pago em aistudio.google.com (mesmo projeto da GEMINI_API_KEY) — sem isso não gera.';
    }
    return 'Gemini imagem saturado (429). Espera ~1 min e manda de novo.';
  }
  if (status === 403) return 'GEMINI_API_KEY sem permissão pra gerar imagem.';
  if (status === 404) {
    return 'Nenhum modelo de imagem respondeu nesta conta. Confere billing/quota em aistudio.google.com.';
  }
  if (raw && !/^Request failed with status code/i.test(raw)) {
    return raw.split('\n')[0].slice(0, 280);
  }
  return status ? `Falha Gemini HTTP ${status}` : raw || 'falha ao gerar imagem';
}

/**
 * @param {string} prompt
 * @param {{ aspectRatio?: string, referenceImage?: { base64: string, mime?: string }, maxPromptChars?: number }} [opts]
 * @returns {Promise<{ base64: string, mime: string, caption?: string, model: string }|null>}
 */
async function generateImage(prompt, opts = {}) {
  if (!creativeEnabled()) return null;
  const maxChars = Math.min(4000, Number(opts.maxPromptChars) || 1200);
  const text = String(prompt || '').trim().slice(0, maxChars);
  if (text.length < 3) throw new Error('prompt curto demais');

  const aspectRatio = opts.aspectRatio || process.env.JARVIS_IMAGE_ASPECT || '1:1';
  const maxAttempts = Math.max(1, Number(process.env.JARVIS_IMAGE_RETRIES || 2));
  let lastErr = null;

  const ref = opts.referenceImage;
  const refB64 = ref && ref.base64
    ? String(ref.base64).replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '')
    : null;
  const refMime = (ref && ref.mime) || 'image/jpeg';

  for (const model of imageModels()) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
      try {
        const parts = [];
        // Referência primeiro — modelos de imagem atendem melhor
        if (refB64) {
          parts.push({
            inlineData: {
              mimeType: refMime,
              data: refB64
            }
          });
        }
        parts.push({ text });
        const body = {
          contents: [{ role: 'user', parts }],
          generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
            imageConfig: { aspectRatio }
          }
        };
        const resp = await axios.post(url, body, { timeout: 90000 });
        const outParts = resp.data?.candidates?.[0]?.content?.parts || [];
        let caption = '';
        let image = null;
        for (const p of outParts) {
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
              withReference: !!refB64,
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
        lastErr = preferErr(lastErr, new Error('modelo não devolveu imagem'));
        break;
      } catch (err) {
        lastErr = preferErr(lastErr, err);
        const { status, raw, retryAfterMs } = geminiErrorInfo(err);
        console.log(
          JSON.stringify({
            tag: 'jarvis.creative',
            event: 'image_fail',
            model,
            attempt,
            withReference: !!refB64,
            error: (raw || err.message || '').slice(0, 240),
            status
          })
        );

        const freeZero = /free_tier.*limit:\s*0|limit:\s*0.*free_tier/i.test(raw || '');
        // limit:0 não melhora com retry — pula modelo
        if (freeZero) break;

        const retryable = status === 429 || status === 503 || status === 500;
        if (retryable && attempt < maxAttempts) {
          const wait = Math.min(
            30000,
            retryAfterMs || 2000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 800)
          );
          await sleep(wait);
          continue;
        }
        // 404 modelo morto / 400 config → próximo; 429 transitório esgotado → próximo
        if (status === 404 || status === 400 || status === 429 || status === 503) break;
        throw Object.assign(new Error(humanizeCreativeError(err)), { cause: err, status });
      }
    }
  }

  const msg = humanizeCreativeError(lastErr || new Error('falha ao gerar imagem'));
  const out = new Error(msg);
  out.status = lastErr?.response?.status || lastErr?.status || null;
  throw out;
}

/**
 * Prompt travado: mesma composição da referência, só aplica o pedido do user.
 */
function buildLockedReproducePrompt(layoutObj, userRequest) {
  const req = String(userRequest || '').trim().slice(0, 500);
  const layout = layoutObj && typeof layoutObj === 'object' ? layoutObj : null;

  const keepTexts = [];
  if (layout) {
    for (const t of layout.textos_fixidos || []) {
      if (t) keepTexts.push(String(t).slice(0, 80));
    }
    for (const z of layout.zonas || []) {
      if (z && z.copy) keepTexts.push(String(z.copy).slice(0, 80));
    }
  }
  const keepUnique = [...new Set(keepTexts)].slice(0, 10);

  const struct = layout
    ? JSON.stringify(
        {
          tipo: layout.tipo,
          resumo: layout.resumo,
          hierarquia: layout.hierarquia,
          zonas: (layout.zonas || []).slice(0, 6).map((z) => ({
            id: z.id || z.nome,
            papel: z.papel,
            copy: z.copy
          })),
          palette: layout.palette,
          textos_fixidos: keepUnique
        },
        null,
        0
      ).slice(0, 1000)
    : '(ver imagem de referência anexada)';

  return `You are an IMAGE EDITOR. The FIRST/attached image is the REFERENCE. Output ONE edited image.

TASK: ${req || 'Reproduce the reference as-is'}

MANDATORY (pixel-layout fidelity):
- Same canvas ratio, same white/plain background style as the reference.
- Same positions for headline, badge/odds, and both crests.
- Same typography style (blocky outlined headline, neon odds badge if present).
- Flat sports betting graphic — NOT a photo, NOT 3D stadium, NOT cinematic.

KEEP THESE TEXTS EXACTLY (unless the user asked to change them):
${keepUnique.length ? keepUnique.map((t) => `- "${t}"`).join('\n') : '- (all visible text from the reference except crests being swapped)'}

APPLY ONLY THE USER CHANGE (usually swap crests/logos). Nothing else.

FORBIDDEN (never draw these):
- VS / versus badge in the center
- "EL CLÁSICO" / El Clasico / matchday poster
- stadium night / floodlights / light beams / sparks / smoke
- split blue/red cinematic background
- date under VS
- any redesign into a "professional matchday banner"

Reference structure (vision):
${struct}

If you redesign the template, you FAIL the task. Edit the reference composition only.`;
}

module.exports = {
  creativeEnabled,
  generateImage,
  buildLockedReproducePrompt,
  humanizeCreativeError
};
