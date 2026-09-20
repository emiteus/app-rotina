/**
 * Layout compositor — cola assets nos slots do template (sharp).
 * Capacidade geral: não redesenha logo; cola pixels resolvidos (Commons etc.).
 */
const axios = require('axios');
const path = require('path');

function loadSharp() {
  try {
    return require('sharp');
  } catch (_) {
    /* try host app-rotina node_modules when synced */
  }
  try {
    return require(path.join(__dirname, '..', '..', '..', 'node_modules', 'sharp'));
  } catch (_) {
    /* Jarvis mono: ../Approtina/app-rotina/node_modules */
  }
  try {
    return require(path.join(
      __dirname,
      '..',
      '..',
      '..',
      'Approtina',
      'app-rotina',
      'node_modules',
      'sharp'
    ));
  } catch (_) {
    return null;
  }
}

function bufFromBase64(b64) {
  return Buffer.from(
    String(b64 || '')
      .replace(/^data:[^;]+;base64,/, '')
      .replace(/\s+/g, ''),
    'base64'
  );
}

/**
 * Normaliza slot {x,y,w,h} em pixels, clamp na imagem.
 */
function normalizeSlot(slot, imgW, imgH) {
  if (!slot || !imgW || !imgH) return null;
  let x = Number(slot.x);
  let y = Number(slot.y);
  let w = Number(slot.w ?? slot.width);
  let h = Number(slot.h ?? slot.height);
  if (![x, y, w, h].every((n) => Number.isFinite(n))) return null;

  // Se veio normalizado 0–1
  if (w <= 1.5 && h <= 1.5 && x <= 1.5 && y <= 1.5) {
    x *= imgW;
    y *= imgH;
    w *= imgW;
    h *= imgH;
  }

  x = Math.max(0, Math.round(x));
  y = Math.max(0, Math.round(y));
  w = Math.max(8, Math.round(w));
  h = Math.max(8, Math.round(h));
  if (x + w > imgW) w = imgW - x;
  if (y + h > imgH) h = imgH - y;
  if (w < 8 || h < 8) return null;
  return {
    id: String(slot.id || slot.slot || 'slot'),
    x,
    y,
    w,
    h
  };
}

/**
 * Heurística: dois slots esquerda/direita na metade inferior-central (cards de odds).
 * Usada se a visão falhar.
 */
function heuristicPairSlots(imgW, imgH) {
  const box = Math.round(Math.min(imgW, imgH) * 0.22);
  const y = Math.round(imgH * 0.42);
  const leftX = Math.round(imgW * 0.12);
  const rightX = Math.round(imgW * 0.88 - box);
  return [
    { id: 'left', x: leftX, y, w: box, h: box },
    { id: 'right', x: rightX, y, w: box, h: box }
  ];
}

/**
 * Visão: detecta bounding boxes dos logos/crests a trocar.
 */
async function detectReplaceSlots(templateBase64, mime, userAsk) {
  if (!process.env.GEMINI_API_KEY) return null;
  const model = process.env.JARVIS_VISION_MODEL || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
  const clean = String(templateBase64 || '')
    .replace(/^data:[^;]+;base64,/, '')
    .replace(/\s+/g, '');
  const prompt = `You locate logo/crest/badge regions in a template graphic that should be replaced.
User request: ${String(userAsk || '').slice(0, 300)}

Return ONLY JSON:
{"width":<px>,"height":<px>,"slots":[{"id":"left","x":<px>,"y":<px>,"w":<px>,"h":<px>},{"id":"right","x":<px>,"y":<px>,"w":<px>,"h":<px>}]}

Rules:
- Pixel coords from top-left of the full image.
- Exactly 2 slots when there are two crests/logos (left then right).
- Boxes tightly around each crest INCLUDING any white outline/stroke.
- Do not include the center text (e.g. ODD) in a box.`;

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
                  mimeType: mime || 'image/jpeg',
                  data: clean
                }
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 500,
          responseMimeType: 'application/json'
        }
      },
      { timeout: 45000 }
    );
    const text = (resp.data?.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text || '')
      .join('')
      .trim();
    if (!text) return null;
    let json = text;
    const fence = json.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) json = fence[1].trim();
    const start = json.indexOf('{');
    const end = json.lastIndexOf('}');
    if (start >= 0 && end > start) json = json.slice(start, end + 1);
    const obj = JSON.parse(json);
    const width = Number(obj.width) || null;
    const height = Number(obj.height) || null;
    const slots = Array.isArray(obj.slots) ? obj.slots : [];
    console.log(
      JSON.stringify({
        tag: 'jarvis.compose',
        event: 'slots_detected',
        count: slots.length,
        width,
        height
      })
    );
    return { width, height, slots, source: 'vision' };
  } catch (err) {
    console.log(
      JSON.stringify({
        tag: 'jarvis.compose',
        event: 'slots_fail',
        error: String(err.message || err).slice(0, 160)
      })
    );
    return null;
  }
}

/**
 * Redimensiona asset pra caber no slot (contain), centralizado.
 * Contorno: cópias brancas offset (genérico, sem dilate nativo).
 */
