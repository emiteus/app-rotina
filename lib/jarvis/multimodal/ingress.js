/**
 * Multimodal ingress (Vision v2) — Gemini image/PDF findings + STT + Whisper.
 * Screenshots/PDF → achados estruturados (resumo, erros, texto, sugestão).
 * Nunca executa tools — só texto pro turno.
 */
const axios = require('axios');

const MAX_MEDIA_BYTES = Number(process.env.JARVIS_VISION_MAX_BYTES || 12 * 1024 * 1024);

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

function isPdfMeta(mediaMeta) {
  const mime = String(mediaMeta?.mimetype || '').toLowerCase();
  const name = String(mediaMeta?.fileName || '').toLowerCase();
  return mime.includes('pdf') || name.endsWith('.pdf');
}

function isImageDoc(mediaMeta) {
  const mime = String(mediaMeta?.mimetype || '').toLowerCase();
  return /^image\//.test(mime);
}

function wantsVisionV2(mediaMeta, userText) {
  if (!mediaMeta) return false;
  if (mediaMeta.kind === 'image' || mediaMeta.kind === 'sticker') return true;
  if (mediaMeta.kind === 'document' && (isPdfMeta(mediaMeta) || isImageDoc(mediaMeta))) {
    return true;
  }
  const t = `${userText || ''} ${mediaMeta.caption || ''}`;
  return /\b(o\s+que\s+(est[aá]|h[aá])\s+errad|erro|bug|quebr|print|screenshot|analis[ae]|revis[ae]|olha\s+(isso|aqui))\b/i.test(
    t
  );
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
        timeout: 35000
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

function base64ByteLength(b64) {
  const clean = String(b64 || '').replace(/^data:[^;]+;base64,/, '');
  return Math.floor((clean.length * 3) / 4);
}

function visionFindingsPrompt(caption, fileName, kind) {
  const ask =
    kind === 'document'
      ? 'Analise este documento (PDF/arquivo) em português brasileiro.'
      : 'Analise esta imagem (screenshot/print/UI/erro) em português brasileiro.';
  return `${ask}
Responda EXATAMENTE neste formato (sem markdown extra):

RESUMO: <1 linha do que é>
ACHADOS:
- <bullet factual 1>
- <bullet 2>
- <bullet 3 se precisar>
ERROS: <lista curta de erros/avisos visíveis, ou "nenhum">
TEXTO_CHAVE: <mensagens, códigos HTTP, IDs, valores — máx 8 itens separados por " | ", ou "nenhum">
SUGESTAO: <1 ação concreta e curta>

Se for foto genérica sem UI/erro técnico: RESUMO curto, ACHADOS mínimos, ERROS: nenhum, SUGESTAO: diga o que o user pode pedir.
Arquivo: ${fileName || '(sem nome)'}
Legenda/pedido do user: ${caption || '(nenhuma)'}`;
}

/**
 * Parse fixed Vision v2 block into WA-friendly text.
 */
function formatVisionFindings(raw, { kind, fileName } = {}) {
  const t = String(raw || '').trim();
  if (!t) return null;

  const pick = (label) => {
    const re = new RegExp(`${label}:\\s*([\\s\\S]*?)(?=\\n(?:RESUMO|ACHADOS|ERROS|TEXTO_CHAVE|SUGESTAO):|$)`, 'i');
    const m = t.match(re);
    return m ? m[1].trim() : '';
  };

  const resumo = pick('RESUMO');
  const achadosRaw = pick('ACHADOS');
  const erros = pick('ERROS');
  const texto = pick('TEXTO_CHAVE');
  const sugestao = pick('SUGESTAO');

  // Fallback: model ignored schema
  if (!resumo && !achadosRaw) {
    const prefix = kind === 'document' ? '[PDF/Doc]' : '[Vision]';
    return `${prefix}: ${t.slice(0, 900)}`;
  }

  const achados = achadosRaw
    .split(/\n/)
    .map((l) => l.replace(/^\s*[-•*]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 6);

  const title = kind === 'document' ? '*Documento*' : '*Screenshot*';
  const lines = [title + (fileName ? ` (${fileName})` : '')];
  if (resumo) lines.push(resumo);
  if (achados.length) {
    lines.push('');
    for (const a of achados) lines.push(`• ${a}`);
  }
  if (erros && !/^nenhum$/i.test(erros)) {
    lines.push('');
    lines.push(`Erros: ${erros.slice(0, 200)}`);
  }
  if (texto && !/^nenhum$/i.test(texto)) {
    lines.push(`Texto: ${texto.slice(0, 280)}`);
  }
  if (sugestao) {
    lines.push('');
    lines.push(`→ ${sugestao.slice(0, 160)}`);
  }
  return lines.join('\n').slice(0, 1400);
}

async function geminiUnderstand({ kind, base64, mime, caption, fileName, structured }) {
  if (!process.env.GEMINI_API_KEY || !base64) return null;

  const defaultVision = process.env.JARVIS_VISION_MODEL || 'gemini-2.5-flash';
  const defaultStt = process.env.JARVIS_STT_MODEL || 'gemini-2.0-flash';
  const models =
    kind === 'audio'
      ? [
          process.env.JARVIS_STT_MODEL,
          'gemini-2.0-flash',
          'gemini-1.5-flash',
          defaultVision
        ].filter(Boolean)
      : [defaultVision];

  let prompt;
  let maxTokens = 400;
  if (kind === 'audio') {
    prompt =
      'Transcreva o áudio em português brasileiro. Só o texto falado, sem comentários.';
    maxTokens = 500;
  } else if (structured) {
    prompt = visionFindingsPrompt(caption, fileName, kind);
    maxTokens = 900;
  } else if (kind === 'image' || kind === 'sticker') {
    prompt = `Descreva a imagem em português (máx 80 palavras) focando em texto visível, números e o que o usuário provavelmente quer. Legenda: ${caption || '(nenhuma)'}`;
  } else {
    prompt = `Resuma o conteúdo deste arquivo em português (máx 120 palavras). Nome: ${fileName || caption || ''}`;
  }

  const cleanB64 = base64.replace(/^data:[^;]+;base64,/, '');
  const mimeType =
    mime ||
    (kind === 'audio'
      ? 'audio/ogg'
      : kind === 'document'
        ? 'application/pdf'
        : 'image/jpeg');

  let lastErr = null;
  for (const model of [...new Set(models)]) {
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
                    mimeType,
                    data: cleanB64
                  }
                }
              ]
            }
          ],
          generationConfig: { temperature: 0.15, maxOutputTokens: maxTokens }
        },
        { timeout: 45000 }
      );
      const text = (resp.data?.candidates?.[0]?.content?.parts || [])
        .map((p) => p.text || '')
        .join('')
        .trim();
      if (text) {
        console.log(
          JSON.stringify({
            tag: 'jarvis.multimodal',
            event: 'understood',
            provider: 'gemini',
            model,
            kind,
            structured: !!structured,
            chars: text.length
          })
        );
        return text;
      }
    } catch (err) {
      lastErr = err;
      const status = err.response?.status;
      console.log(
        JSON.stringify({
          tag: 'jarvis.multimodal',
          event: 'gemini_fail',
          kind,
          model,
          error: err.message,
          status: status || null
        })
      );
      // tenta próximo modelo em 404/400
      if (status !== 404 && status !== 400) break;
    }
  }
  if (lastErr && kind !== 'audio') {
    /* already logged */
  }
  return null;
}

