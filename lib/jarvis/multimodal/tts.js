/**
 * TTS outbound (Voice) — OpenAI speech → base64 for Evolution PTT.
 * Env: OPENAI_API_KEY (or JARVIS_TTS_KEY), JARVIS_TTS=off|auto|always
 */
const MAX_SPEECH_CHARS = Number(process.env.JARVIS_TTS_MAX_CHARS || 450);

function ttsMode() {
  const v = String(process.env.JARVIS_TTS || 'off').toLowerCase();
  if (v === '0' || v === 'false' || v === 'off' || v === '') return 'off';
  if (v === 'always' || v === 'on' || v === '1') return v === 'always' ? 'always' : 'auto';
  if (v === 'auto') return 'auto';
  return 'off';
}

function ttsReady() {
  if (ttsMode() === 'off') return false;
  const key = process.env.JARVIS_TTS_KEY || process.env.OPENAI_API_KEY;
  return !!String(key || '').trim();
}

/** Plain speech from markdown / WA formatting. */
function textForSpeech(raw) {
  let s = String(raw || '');
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

function userAskedVoice(userText) {
  return /\b(em\s+[aá]udio|por\s+voz|responde\s+(em\s+)?voz|manda\s+(em\s+)?[aá]udio|fala\s+pra\s+mim|voice\s*note)\b/i.test(
    String(userText || '')
  );
}

/**
 * Decide if this turn should also send a voice note.
 * @param {{ userText?: string, mediaKind?: string|null, resposta?: string, pendingHitl?: boolean, userId?: string }} opts
 */
function shouldReplyWithVoice(opts = {}) {
  if (!ttsReady()) return false;
  if (opts.pendingHitl) return false; // HITL fica em texto
  const speech = textForSpeech(opts.resposta);
  if (!speech || speech.length < 8) return false;
  // Respostas muito longas / dumps (logs) → só texto
  if (String(opts.resposta || '').length > 1200) return false;
  if (/```|Logs Railway|\*Redeploy\*|\*Restart\*/i.test(String(opts.resposta || ''))) {
    return false;
  }

  // "para de falar" / "só texto" encerra sessão contínua
  if (/\b(s[oó]\s+texto|para\s+de\s+falar|sem\s+[aá]udio|chega\s+de\s+voz)\b/i.test(String(opts.userText || ''))) {
    try {
      require('./voice-session').clearVoiceSession(opts.userId);
    } catch {
      /* ignore */
    }
    return false;
  }

  const mode = ttsMode();
  if (mode === 'always') return true;
  if (mode === 'auto') {
    if (opts.mediaKind === 'audio') {
      try {
        require('./voice-session').touchVoiceSession(opts.userId);
      } catch {
        /* ignore */
      }
      return true;
    }
    if (userAskedVoice(opts.userText)) {
      try {
        require('./voice-session').touchVoiceSession(opts.userId);
      } catch {
        /* ignore */
      }
      return true;
    }
    // Sessão contínua: depois de áudio, próximos textos ainda saem em voz (TTL)
    try {
      if (require('./voice-session').isVoiceSessionActive(opts.userId)) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

/**
 * @returns {Promise<{ base64: string, mime: string, chars: number, voice: string }|null>}
 */
async function synthesizeSpeech(text, opts = {}) {
  if (!ttsReady()) return null;
  const speech = textForSpeech(text);
  if (!speech) return null;

  const key = String(process.env.JARVIS_TTS_KEY || process.env.OPENAI_API_KEY).trim();
  const baseUrl = String(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(
    /\/+$/,
    ''
  );
  const model = process.env.JARVIS_TTS_MODEL || 'tts-1';
  const voice = opts.voice || process.env.JARVIS_TTS_VOICE || 'nova';

  try {
    const resp = await fetch(`${baseUrl}/audio/speech`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        voice,
        input: speech,
        response_format: 'mp3'
      }),
      signal: AbortSignal.timeout(45000)
    });
    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      throw new Error(`TTS HTTP ${resp.status}: ${errBody.slice(0, 120)}`);
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    if (!buf.length) return null;
    console.log(
      JSON.stringify({
        tag: 'jarvis.tts',
        event: 'ok',
        chars: speech.length,
        bytes: buf.length,
        voice,
        model
      })
    );
    return {
      base64: buf.toString('base64'),
      mime: 'audio/mpeg',
      chars: speech.length,
      voice
    };
  } catch (err) {
    console.log(
      JSON.stringify({
        tag: 'jarvis.tts',
        event: 'fail',
        error: err.message
      })
    );
    return null;
  }
}

module.exports = {
  ttsMode,
  ttsReady,
  textForSpeech,
  userAskedVoice,
  shouldReplyWithVoice,
  synthesizeSpeech
};
