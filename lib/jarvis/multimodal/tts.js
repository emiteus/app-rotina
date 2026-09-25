/**
 * TTS outbound (Voice) — OpenAI speech (mp3) com fallback Gemini TTS (wav).
 * Env: OPENAI_API_KEY (or JARVIS_TTS_KEY), GEMINI_API_KEY, JARVIS_TTS=off|auto|always
 * Fallback: conta OpenAI sem crédito (2026-09-23) deixava o WA sem áudio e o Desktop mudo.
 */
const MAX_SPEECH_CHARS = Number(process.env.JARVIS_TTS_MAX_CHARS || 450);

function ttsMode() {
  const v = String(process.env.JARVIS_TTS || 'off').toLowerCase();
  if (v === '0' || v === 'false' || v === 'off' || v === '') return 'off';
  if (v === 'always' || v === 'on' || v === '1') return v === 'always' ? 'always' : 'auto';
  if (v === 'auto') return 'auto';
  return 'off';
}

function openaiKey() {
  return String(process.env.JARVIS_TTS_KEY || process.env.OPENAI_API_KEY || '').trim();
}

function geminiKey() {
  return String(process.env.GEMINI_API_KEY || '').trim();
}

function ttsReady() {
  if (ttsMode() === 'off') return false;
  return !!(openaiKey() || geminiKey());
}

/** Plain speech from markdown / WA formatting. */
function textForSpeech(raw) {
  let s = String(raw || '');
  s = s.replace(/\[\/?CONTEÚDO EXTERNO[^\]]*\]/g, ' ');
  s = s.replace(/\*\*(.+?)\*\*/g, '$1');
  s = s.replace(/\*(.+?)\*/g, '$1');
  s = s.replace(/_(.+?)_/g, '$1');
  s = s.replace(/`([^`]+)`/g, '$1');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
  s = s.replace(/^#+\s+/gm, '');
  s = s.replace(/^>\s?/gm, '');
  s = s.replace(/^[\s]*[-•*]\s+/gm, '');
  s = s.replace(/\n{2,}/g, '. ');
  s = s.replace(/\n/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > MAX_SPEECH_CHARS) {
    s = s.slice(0, MAX_SPEECH_CHARS - 1).replace(/\s+\S*$/, '') + '…';
  }
  return s;
}

const fold = (t) =>
  String(t || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();

/** Pediu áudio NESTA mensagem ("responde em áudio", "manda um áudio", "fala comigo por áudio"). */
function userAskedVoice(userText) {
  const t = fold(userText);
  if (userStoppedVoice(userText)) return false;
  return /\b(em|por|num)\s+(um\s+)?(audio|voz)\b|\b(manda|mande|mandar|envia|envie|grava|grave|responde|responda|fala|fale)\s+(um\s+|o\s+|me\s+)?(audio|voz)\b|\bvoice\s*note\b|\bfala\s+(pra|para)\s+mim\b/.test(
    t
  );
}

/** "a partir de agora responde em áudio" / "sempre em áudio" → modo áudio contínuo (até pedir pra parar). */
function userWantsVoiceMode(userText) {
  const t = fold(userText);
  return userAskedVoice(userText) && /\b(a partir de agora|daqui pra frente|daqui para frente|sempre|de agora em diante)\b/.test(t);
}

/** "para de mandar áudio", "não precisa de áudio", "só texto", "sem áudio"… */
function userStoppedVoice(userText) {
  const t = fold(userText);
  return /\b(so|somente|apenas)\s+(por\s+)?texto\b|\bsem\s+(audio|voz)\b|\b(para|pare|parar|chega)\s+de\s+(mandar|enviar|responder\s+(com|em|por)|falar|audio|voz)|\bnao\s+(precisa|quero|manda|mande|envia|envie)\s+(de\s+|mais\s+)?(mandar\s+|enviar\s+)?(o\s+|os\s+)?(audio|audios|voz)\b|\bchega\s+de\s+(audio|voz)\b/.test(
    t
  );
}

/**
 * Áudio no WhatsApp (24/09/2026, pedido do Mateus): SÓ quando ele pede. Padrão é texto, inclusive
 * quando ele manda áudio. "responde em áudio" = só essa resposta; "a partir de agora em áudio" =
 * modo contínuo até "para de mandar áudio". Antes: áudio recebido ligava uma sessão de voz que cada
 * resposta renovava (não acabava nunca) e "não precisa enviar áudios" não desligava.
 * @param {{ userText?: string, mediaKind?: string|null, resposta?: string, pendingHitl?: boolean, userId?: string }} opts
 */
function shouldReplyWithVoice(opts = {}) {
  const session = () => require('./voice-session');
  if (userStoppedVoice(opts.userText)) {
    try {
      session().clearVoiceSession(opts.userId);
    } catch {
      /* ignore */
    }
    return false;
  }
  if (userWantsVoiceMode(opts.userText)) {
    try {
      session().touchVoiceSession(opts.userId);
    } catch {
      /* ignore */
    }
  }
  if (!ttsReady()) return false;
  if (opts.pendingHitl) return false; // HITL fica em texto
  const speech = textForSpeech(opts.resposta);
  if (!speech || speech.length < 8) return false;
  // Respostas muito longas / dumps (logs) → só texto
  if (String(opts.resposta || '').length > 1200) return false;
  if (/```|Logs Railway|\*Redeploy\*|\*Restart\*/i.test(String(opts.resposta || ''))) {
    return false;
  }
  const mode = ttsMode();
  if (mode === 'off') return false;
  if (mode === 'always') return true;
  if (userAskedVoice(opts.userText)) return true;
  try {
    return session().isVoiceSessionActive(opts.userId);
  } catch {
    return false;
  }
}

