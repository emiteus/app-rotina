/**
 * Multimodal ingress (Phase 8+) — Gemini Vision/STT + Whisper fallback.
 */
const axios = require('axios');

function detectMediaKind(message) {
  if (!message || typeof message !== 'object') return null;
  if (message.audioMessage || message.pttMessage) return 'audio';
  if (message.imageMessage) return 'image';
  if (message.videoMessage) return 'video';
  if (message.documentMessage) return 'document';
  if (message.stickerMessage) return 'sticker';
  return null;
}

function extractMediaMeta(message) {
  const kind = detectMediaKind(message);
  if (!kind) return null;
  const caption =
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    '';
  const fileName = message.documentMessage?.fileName || null;
  const mimetype =
    message.imageMessage?.mimetype ||
    message.audioMessage?.mimetype ||
    message.pttMessage?.mimetype ||
    message.videoMessage?.mimetype ||
    message.documentMessage?.mimetype ||
    message.stickerMessage?.mimetype ||
    null;
  return { kind, caption: String(caption || '').trim(), fileName, mimetype, raw: message };
}

async function fetchEvolutionMediaBase64(message) {
  if (!process.env.EVOLUTION_URL || !process.env.EVOLUTION_API_KEY || !process.env.EVOLUTION_INSTANCE) {
    return null;
  }
  const base = String(process.env.EVOLUTION_URL).replace(/\/+$/, '');
  const url = `${base}/chat/getBase64FromMediaMessage/${process.env.EVOLUTION_INSTANCE}`;
  try {
    const res = await axios.post(
      url,
      { message: { key: message.key, message } },
      {
        headers: {
          apikey: process.env.EVOLUTION_API_KEY,
          'Content-Type': 'application/json'
        },
        timeout: 25000
      }
    );
    const b64 = res.data?.base64 || res.data?.data?.base64 || null;
    return b64 ? String(b64) : null;
  } catch (err) {
    console.log(
      JSON.stringify({
        tag: 'jarvis.multimodal',
        event: 'fetch_fail',
        error: err.message
      })
    );
    return null;
  }
}

