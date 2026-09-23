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

/** Imagem citada no reply WA (contextInfo.quotedMessage). */
function extractQuotedMediaMeta(message) {
  if (!message || typeof message !== 'object') return null;
  const quoted =
    message.extendedTextMessage?.contextInfo?.quotedMessage ||
    message.contextInfo?.quotedMessage ||
    message.imageMessage?.contextInfo?.quotedMessage ||
    null;
  if (!quoted || typeof quoted !== 'object') return null;
  const meta = extractMediaMeta(quoted);
  if (!meta) return null;
  return { ...meta, raw: quoted, fromQuote: true };
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

/**
 * Media anexada OU imagem citada no reply.
 */
function resolveTurnMedia(message) {
  const direct = extractMediaMeta(message);
  if (direct) return direct;
  return extractQuotedMediaMeta(message);
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

/**
 * Print → blueprint de layout (zonas / hierarquia / copy).
 * Ex.: "reproduz esse layout", "copia a estrutura", "wireframe disso"
 */
function wantsLayoutReproduce(mediaMeta, userText) {
  if (!mediaMeta) return false;
  if (mediaMeta.kind === 'audio') return false;
  const t = `${userText || ''} ${mediaMeta.caption || ''}`;
  return looksLikeLayoutReproduceMessage(t) || looksLikeLayoutTweakMessage(t);
}

/** Detecção só por texto (também pra bloquear LLM inventando arte). */
function looksLikeLayoutReproduceMessage(mensagem) {
  const t = String(mensagem || '');
  return /\b(reproduz(a|ir)?|reproduzir|copia(r)?|imita(r)?|clone|wireframe|blueprint|estrutura\s+(d[aeo]|desse|dessa)|layout\s+(d[aeo]|desse|dessa)|monta\s+(igual|parecido)|faz\s+(igual|parecido)\s+(ao|a\s+esse)?\s*layout|mesma\s+composi[cç][aã]o)\b/i.test(
    t
  );
}

/**
 * Follow-up de ajuste no layout já gerado (sem "reproduz").
 * Ex.: "afasta os escudos do ODD", "aproxima um pouco", "deixa os logos maiores"
 */
function looksLikeLayoutTweakMessage(mensagem) {
  const t = String(mensagem || '').trim();
  if (t.length < 4 || t.length > 280) return false;
  if (looksLikeLayoutReproduceMessage(t)) return false;
  // Pedido de arte nova do zero — não é tweak
  if (/\b(gera|crie|cria|faz)\s+(uma?\s+)?(imagem|arte|banner|poster)\b/i.test(t) && !/\b(afasta|aproxima|ajusta|espa[cç]a)/i.test(t)) {
    return false;
  }
  const hasAction =
    /\b(afasta|aproxima|espa[cç]a|afastar|aproximar|espa[cç]ar|move|mover|sobe|desce|esquerda|direita|maior|menor|aumenta|diminui|ajusta|ajuste|centraliza|alinha)\b/i.test(
      t
    ) ||
    /\b(um\s+pouquinho|um\s+pouco|mais\s+longe|mais\s+perto|mais\s+espa[cç]o)\b/i.test(t);
  if (!hasAction) return false;
  // Preferível ter alvo visual, mas "afasta um pouco" após layout também vale
  const hasTarget =
    /\b(escudo|escudos|logo|logos|bras[aã]o|bras[oõ]es|crest|odd|ood|badge|t[ií]tulo|texto|headline|imagem|layout|template)\b/i.test(
      t
    ) ||
    /\b(eles|eles|deles|dela|isso|esse|essa)\b/i.test(t) ||
    /\b(afasta|aproxima|espa[cç]a).{0,40}\b(do|da|dos|das)\b/i.test(t);
  return hasTarget || hasAction;
}

/**
 * Pedido de editar/gerar a partir do layout (não só descrever).
 */
function wantsLayoutImageEdit(userText, caption) {
  const t = `${userText || ''} ${caption || ''}`;
  if (looksLikeLayoutTweakMessage(t)) return true;
  if (!/\breproduz|\bcopia|\bimita|\bclone|\bwireframe|\bblueprint|\blayout\b/i.test(t)) {
    return false;
  }
  return true;
}

function shortLayoutCaption(userRequest) {
  const t = String(userRequest || '')
    .replace(/\breproduz(a|ir)?\s+(esse|este|o)?\s*layout\s*/i, '')
    .replace(/\bcopia(r)?\s+(a\s+)?estrutura\s*/i, '')
    .replace(/\bs[oó]\s+que\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  if (t.length >= 4) return t;
  return 'Mesmo layout · edição pedida';
}

function visionLayoutPrompt(caption, fileName, kind) {
  const ask =
    kind === 'document'
      ? 'Extraia o blueprint visual deste documento/página.'
      : 'Extraia o blueprint visual desta screenshot/UI.';
  return `${ask} Português brasileiro.
Responda APENAS JSON válido (sem markdown) com este shape:
{
  "tipo": "landing|app|dashboard|email|card|outro",
  "resumo": "1 linha do que a tela é",
  "hierarquia": ["header","hero","features","cta","footer"],
  "zonas": [
    {"id":"hero","papel":"proposta de valor","copy":"texto visível curto","notas":"layout/alinhamento"}
  ],
  "palette": ["#hex ou nome de cor dominante"],
  "ctas": ["texto do botão principal"],
  "textos_fixidos": ["strings EXATAS visíveis na arte, ex. headline e ODD"],
  "tipografia": "serifa/sans, pesos se der pra ver",
  "tratamentos": {
    "logos": "descreva contorno/stroke (cor+espessura), sombra, glow, bevel nos logos/escudos/ícones substituíveis",
    "textos": "descreva outline/stroke e efeitos nos textos principais",
    "outros": "quaisquer efeitos repetidos que definam o estilo do template"
  },
  "sugestao": "1 próximo passo pra recriar (copy ou imagem)"
}
Máx 6 zonas. Copy e textos_fixidos = só o que está legível. Não invente marca/produto.
Em "tratamentos", seja específico (ex.: "stroke preto grosso ~6–10px ao redor dos dois logos"; "headline com outline preto + bevel").
Arquivo: ${fileName || '(sem nome)'}
Pedido: ${caption || '(nenhum)'}`;
}

/**
 * Parse JSON de layout (tolerante a fences / lixo).
 */
function parseLayoutJson(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  try {
    const obj = JSON.parse(s);
    if (!obj || typeof obj !== 'object') return null;
    return obj;
  } catch {
    return null;
  }
}

/**
 * Blueprint → texto WA (~1.4k).
 */
function formatLayoutBlueprint(rawOrObj, { fileName } = {}) {
  const obj = typeof rawOrObj === 'string' ? parseLayoutJson(rawOrObj) : rawOrObj;
  if (!obj) {
    const t = String(rawOrObj || '').trim();
    if (!t) return null;
    return `*Layout*\n${t.slice(0, 900)}`;
  }

  const lines = [`*Layout*${fileName ? ` (${fileName})` : ''}`];
  if (obj.tipo) lines.push(`Tipo: ${String(obj.tipo).slice(0, 40)}`);
  if (obj.resumo) lines.push(String(obj.resumo).slice(0, 160));

  const hier = Array.isArray(obj.hierarquia) ? obj.hierarquia.map(String).slice(0, 8) : [];
  if (hier.length) {
    lines.push('');
    lines.push(`Fluxo: ${hier.join(' → ')}`);
  }

  const zonas = Array.isArray(obj.zonas) ? obj.zonas.slice(0, 6) : [];
  if (zonas.length) {
    lines.push('');
    for (const z of zonas) {
      const id = String((z && (z.id || z.nome)) || 'zona').slice(0, 24);
      const papel = z && z.papel ? String(z.papel).slice(0, 80) : '';
      const copy = z && z.copy ? String(z.copy).slice(0, 100) : '';
      const notas = z && z.notas ? String(z.notas).slice(0, 80) : '';
      let line = `• **${id}**`;
      if (papel) line += ` — ${papel}`;
      if (copy) line += `\n  “${copy}”`;
      if (notas) line += `\n  (${notas})`;
      lines.push(line);
    }
  }

  const palette = Array.isArray(obj.palette) ? obj.palette.map(String).slice(0, 5) : [];
  if (palette.length) {
    lines.push('');
    lines.push(`Cores: ${palette.join(' · ')}`);
  }
  if (obj.tipografia) lines.push(`Tipo: ${String(obj.tipografia).slice(0, 80)}`);
  if (obj.tratamentos && typeof obj.tratamentos === 'object') {
    const t = obj.tratamentos;
    const bits = [t.logos, t.textos, t.outros].filter(Boolean).map((x) => String(x).slice(0, 100));
    if (bits.length) {
      lines.push('');
      lines.push(`Tratamentos: ${bits.join(' · ')}`);
    }
  }

  const ctas = Array.isArray(obj.ctas) ? obj.ctas.map(String).slice(0, 4) : [];
  if (ctas.length) lines.push(`CTAs: ${ctas.join(' | ')}`);

  if (obj.sugestao) {
    lines.push('');
    lines.push(`→ ${String(obj.sugestao).slice(0, 160)}`);
  } else {
    lines.push('');
    lines.push('→ Quer copy/imagem a partir disso? Fala `prepara landing` ou `gera imagem`.');
  }

  return lines.join('\n').slice(0, 1400);
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

async function geminiUnderstand({
  kind,
  base64,
  mime,
  caption,
  fileName,
  structured,
  layoutMode
}) {
  if (!process.env.GEMINI_API_KEY || !base64) return null;

  // 2.0/1.5/2.5-flash foram desligados (404) → STT e visão estavam mortos em produção.
  // Visão tinha UM modelo só, sem fallback. 3.5-flash-lite transcreve pt-BR em ~2 s.
  const models =
    kind === 'audio'
      ? [process.env.JARVIS_STT_MODEL, 'gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-flash-lite-latest']
      : [process.env.JARVIS_VISION_MODEL, 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-flash-latest'];
  const modelList = models.filter(Boolean);

  let prompt;
  let maxTokens = 400;
  let jsonMode = false;
  if (kind === 'audio') {
    prompt =
      // Nome do assistente no prompt: o começo de "Jarvis" chega cortado e virava "Alexa"
      'Transcreva o áudio em português brasileiro. O assistente se chama Jarvis. ' +
      'Só o texto falado, sem comentários.';
    maxTokens = 500;
  } else if (layoutMode) {
    prompt = visionLayoutPrompt(caption, fileName, kind);
    maxTokens = 1200;
    jsonMode = true;
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
  for (const model of [...new Set(modelList)]) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
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
          generationConfig: {
            temperature: layoutMode ? 0.2 : 0.15,
            maxOutputTokens: maxTokens,
            ...(jsonMode ? { responseMimeType: 'application/json' } : {})
          }
        },
        { timeout: 45000, headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY } }
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
            layoutMode: !!layoutMode,
            jsonMode,
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
          layoutMode: !!layoutMode,
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

async function tryLayoutImageEdit({ mediaMeta, mediaB64, userAsk, layoutObj }) {
  const { generateImage, buildLockedReproducePrompt, creativeEnabled, detectImageSize, nearestAspectRatio } =
    require('./creative');
  const canRefImage =
    mediaMeta.kind === 'image' ||
    mediaMeta.kind === 'sticker' ||
    isImageDoc(mediaMeta);
  const cleanB64 = String(mediaB64 || '')
    .replace(/^data:[^;]+;base64,/, '')
    .replace(/\s+/g, '');
  if (!canRefImage || !cleanB64) return null;

  // Assets oficiais via Commons — só se o pedido pedir troca de logos (não em tweak de espaçamento)
  let crestAssets = [];
  const isTweak = looksLikeLayoutTweakMessage(userAsk);
  if (!isTweak) {
    try {
      const { resolveVisualAssets } = require('./visual-assets');
      const resolved = await resolveVisualAssets(userAsk);
      crestAssets = resolved.assets || [];
      if (resolved.unresolved) {
        console.log(
          JSON.stringify({
            tag: 'jarvis.asset',
            event: 'unresolved',
            missing: resolved.missing || null,
            pair: resolved.pair?.raw || null
          })
        );
      }
    } catch (e) {
      console.log(
        JSON.stringify({
          tag: 'jarvis.asset',
          event: 'resolve_fail',
          error: String(e.message || e).slice(0, 120)
        })
      );
    }
  }

  const cap = shortLayoutCaption(userAsk);

  // 1) Gemini + assets oficiais — preserva tipografia/layout (o que o user preferia)
  if (creativeEnabled()) {
    const prompt = buildLockedReproducePrompt(layoutObj, userAsk, { crestAssets });
    const size = detectImageSize(cleanB64);
    const aspect = size ? nearestAspectRatio(size.width, size.height) : '1:1';
    const img = await generateImage(prompt, {
      referenceImage: {
        base64: cleanB64,
        mime: mediaMeta.mimetype || 'image/jpeg'
      },
      extraImages: crestAssets.map((c) => ({
        base64: c.base64,
        mime: c.mime,
        label: `${c.slot === 'right' ? 'RIGHT' : 'LEFT'} crest = ${c.name} (paste pixels, do not redraw)`,
        slot: c.slot
      })),
      aspectRatio: aspect,
      matchReferenceAspect: true,
      imageSize: process.env.JARVIS_LAYOUT_IMAGE_SIZE || '2K',
      maxPromptChars: 3500
    });
    if (img && img.base64) {
      console.log(
        JSON.stringify({
          tag: 'jarvis.multimodal',
          event: 'layout_image_ok',
          model: img.model,
          aspectRatio: img.aspectRatio || aspect,
          crests: crestAssets.map((c) => c.name),
          crestFiles: crestAssets.map((c) => c.file),
          assetSource: 'wikimedia_commons_search',
          refSize: size || img.refSize || null,
          bytesApprox: Math.floor((img.base64.length * 3) / 4)
        })
      );
      return {
        message: `Pronto — mesma estrutura.\n${cap}`,
        multimodal: true,
        kind: mediaMeta.kind,
        provider: 'gemini',
        visionV2: true,
        layoutReproduce: true,
        directReply: true,
        image_base64: img.base64,
        mime: img.mime || 'image/png',
        caption: cap
      };
    }
    console.log(
      JSON.stringify({
        tag: 'jarvis.multimodal',
        event: 'layout_image_fail',
        crests: crestAssets.map((c) => c.name)
      })
    );
  }

  // 2) Compose sharp — opt-in (JARVIS_LAYOUT_COMPOSE=1). Default off: sticker ruins template.
  if (process.env.JARVIS_LAYOUT_COMPOSE === '1' && crestAssets.length >= 2) {
    try {
      const { tryComposeLayoutReplace } = require('./compose');
      const composed = await tryComposeLayoutReplace({
        templateBase64: cleanB64,
        templateMime: mediaMeta.mimetype || 'image/jpeg',
        userAsk,
        assets: crestAssets
      });
      if (composed && composed.base64) {
        console.log(
          JSON.stringify({
            tag: 'jarvis.multimodal',
            event: 'layout_compose_ok',
            method: composed.method,
            slotSource: composed.slotSource,
            assets: crestAssets.map((c) => c.name),
            files: crestAssets.map((c) => c.file),
            fallback: true
          })
        );
        return {
          message: `Pronto — mesma estrutura.\n${cap}`,
          multimodal: true,
          kind: mediaMeta.kind,
          provider: 'compose',
          visionV2: true,
          layoutReproduce: true,
          directReply: true,
          image_base64: composed.base64,
          mime: composed.mime || 'image/png',
          caption: cap
        };
      }
    } catch (err) {
      console.log(
        JSON.stringify({
          tag: 'jarvis.multimodal',
          event: 'layout_compose_fail',
          error: String(err.message || err).slice(0, 200)
        })
      );
    }
  }

  return null;
}

async function ingressToText({ text, mediaMeta, fetchBase64 = true }) {
  const baseText = String(text || '').trim();
  if (!mediaMeta) {
    return { message: baseText, multimodal: false };
  }

  const userAsk = String(mediaMeta.caption || baseText || '').trim();
  const layoutMode =
    wantsLayoutReproduce(mediaMeta, baseText) && mediaMeta.kind !== 'audio';

  let understood = null;
  let provider = null;
  let structured = false;
  let tooLarge = false;
  let mediaB64 = null;

  if (fetchBase64 && shouldFetchMedia(mediaMeta, baseText)) {
    const b64 = await fetchEvolutionMediaBase64(mediaMeta.raw);
    if (b64) {
      mediaB64 = b64;
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
      } else if (layoutMode) {
        // Layout: tenta JSON (opcional) + SEMPRE tenta imagem travada.
        // Nunca deixa cair no LLM (ele inventa VS/cinematic).
        try {
          understood = await geminiUnderstand({
            kind:
              mediaMeta.kind === 'document' && isPdfMeta(mediaMeta)
                ? 'document'
                : mediaMeta.kind,
            base64: b64,
            mime: mediaMeta.mimetype || null,
            caption: userAsk,
            fileName: mediaMeta.fileName,
            layoutMode: true
          });
          if (understood) provider = 'gemini';
        } catch (e) {
          console.log(
            JSON.stringify({
              tag: 'jarvis.multimodal',
              event: 'layout_vision_fail',
              error: String(e.message || e).slice(0, 160)
            })
          );
        }

        const layoutObj = parseLayoutJson(understood);
        if (wantsLayoutImageEdit(baseText, mediaMeta.caption)) {
          try {
            const imgOut = await tryLayoutImageEdit({
              mediaMeta,
              mediaB64,
              userAsk,
              layoutObj
            });
            if (imgOut) return imgOut;
          } catch (err) {
            console.log(
              JSON.stringify({
                tag: 'jarvis.multimodal',
                event: 'layout_image_fail',
                error: String(err.message || err).slice(0, 200)
              })
            );
          }
        }

        if (understood) {
          return {
            message: formatLayoutBlueprint(layoutObj || understood, {
              fileName: mediaMeta.fileName
            }),
            multimodal: true,
            kind: mediaMeta.kind,
            provider: provider || 'gemini',
            visionV2: true,
            layoutReproduce: true,
            directReply: true
          };
        }

        return {
          message:
            'Vi o pedido de reproduzir o layout, mas falhei ao gerar a imagem agora. Manda o print de novo em 1 min?',
          multimodal: true,
          kind: mediaMeta.kind,
          layoutReproduce: true,
          directReply: true,
          needsRetry: true
        };
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
          structured,
          layoutMode: false
        });
        if (understood) provider = 'gemini';

        if (!understood && mediaMeta.kind === 'audio') {
          understood = await whisperTranscribe(b64, mediaMeta.mimetype);
          if (understood) provider = 'whisper';
        }
      }
    }
  }

  // Layout sem bytes (fetch fail) — ainda assim NÃO manda pro LLM inventar arte
  if (layoutMode) {
    return {
      message:
        tooLarge
          ? `Print grande demais (>${Math.round(MAX_MEDIA_BYTES / (1024 * 1024))}MB) pra reproduzir. Manda recortado.`
          : 'Não consegui baixar o print pra reproduzir o layout. Manda de novo?',
      multimodal: true,
      kind: mediaMeta.kind,
      layoutReproduce: true,
      directReply: true,
      tooLarge: !!tooLarge
    };
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
        `Pedido do usuário: ${baseText || mediaMeta.caption}`,
        require('../safety/external-content').wrapExternalContent(formatted, {
          source: 'vision'
        }),
        'Com base nos achados acima, responda curto (diagnóstico + 1 próximo passo). Não repita a lista inteira.'
      ].join('\n\n');
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
    // Áudio é o próprio usuário falando (número na whitelist) = pedido, não conteúdo externo.
    // Envolver fazia o LLM ignorar o comando e o histórico apagar o que foi dito.
    const mediaBlob =
      mediaMeta.kind === 'audio'
        ? `${prefix}: ${require('../safety/external-content').neutralizeMarkers(understood)}`
        : require('../safety/external-content').wrapExternalContent(`${prefix}: ${understood}`, {
            source: 'vision'
          });
    const combined = [baseText || mediaMeta.caption, mediaBlob].filter(Boolean).join('\n');
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
  extractQuotedMediaMeta,
  resolveTurnMedia,
  fetchEvolutionMediaBase64,
  geminiUnderstand,
  whisperTranscribe,
  formatVisionFindings,
  formatLayoutBlueprint,
  parseLayoutJson,
  visionLayoutPrompt,
  wantsVisionV2,
  wantsLayoutReproduce,
  looksLikeLayoutReproduceMessage,
  looksLikeLayoutTweakMessage,
  wantsLayoutImageEdit,
  shortLayoutCaption,
  isPdfMeta,
  tryLayoutImageEdit,
  ingressToText
};
