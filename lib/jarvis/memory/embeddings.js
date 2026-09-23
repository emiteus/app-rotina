/**
 * Embedding provider — Gemini gemini-embedding-001 (GEMINI_API_KEY).
 * text-embedding-004 foi desligado (404 em produção, 2026-09-22).
 * Opt-out: JARVIS_EMBEDDINGS=0
 */
const DEFAULT_MODEL = 'gemini-embedding-001';

function embeddingsEnabled() {
  if (String(process.env.JARVIS_EMBEDDINGS || '1').trim() === '0') return false;
  return !!(process.env.GEMINI_API_KEY || '').trim();
}

function embeddingModel() {
  return String(process.env.JARVIS_EMBED_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = Number(a[i]) || 0;
    const y = Number(b[i]) || 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na <= 0 || nb <= 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * @param {string} text
 * @param {'RETRIEVAL_QUERY'|'RETRIEVAL_DOCUMENT'|'SEMANTIC_SIMILARITY'} [taskType]
 * @returns {Promise<number[]|null>}
 */
async function embedText(text, taskType = 'SEMANTIC_SIMILARITY') {
  if (!embeddingsEnabled()) return null;
  const raw = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 6000);
  if (raw.length < 2) return null;

  const key = String(process.env.GEMINI_API_KEY || '').trim();
  const model = embeddingModel();
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:embedContent`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        model: `models/${model}`,
        content: { parts: [{ text: raw }] },
        taskType
      }),
      signal: AbortSignal.timeout(20000)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.log(
        JSON.stringify({
          tag: 'jarvis.embed',
          event: 'fail',
          status: res.status,
          erro: data?.error?.message || res.statusText
        })
      );
      return null;
    }
    const values = data?.embedding?.values;
    if (!Array.isArray(values) || !values.length) return null;
    return values.map((v) => Number(v) || 0);
  } catch (e) {
    console.log(
      JSON.stringify({
        tag: 'jarvis.embed',
        event: 'error',
        erro: e.message || String(e)
      })
    );
    return null;
  }
}

module.exports = {
  embeddingsEnabled,
  embeddingModel,
  cosineSimilarity,
  embedText
};