async function geminiUnderstand({ kind, base64, mime, caption }) {
  if (!process.env.GEMINI_API_KEY || !base64) return null;
  const model = process.env.JARVIS_VISION_MODEL || 'gemini-2.5-flash';
  const prompt =
    kind === 'audio'
      ? 'Transcreva o áudio em português brasileiro. Só o texto falado, sem comentários.'
      : kind === 'image' || kind === 'sticker'
        ? `Descreva a imagem em português (máx 80 palavras) focando em texto visível, números e o que o usuário provavelmente quer. Legenda do user: ${caption || '(nenhuma)'}`
        : `Resuma o conteúdo deste arquivo em português (máx 80 palavras). Nome: ${caption || ''}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
  try {
    const resp = await axios.post(
      url,
      {
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: mime || (kind === 'audio' ? 'audio/ogg' : 'image/jpeg'),
                  data: base64.replace(/^data:[^;]+;base64,/, '')
                }
              }
            ]
          }
        ],
        generationConfig: { temperature: 0.2, maxOutputTokens: 400 }
      },
      { timeout: 28000 }
    );
    const text = (resp.data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    if (text) {
      console.log(
        JSON.stringify({
          tag: 'jarvis.multimodal',
          event: 'understood',
          provider: 'gemini',
          kind,
          chars: text.length
        })
      );
    }
    return text || null;
  } catch (err) {
    console.log(
      JSON.stringify({
        tag: 'jarvis.multimodal',
        event: 'gemini_fail',
        kind,
        error: err.message
      })
    );
    return null;
  }
}

/**
 * OpenAI Whisper (or compatible) STT fallback for audio.
 * Env: OPENAI_API_KEY, optional OPENAI_BASE_URL / JARVIS_WHISPER_MODEL
 */
async function whisperTranscribe(base64, mime) {
  if (process.env.JARVIS_WHISPER === '0') return null;
  const key = process.env.OPENAI_API_KEY || process.env.JARVIS_WHISPER_KEY;
  if (!key || !base64) return null;

  const clean = String(base64).replace(/^data:[^;]+;base64,/, '');
  const buf = Buffer.from(clean, 'base64');
  if (!buf.length) return null;

  const mimeType = mime || 'audio/ogg';
  const ext = mimeType.includes('mpeg') || mimeType.includes('mp3')
    ? 'mp3'
    : mimeType.includes('wav')
      ? 'wav'
      : mimeType.includes('mp4') || mimeType.includes('m4a')
        ? 'm4a'
        : 'ogg';

  const baseUrl = String(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(
    /\/+$/,
    ''
  );
  const model = process.env.JARVIS_WHISPER_MODEL || 'whisper-1';

  try {
    const blob = new Blob([buf], { type: mimeType });
    const fd = new FormData();
    fd.append('file', blob, `audio.${ext}`);
    fd.append('model', model);
    fd.append('language', 'pt');
    fd.append('response_format', 'json');

    const resp = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: fd,
      signal: AbortSignal.timeout(45000)
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(data?.error?.message || `Whisper HTTP ${resp.status}`);
    }
    const text = String(data.text || '').trim();
    console.log(
      JSON.stringify({
        tag: 'jarvis.multimodal',
        event: 'understood',
        provider: 'whisper',
        kind: 'audio',
        chars: text.length
      })
    );
    return text || null;
  } catch (err) {
    console.log(
      JSON.stringify({
        tag: 'jarvis.multimodal',
        event: 'whisper_fail',
        error: err.message
      })
    );
    return null;
  }
}

async function ingressToText({ text, mediaMeta, fetchBase64 = true }) {
  const baseText = String(text || '').trim();
  if (!mediaMeta) {
    return { message: baseText, multimodal: false };
  }

  let understood = null;
  let provider = null;
  if (fetchBase64 && (mediaMeta.kind === 'image' || mediaMeta.kind === 'audio' || mediaMeta.kind === 'sticker')) {
    const b64 = await fetchEvolutionMediaBase64(mediaMeta.raw);
    if (b64) {
      understood = await geminiUnderstand({
        kind: mediaMeta.kind,
        base64: b64,
        mime: mediaMeta.mimetype,
        caption: mediaMeta.caption || baseText
      });
      if (understood) provider = 'gemini';

      if (!understood && mediaMeta.kind === 'audio') {
        understood = await whisperTranscribe(b64, mediaMeta.mimetype);
        if (understood) provider = 'whisper';
      }
    }
  }

  if (understood) {
    const prefix =
      mediaMeta.kind === 'audio'
        ? '[Áudio transcrito]'
        : mediaMeta.kind === 'image' || mediaMeta.kind === 'sticker'
          ? '[Imagem]'
          : '[Mídia]';
    const combined = [baseText || mediaMeta.caption, `${prefix}: ${understood}`]
      .filter(Boolean)
      .join('\n');
    return { message: combined, multimodal: true, kind: mediaMeta.kind, provider };
  }

  const kindLabel =
    mediaMeta.kind === 'audio'
      ? 'áudio'
      : mediaMeta.kind === 'image'
        ? 'imagem'
        : mediaMeta.kind === 'document'
          ? `documento${mediaMeta.fileName ? ' ' + mediaMeta.fileName : ''}`
          : mediaMeta.kind;
  if (baseText || mediaMeta.caption) {
    return {
      message: `${baseText || mediaMeta.caption}\n[anexo: ${kindLabel} — descrição automática indisponível]`,
      multimodal: true,
      kind: mediaMeta.kind,
      partial: true
    };
  }
  return {
    message: `Recebi um ${kindLabel}, mas não consegui ler o conteúdo. Manda em texto o que você precisa?`,
    multimodal: true,
    kind: mediaMeta.kind,
    needsUserText: true
  };
}

module.exports = {
  detectMediaKind,
  extractMediaMeta,
  fetchEvolutionMediaBase64,
  geminiUnderstand,
  whisperTranscribe,
  ingressToText
};
