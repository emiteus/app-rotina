/**
 * Voz do Jarvis pelo Fish Audio (25/09/2026): modelo público "Jarvis (UCM) - Português Brasileiro",
 * parecido com o dublador. Substitui a Charon, que mudava de tom a cada fala.
 *
 * Custo: US$ 15 / 1M bytes de texto (medido: ~3.200 caracteres falados/dia no PC ≈ US$ 1,50/mês).
 * O cache (tts-cache.js) faz frase repetida sair de graça e na hora.
 *
 * Env: FISH_API_KEY (obrigatória), FISH_VOICE_ID (padrão: Jarvis UCM PT-BR), FISH_TTS_MODEL (s2.1-pro),
 *      FISH_SPEED (1.1), FISH_LATENCY (balanced), FISH_TEMPERATURE (0.5 — menor = voz mais estável).
 */
const JARVIS_PTBR = 'a5b93aeddcc948c19ea04f0afe9d178c';

function fishKey() {
  return String(process.env.FISH_API_KEY || '').trim();
}

function fishConfig() {
  const num = (v, d, min, max) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? n : d;
  };
  return {
    voice: String(process.env.FISH_VOICE_ID || JARVIS_PTBR).trim(),
    model: String(process.env.FISH_TTS_MODEL || 's2.1-pro').trim(),
    speed: num(process.env.FISH_SPEED, 1.1, 0.5, 2),
    latency: ['low', 'balanced', 'normal'].includes(process.env.FISH_LATENCY) ? process.env.FISH_LATENCY : 'balanced',
    temperature: num(process.env.FISH_TEMPERATURE, 0.5, 0, 1)
  };
}

/**
 * Texto → { buf, mime:'audio/mpeg', provider:'fish', model, voice }.
 * Sem voz reserva (uma voz só), então erro passageiro (5xx/rede) tenta mais uma vez.
 */
async function fishSpeech(speech, opts = {}) {
  try {
    return await fishSpeechOnce(speech, opts);
  } catch (e) {
    if (e.status && e.status < 500) throw e; // 401/402: chave ou crédito — repetir não resolve
    return fishSpeechOnce(speech, opts);
  }
}

async function fishSpeechOnce(speech, { timeoutMs = 30000, signal = null, fetchImpl = fetch } = {}) {
  const key = fishKey();
  if (!key) throw new Error('FISH_API_KEY ausente');
  const c = fishConfig();
  const res = await fetchImpl('https://api.fish.audio/v1/tts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', model: c.model },
    body: JSON.stringify({
      text: speech,
      reference_id: c.voice,
      format: 'mp3',
      mp3_bitrate: 64,
      latency: c.latency,
      temperature: c.temperature,
      prosody: { speed: c.speed }
    }),
    signal: signal || AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Fish TTS HTTP ${res.status}: ${body.slice(0, 160)}`);
    err.status = res.status;
    throw err;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 200) throw new Error('Fish TTS sem áudio');
  return { buf, mime: 'audio/mpeg', provider: 'fish', model: c.model, voice: c.voice };
}

module.exports = { fishSpeech, fishKey, fishConfig, JARVIS_PTBR };