async function prepareAssetForSlot(sharp, assetBuf, slotW, slotH, { stroke = 3 } = {}) {
  const strokePx = Math.max(0, Math.min(8, Number(stroke) || 0));
  const innerW = Math.max(8, slotW - strokePx * 2);
  const innerH = Math.max(8, slotH - strokePx * 2);

  const fitted = await sharp(assetBuf)
    .ensureAlpha()
    .resize(innerW, innerH, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toBuffer();

  let layer = fitted;
  if (strokePx > 0) {
    const meta = await sharp(fitted).metadata();
    const fw = meta.width || innerW;
    const fh = meta.height || innerH;
    const tw = fw + strokePx * 2;
    const th = fh + strokePx * 2;

    // RGB branco preservando alpha → silhueta
    const { data, info } = await sharp(fitted)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const white = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      white[i] = 255;
      white[i + 1] = 255;
      white[i + 2] = 255;
      white[i + 3] = a;
    }
    const whiteLogo = await sharp(white, {
      raw: { width: info.width, height: info.height, channels: 4 }
    })
      .png()
      .toBuffer();

    const offsets = [];
    for (let dx = -strokePx; dx <= strokePx; dx++) {
      for (let dy = -strokePx; dy <= strokePx; dy++) {
        if (dx === 0 && dy === 0) continue;
        if (dx * dx + dy * dy > strokePx * strokePx + 1) continue;
        offsets.push({ input: whiteLogo, left: strokePx + dx, top: strokePx + dy });
      }
    }
    layer = await sharp({
      create: {
        width: tw,
        height: th,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    })
      .composite([...offsets, { input: fitted, left: strokePx, top: strokePx }])
      .png()
      .toBuffer();
  }

  // Fundo opaco branco: apaga o crest antigo do template sob o slot
  return sharp({
    create: {
      width: slotW,
      height: slotH,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    }
  })
    .composite([{ input: layer, gravity: 'centre' }])
    .png()
    .toBuffer();
}

/**
 * Cola assets nos slots do template.
 * @param {{ templateBase64: string, templateMime?: string, slots: Array, assets: Array<{slot, base64, mime?}> }} opts
 */
async function composeLayoutReplace(opts = {}) {
  const sharp = loadSharp();
  if (!sharp) {
    console.log(JSON.stringify({ tag: 'jarvis.compose', event: 'sharp_missing' }));
    return null;
  }

  const templateBuf = bufFromBase64(opts.templateBase64);
  if (!templateBuf.length) return null;

  const meta = await sharp(templateBuf).metadata();
  const imgW = meta.width || 0;
  const imgH = meta.height || 0;
  if (!imgW || !imgH) return null;

  let rawSlots = Array.isArray(opts.slots) ? opts.slots : [];
  let slots = rawSlots
    .map((s) => normalizeSlot(s, imgW, imgH))
    .filter(Boolean);

  if (slots.length < 2) {
    slots = heuristicPairSlots(imgW, imgH).map((s) => normalizeSlot(s, imgW, imgH));
  }

  // Ordena left/right por x
  slots = slots.sort((a, b) => a.x - b.x);
  if (slots.length >= 2) {
    slots[0].id = 'left';
    slots[1].id = 'right';
    slots = slots.slice(0, 2);
  }

  const assets = Array.isArray(opts.assets) ? opts.assets : [];
  const bySlot = {
    left: assets.find((a) => a.slot === 'left') || assets[0],
    right: assets.find((a) => a.slot === 'right') || assets[1]
  };

  const composites = [];
  for (const slot of slots) {
    const asset = bySlot[slot.id];
    if (!asset || !asset.base64) continue;
    const assetBuf = bufFromBase64(asset.base64);
    if (!assetBuf.length) continue;
    const prepared = await prepareAssetForSlot(sharp, assetBuf, slot.w, slot.h, {
      stroke: opts.stroke != null ? opts.stroke : 4
    });
    composites.push({ input: prepared, left: slot.x, top: slot.y });
  }

  if (!composites.length) return null;

  const out = await sharp(templateBuf).composite(composites).png().toBuffer();

  console.log(
    JSON.stringify({
      tag: 'jarvis.compose',
      event: 'compose_ok',
      slots: slots.map((s) => s.id),
      assets: assets.map((a) => a.name || a.slot),
      bytes: out.length,
      size: `${imgW}x${imgH}`
    })
  );

  return {
    base64: out.toString('base64'),
    mime: 'image/png',
    width: imgW,
    height: imgH,
    slots,
    method: 'sharp_paste'
  };
}

/**
 * Pipeline: detect slots → paste assets. Null se não der.
 */
async function tryComposeLayoutReplace({
  templateBase64,
  templateMime,
  userAsk,
  assets
}) {
  if (!assets || assets.length < 2) return null;
  if (!loadSharp()) return null;

  let detected = await detectReplaceSlots(templateBase64, templateMime, userAsk);
  const slots = detected?.slots || null;

  const composed = await composeLayoutReplace({
    templateBase64,
    templateMime,
    slots,
    assets,
    stroke: 4
  });
  if (!composed) return null;

  return {
    ...composed,
    slotSource: detected?.source || 'heuristic'
  };
}

module.exports = {
  loadSharp,
  normalizeSlot,
  heuristicPairSlots,
  detectReplaceSlots,
  prepareAssetForSlot,
  composeLayoutReplace,
  tryComposeLayoutReplace
};