/** OpenAI sem crédito/limite → pula ela por 10 min (estado compartilhado com o ouvir). */
const openaiHealth = require('./openai-health');

async function openaiSpeech(speech, voice, timeoutMs = 45000) {
  const baseUrl = String(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = process.env.JARVIS_TTS_MODEL || 'tts-1';
  const resp = await fetch(`${baseUrl}/audio/speech`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${openaiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, voice, input: speech, response_format: 'mp3' }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '');
    openaiHealth.noteHttpFailure(resp.status, errBody);
    throw new Error(`OpenAI TTS HTTP ${resp.status}: ${errBody.slice(0, 120)}`);
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  return buf.length ? { buf, mime: 'audio/mpeg', provider: 'openai', model, voice } : null;
}

/** PCM 16-bit mono → WAV (cabeçalho RIFF de 44 bytes). */
function pcmToWav(pcm, sampleRate) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/**
 * Voz do Gemini com pedido reserva: a mesma frase leva 3,5 s numa hora e 20 s noutra (medido 24/09/2026).
 * Se a 1ª não chega em 2 s, pede a 2ª; a primeira que chegar ganha e a outra é cancelada.
 */
async function geminiSpeech(speech, voice, timeoutMs = 45000, deps = {}) {
  const once = deps.once || geminiSpeechOnce;
  const { hedge } = require('../hedge');
  const out = await hedge(
    [0, 1].map(() => (signal) => once(speech, voice, timeoutMs, signal)),
    { delayMs: Number(process.env.JARVIS_TTS_HEDGE_MS || 2000) }
  );
  if (!out) throw new Error('Gemini TTS sem áudio');
  return out;
}

/** Cancela no prazo OU quando o pedido reserva ganha (sem AbortSignal.any: Node do Railway não é fixo). */
function bothSignals(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  const ctrl = new AbortController();
  const stop = () => ctrl.abort();
  if (signal.aborted) stop();
  signal.addEventListener('abort', stop, { once: true });
  timeout.addEventListener('abort', stop, { once: true });
  return ctrl.signal;
}

/**
 * Instrução de estilo fixa na frente do texto (25/09/2026). Sem ela a Charon muda de tom/sotaque/ritmo a
 * cada geração ("muda de voz frequentemente") e fala pausado. Medido na mesma frase: sem estilo 9,5–10 s;
 * com esta 7,3–7,5 s e estável. Instrução em PORTUGUÊS era lida em voz alta (áudio ficou 11 s) — manter
 * em inglês, curta, terminando em ":". JARVIS_TTS_STYLE="" desliga.
 */
const TTS_STYLE_PADRAO = 'Say in Brazilian Portuguese, in a fast-paced, confident and steady tone: ';
function ttsStyle() {
  return process.env.JARVIS_TTS_STYLE != null ? process.env.JARVIS_TTS_STYLE : TTS_STYLE_PADRAO;
}

async function geminiSpeechOnce(speech, voice, timeoutMs = 45000, signal = null) {
  const model = process.env.JARVIS_TTS_GEMINI_MODEL || 'gemini-2.5-flash-preview-tts';
  const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': geminiKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: ttsStyle() + speech }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } }
      }
    }),
    signal: bothSignals(signal, timeoutMs)
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`Gemini TTS HTTP ${resp.status}: ${JSON.stringify(data).slice(0, 120)}`);
  const part = (data.candidates?.[0]?.content?.parts || []).find((x) => x.inlineData);
  if (!part) throw new Error('Gemini TTS sem áudio');
  const rate = Number((String(part.inlineData.mimeType || '').match(/rate=(\d+)/) || [])[1]) || 24000;
  const wav = pcmToWav(Buffer.from(part.inlineData.data, 'base64'), rate);
  return { buf: wav, mime: 'audio/wav', provider: 'gemini', model, voice };
}