/**
 * OpenAI Whisper (or compatible) STT fallback for audio.
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

function shouldFetchMedia(mediaMeta, userText) {
  if (!mediaMeta) return false;
  if (mediaMeta.kind === 'image' || mediaMeta.kind === 'audio' || mediaMeta.kind === 'sticker') {
    return true;
  }
  if (mediaMeta.kind === 'document') {
    return isPdfMeta(mediaMeta) || isImageDoc(mediaMeta) || wantsVisionV2(mediaMeta, userText);
  }
  return false;
}

async function ingressToText({ text, mediaMeta, fetchBase64 = true }) {
  const baseText = String(text || '').trim();
  if (!mediaMeta) {
    return { message: baseText, multimodal: false };
  }

  let understood = null;
  let provider = null;
  let structured = false;
  let tooLarge = false;

  if (fetchBase64 && shouldFetchMedia(mediaMeta, baseText)) {
    const b64 = await fetchEvolutionMediaBase64(mediaMeta.raw);
    if (b64) {
      const bytes = base64ByteLength(b64);
      if (bytes > MAX_MEDIA_BYTES) {
        tooLarge = true;
        console.log(
          JSON.stringify({
            tag: 'jarvis.multimodal',
            event: 'too_large',
            kind: mediaMeta.kind,
            bytes,
            max: MAX_MEDIA_BYTES
          })
        );
      } else {
        structured = wantsVisionV2(mediaMeta, baseText) && mediaMeta.kind !== 'audio';
        understood = await geminiUnderstand({
          kind: mediaMeta.kind === 'document' && isPdfMeta(mediaMeta) ? 'document' : mediaMeta.kind,
          base64: b64,
          mime:
            mediaMeta.mimetype ||
            (isPdfMeta(mediaMeta) ? 'application/pdf' : null),
          caption: mediaMeta.caption || baseText,
          fileName: mediaMeta.fileName,
          structured
        });
        if (understood) provider = 'gemini';

        if (!understood && mediaMeta.kind === 'audio') {
          understood = await whisperTranscribe(b64, mediaMeta.mimetype);
          if (understood) provider = 'whisper';
        }
      }
    }
  }

  if (understood) {
    if (structured) {
      const formatted = formatVisionFindings(understood, {
        kind: mediaMeta.kind,
        fileName: mediaMeta.fileName
      });
      const userAsked = Boolean(baseText || mediaMeta.caption);
      if (!userAsked) {
        // Print sem legenda → devolve achados direto (sem LLM repetir)
        return {
          message: formatted,
          multimodal: true,
          kind: mediaMeta.kind,
          provider,
          visionV2: true,
          directReply: true
        };
      }
      const combined = [
        userAsked ? `Pedido do usuário: ${baseText || mediaMeta.caption}` : null,
        formatted,
        'Com base nos achados acima, responda curto (diagnóstico + 1 próximo passo). Não repita a lista inteira.'
      ]
        .filter(Boolean)
        .join('\n\n');
      return {
        message: combined,
        multimodal: true,
        kind: mediaMeta.kind,
        provider,
        visionV2: true
      };
    }

    const prefix =
      mediaMeta.kind === 'audio'
        ? '[Áudio transcrito]'
        : mediaMeta.kind === 'image' || mediaMeta.kind === 'sticker'
          ? '[Imagem]'
          : mediaMeta.kind === 'document'
            ? `[Doc${mediaMeta.fileName ? ' ' + mediaMeta.fileName : ''}]`
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

  if (tooLarge) {
    return {
      message:
        (baseText || mediaMeta.caption || '') +
        `\n[anexo ${kindLabel} grande demais (>${Math.round(MAX_MEDIA_BYTES / (1024 * 1024))}MB) — manda print recortado ou PDF menor]`.trim(),
      multimodal: true,
      kind: mediaMeta.kind,
      tooLarge: true
    };
  }

  if (baseText || mediaMeta.caption) {
    return {
      message: `${baseText || mediaMeta.caption}\n[anexo: ${kindLabel} — descrição automática indisponível]`,
      multimodal: true,
      kind: mediaMeta.kind,
      partial: true
    };
  }
  // NÃO usar "Recebi…" — o infer de finanças casa /\brecebi\b/ e dispara confirmar_receita
  const failMsg =
    mediaMeta.kind === 'audio'
      ? 'Não consegui transcrever o áudio agora (STT off). Manda em **texto** o que você precisa?'
      : `Chegou um ${kindLabel}, mas não consegui ler o conteúdo. Manda em texto o que você precisa?`;
  return {
    message: failMsg,
    multimodal: true,
    kind: mediaMeta.kind,
    needsUserText: true,
    sttFailed: mediaMeta.kind === 'audio'
  };
}

module.exports = {
  detectMediaKind,
  extractMediaMeta,
  fetchEvolutionMediaBase64,
  geminiUnderstand,
  whisperTranscribe,
  formatVisionFindings,
  wantsVisionV2,
  isPdfMeta,
  ingressToText
};
