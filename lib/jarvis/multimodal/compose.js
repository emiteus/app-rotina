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
 * Heurística: dois slots esquerda/direita (cards de odds / banners).
 * Usada se visão e detecção por pixels falharem.
 */
function heuristicPairSlots(imgW, imgH) {
  // Crests em cards 16:9 costumam ser ~28–34% da altura, centrados ~55% Y
  const box = Math.round(Math.min(imgW, imgH) * 0.34);
  const y = Math.max(0, Math.round(imgH * 0.55 - box / 2));
  const leftX = Math.max(0, Math.round(imgW * 0.2 - box / 2));
  const rightX = Math.min(imgW - box, Math.round(imgW * 0.8 - box / 2));
  return [
    { id: 'left', x: leftX, y, w: box, h: box },
    { id: 'right', x: rightX, y, w: box, h: box }
  ];
}

function nearWhite(r, g, b, a) {
  if (a < 40) return true;
  return r > 232 && g > 232 && b > 232;
}

/**
 * Detecta 2 regiões de crest por pixels (fundo claro + logos escuros/coloridos).
 * Não depende de LLM — cobre o caso vision 404.
 */
async function detectSlotsByPixels(sharp, templateBuf, imgW, imgH) {
  const tw = 200;
  const th = Math.max(40, Math.round((imgH / imgW) * tw));
  const { data, info } = await sharp(templateBuf)
    .resize(tw, th, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const y0 = Math.floor(th * 0.32);
  const y1 = Math.floor(th * 0.92);

  function bboxInBand(x0, x1) {
    let minX = x1;
    let minY = y1;
    let maxX = x0;
    let maxY = y0;
    let count = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * info.width + x) * 4;
        if (nearWhite(data[i], data[i + 1], data[i + 2], data[i + 3])) continue;
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    const minPix = Math.max(40, Math.floor(((x1 - x0) * (y1 - y0)) * 0.02));
    if (count < minPix || maxX <= minX || maxY <= minY) return null;
    // padding ~8%
    const padX = Math.max(2, Math.round((maxX - minX) * 0.1));
    const padY = Math.max(2, Math.round((maxY - minY) * 0.1));
    const sx = Math.max(0, minX - padX);
    const sy = Math.max(y0, minY - padY);
    const ex = Math.min(tw - 1, maxX + padX);
    const ey = Math.min(th - 1, maxY + padY);
    const scaleX = imgW / tw;
    const scaleY = imgH / th;
    let w = Math.round((ex - sx + 1) * scaleX);
    let h = Math.round((ey - sy + 1) * scaleY);
    // Força box quase quadrado (crests)
    const side = Math.max(w, h);
    const cx = Math.round((sx + ex + 1) * 0.5 * scaleX);
    const cy = Math.round((sy + ey + 1) * 0.5 * scaleY);
    return {
      x: Math.max(0, Math.round(cx - side / 2)),
      y: Math.max(0, Math.round(cy - side / 2)),
      w: Math.min(side, imgW),
      h: Math.min(side, imgH)
    };
  }

  // Esquerda / direita, excluindo centro (texto ODD)
  const left = bboxInBand(Math.floor(tw * 0.02), Math.floor(tw * 0.38));
  const right = bboxInBand(Math.floor(tw * 0.62), Math.floor(tw * 0.98));
  if (!left || !right) return null;

  // Sanity: tamanhos parecidos e não micro
  const minSide = Math.min(imgW, imgH) * 0.12;
  if (left.w < minSide || right.w < minSide) return null;
  const ratio = left.w / right.w;
  if (ratio < 0.45 || ratio > 2.2) return null;

  console.log(
    JSON.stringify({
      tag: 'jarvis.compose',
      event: 'slots_pixels',
      left,
      right,
      size: `${imgW}x${imgH}`
    })
  );

  return {
    slots: [
      { id: 'left', ...left },
      { id: 'right', ...right }
    ],
    source: 'pixels'
  };
}

/**
 * Visão: detecta bounding boxes dos logos/crests a trocar.
 */
async function detectReplaceSlots(templateBase64, mime, userAsk) {
  if (!process.env.GEMINI_API_KEY) return null;
  const models = [
    process.env.JARVIS_VISION_MODEL,
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash'
  ].filter(Boolean);
  // unique preserve order
  const tried = [];
  for (const m of models) {
    if (!tried.includes(m)) tried.push(m);
  }

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
- Do not include the center text (e.g. ODD) in a box.
- Boxes should be roughly square and cover the FULL crest (not a corner patch).`;

  for (const model of tried) {
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
        { timeout: 45000, validateStatus: (s) => s < 500 }
      );
      if (resp.status === 404) {
        console.log(
          JSON.stringify({
            tag: 'jarvis.compose',
            event: 'slots_model_404',
            model
          })
        );
        continue;
      }
      if (resp.status >= 400) {
        console.log(
          JSON.stringify({
            tag: 'jarvis.compose',
            event: 'slots_model_fail',
            model,
            status: resp.status
          })
        );
        continue;
      }
      const text = (resp.data?.candidates?.[0]?.content?.parts || [])
        .map((p) => p.text || '')
        .join('')
        .trim();
      if (!text) continue;
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
      if (slots.length < 2) continue;
      console.log(
        JSON.stringify({
          tag: 'jarvis.compose',
          event: 'slots_detected',
          model,
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
          model,
          error: String(err.message || err).slice(0, 160)
        })
      );
    }
  }
  return null;
}

/**
 * Redimensiona asset pra caber no slot (contain), centralizado.
 * Contorno: cópias brancas offset (genérico, sem dilate nativo).
 */
async function prepareAssetForSlot(sharp, assetBuf, slotW, slotH, { stroke = 3 } = {}) {
  const strokePx = Math.max(0, Math.min(8, Number(stroke) || 0));
  const innerW = Math.max(8, slotW - strokePx * 2);
  const innerH = Math.max(8, slotH - strokePx * 2);

  // Trim margens (JPG com logo no meio do branco)
  let trimmed = assetBuf;
  try {
    trimmed = await sharp(assetBuf).ensureAlpha().trim({ threshold: 28 }).png().toBuffer();
  } catch (_) {
    trimmed = await sharp(assetBuf).ensureAlpha().png().toBuffer();
  }

  const fitted = await sharp(trimmed)
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
  let slotSource = opts.slotSource || (slots.length >= 2 ? 'provided' : null);

  if (slots.length < 2) {
    const pix = await detectSlotsByPixels(sharp, templateBuf, imgW, imgH);
    if (pix?.slots?.length >= 2) {
      slots = pix.slots.map((s) => normalizeSlot(s, imgW, imgH)).filter(Boolean);
      slotSource = 'pixels';
    }
  }

  if (slots.length < 2) {
    slots = heuristicPairSlots(imgW, imgH).map((s) => normalizeSlot(s, imgW, imgH));
    slotSource = 'heuristic';
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
    method: 'sharp_paste',
    slotSource: slotSource || 'unknown'
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
  let slots = detected?.slots || null;
  let slotSource = detected?.source || null;

  const composed = await composeLayoutReplace({
    templateBase64,
    templateMime,
    slots,
    assets,
    stroke: 4,
    slotSource
  });
  if (!composed) return null;

  return {
    ...composed,
    slotSource: composed.slotSource || slotSource || 'heuristic'
  };
}

module.exports = {
  loadSharp,
  normalizeSlot,
  heuristicPairSlots,
  detectSlotsByPixels,
  detectReplaceSlots,
  prepareAssetForSlot,
  composeLayoutReplace,
  tryComposeLayoutReplace
};