/**
 * @param {string} text
 * @param {{ voice?: string, geminiVoice?: string, force?: boolean, timeoutMs?: number, providers?: string[] }} [opts]
 *   providers: ['openai'] no Desktop — Gemini TTS leva 35–40 s (testado 2026-09-23), aí o PC fala com a voz local
 *   force: ignora JARVIS_TTS=off (Desktop pediu voz explicitamente)
 *   timeoutMs: orçamento TOTAL (Desktop usa curto e cai pra voz local do Windows)
 * @returns {Promise<{ base64: string, mime: string, chars: number, voice: string, provider: string }|null>}
 */
async function synthesizeSpeech(text, opts = {}) {
  if (!opts.force && !ttsReady()) return null;
  const speech = textForSpeech(text);
  if (!speech) return null;

  const deadline = Date.now() + (opts.timeoutMs || 90000);
  const left = () => Math.min(45000, deadline - Date.now());
  const allow = (p) => !opts.providers || opts.providers.includes(p);
  const byProvider = {
    openai:
      allow('openai') && openaiKey() && !openaiHealth.isDown()
        ? () => openaiSpeech(speech, opts.voice || process.env.JARVIS_TTS_VOICE || 'nova', left())
        : null,
    gemini:
      allow('gemini') && geminiKey()
        ? () => geminiSpeech(speech, opts.geminiVoice || process.env.JARVIS_TTS_GEMINI_VOICE || 'Charon', left())
        : null
  };
  // A voz do Jarvis é a Charon (Gemini); OpenAI é só reserva se o Google falhar (24/09/2026).
  // JARVIS_TTS_ORDER=openai,gemini inverte.
  const order = String(process.env.JARVIS_TTS_ORDER || 'gemini,openai')
    .split(',')
    .map((x) => x.trim())
    .filter((x) => byProvider[x]);
  const attempts = [...new Set(order)].map((p) => byProvider[p]);

  for (const attempt of attempts) {
    if (left() < 1500) break;
    try {
      const out = await attempt();
      if (!out) continue;
      console.log(
        JSON.stringify({
          tag: 'jarvis.tts',
          event: 'ok',
          provider: out.provider,
          chars: speech.length,
          bytes: out.buf.length,
          voice: out.voice,
          model: out.model
        })
      );
      return {
        base64: out.buf.toString('base64'),
        mime: out.mime,
        chars: speech.length,
        voice: out.voice,
        provider: out.provider
      };
    } catch (err) {
      console.log(JSON.stringify({ tag: 'jarvis.tts', event: 'fail', error: err.message }));
    }
  }
  return null;
}

module.exports = {
  ttsMode,
  ttsReady,
  textForSpeech,
  userAskedVoice,
  shouldReplyWithVoice,
  geminiSpeech,
  geminiSpeechOnce,
  ttsStyle,
  userAskedVoice,
  userStoppedVoice,
  userWantsVoiceMode,
  synthesizeSpeech,
  pcmToWav
};
