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
  // Crests ~22–28% da menor dimensão, flanqueando o texto central
  const box = Math.round(Math.min(imgW, imgH) * 0.28);
  const y = Math.max(0, Math.round(imgH * 0.58 - box / 2));
  const leftX = Math.max(0, Math.round(imgW * 0.18 - box / 2));
  const rightX = Math.min(imgW - box, Math.round(imgW * 0.82 - box / 2));
  return [
    { id: 'left', x: leftX, y, w: box, h: box },
    { id: 'right', x: rightX, y, w: box, h: box }
  ];
}

function nearWhite(r, g, b, a) {
  if (a < 40) return true;
  return r > 232 && g > 232 && b > 232;
}

/** Caps + não invade o centro (texto ODD). */
function validatePairSlots(left, right, imgW, imgH) {
  if (!left || !right) return null;
  const maxSide = Math.round(Math.min(imgW, imgH) * 0.38);
  const minSide = Math.round(Math.min(imgW, imgH) * 0.1);
  const mid = imgW / 2;
  const gap = Math.round(imgW * 0.1);

  function clampSlot(s, side) {
    let { x, y, w, h } = s;
    w = Math.min(w, maxSide);
    h = Math.min(h, maxSide);
    const sideLen = Math.max(w, h);
    if (sideLen < minSide) return null;
    // re-centra no centro original do slot, com side limitado
    const cx = s.x + s.w / 2;
    const cy = s.y + s.h / 2;
    w = sideLen;
    h = sideLen;
    x = Math.round(cx - w / 2);
    y = Math.round(cy - h / 2);
    if (side === 'left') {
      // não cruza o meio
      if (x + w > mid - gap) x = Math.round(mid - gap - w);
    } else {
      if (x < mid + gap) x = Math.round(mid + gap);
    }
    x = Math.max(0, Math.min(x, imgW - w));
    y = Math.max(0, Math.min(y, imgH - h));
    if (w < minSide || h < minSide) return null;
    return { id: side, x, y, w, h };
  }

  const L = clampSlot(left, 'left');
  const R = clampSlot(right, 'right');
  if (!L || !R) return null;
  if (L.x + L.w >= R.x - gap) return null;
  const ratio = L.w / R.w;
  if (ratio < 0.5 || ratio > 2) return null;
  return [L, R];
}

/**
 * Detecta 2 crests por densidade de coluna (ignora título largo e texto central).
 */
async function detectSlotsByPixels(sharp, templateBuf, imgW, imgH) {
  const tw = 240;
  const th = Math.max(48, Math.round((imgH / imgW) * tw));
  const { data, info } = await sharp(templateBuf)
    .resize(tw, th, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Faixa dos crests: abaixo do título, atravessando o ODD
  const y0 = Math.floor(th * 0.42);
  const y1 = Math.floor(th * 0.9);
  const col = new Array(tw).fill(0);
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < tw; x++) {
      const i = (y * info.width + x) * 4;
      if (nearWhite(data[i], data[i + 1], data[i + 2], data[i + 3])) continue;
      col[x]++;
    }
  }

  const mid = Math.floor(tw / 2);
  // ignora zona central (~ODD)
  const excludeL = Math.floor(tw * 0.36);
  const excludeR = Math.floor(tw * 0.64);

  function peakIn(x0, x1) {
    let bestX = x0;
    let best = -1;
    for (let x = x0; x < x1; x++) {
      if (col[x] > best) {
        best = col[x];
        bestX = x;
      }
    }
    if (best < Math.max(3, (y1 - y0) * 0.08)) return null;
    return bestX;
  }

  const peakL = peakIn(Math.floor(tw * 0.04), excludeL);
  const peakR = peakIn(excludeR, Math.floor(tw * 0.96));
  if (peakL == null || peakR == null) return null;

  // Cresce bbox a partir do pico, limitado (~15% da largura do thumb)
  const maxRad = Math.floor(tw * 0.14);

  function bboxFromPeak(peakX) {
    let minX = peakX;
    let maxX = peakX;
    let minY = y1;
    let maxY = y0;
    const thresh = Math.max(2, col[peakX] * 0.25);
    for (let dx = 0; dx <= maxRad; dx++) {
      const xl = peakX - dx;
      const xr = peakX + dx;
      if (xl >= 0 && col[xl] >= thresh) minX = xl;
      if (xr < tw && col[xr] >= thresh) maxX = xr;
    }
    for (let y = y0; y < y1; y++) {
      for (let x = minX; x <= maxX; x++) {
        const i = (y * info.width + x) * 4;
        if (nearWhite(data[i], data[i + 1], data[i + 2], data[i + 3])) continue;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX <= minX || maxY <= minY) return null;
    const pad = Math.max(2, Math.round((maxX - minX) * 0.12));
    const sx = Math.max(0, minX - pad);
    const ex = Math.min(tw - 1, maxX + pad);
    const sy = Math.max(y0, minY - pad);
    const ey = Math.min(th - 1, maxY + pad);
    const scaleX = imgW / tw;
    const scaleY = imgH / th;
    const w = Math.round((ex - sx + 1) * scaleX);
    const h = Math.round((ey - sy + 1) * scaleY);
    const side = Math.max(w, h);
    const cx = ((sx + ex) / 2) * scaleX;
    const cy = ((sy + ey) / 2) * scaleY;
    return {
      x: Math.round(cx - side / 2),
      y: Math.round(cy - side / 2),
      w: side,
      h: side
    };
  }

  const rawL = bboxFromPeak(peakL);
  const rawR = bboxFromPeak(peakR);
  const pair = validatePairSlots(rawL, rawR, imgW, imgH);
  if (!pair) {
    console.log(
      JSON.stringify({
        tag: 'jarvis.compose',
        event: 'slots_pixels_reject',
        rawL,
        rawR,
        size: `${imgW}x${imgH}`
      })
    );
    return null;
  }

  console.log(
    JSON.stringify({
      tag: 'jarvis.compose',
      event: 'slots_pixels',
      left: pair[0],
      right: pair[1],
      size: `${imgW}x${imgH}`
    })
  );

  return { slots: pair, source: 'pixels' };
}

/**
 * Visão: detecta bounding boxes dos logos/crests a trocar.
 */
async function detectReplaceSlots(templateBase64, mime, userAsk) {
  if (!process.env.GEMINI_API_KEY) return null;
  const models = [
    process.env.JARVIS_VISION_MODEL,
    'gemini-3.5-flash',
    'gemini-flash-latest',
    'gemini-2.5-flash',
    'gemini-flash-lite-latest',
    'gemini-2.0-flash'
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
async function prepareAssetForSlot(
  sharp,
  assetBuf,
  slotW,
  slotH,
  { stroke = 3, underlay = 'white' } = {}
) {
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

    const tw = info.width + strokePx * 2;
    const th = info.height + strokePx * 2;
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

  const bg =
    underlay === 'transparent'
      ? { r: 0, g: 0, b: 0, alpha: 0 }
      : { r: 255, g: 255, b: 255, alpha: 1 };

  return sharp({
    create: {
      width: slotW,
      height: slotH,
      channels: 4,
      background: bg
    }
  })
    .composite([{ input: layer, gravity: 'centre' }])
    .png()
    .toBuffer();
}

/**
 * Ajusta slot ao crest real no template (bbox de pixels não-brancos na vizinhança).
 * Evita colar deslocado e deixar pontas do crest antigo sobrando.
 */
async function snapSlotToContent(sharp, templateBuf, slot, imgW, imgH) {
  if (!slot) return null;
  const marginX = Math.round(slot.w * 0.55);
  const marginY = Math.round(slot.h * 0.55);
  let rx0 = Math.max(0, slot.x - marginX);
  let ry0 = Math.max(0, slot.y - marginY);
  let rx1 = Math.min(imgW, slot.x + slot.w + marginX);
  let ry1 = Math.min(imgH, slot.y + slot.h + marginY);
  // Não engolir texto central (ODD)
  const mid = imgW / 2;
  const gap = Math.round(imgW * 0.12);
  const isLeft = slot.id === 'left' || slot.x + slot.w / 2 < mid;
  if (isLeft) rx1 = Math.min(rx1, mid - gap);
  else rx0 = Math.max(rx0, mid + gap);
  const rw = rx1 - rx0;
  const rh = ry1 - ry0;
  if (rw < 8 || rh < 8) return slot;

  const { data, info } = await sharp(templateBuf)
    .extract({ left: rx0, top: ry0, width: rw, height: rh })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let minX = rw;
  let minY = rh;
  let maxX = 0;
  let maxY = 0;
  let count = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4;
      if (nearWhite(data[i], data[i + 1], data[i + 2], data[i + 3])) continue;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const minPix = Math.max(30, Math.floor(rw * rh * 0.01));
  if (count < minPix || maxX <= minX || maxY <= minY) return slot;

  // Pad generoso: precisa cobrir stroke/brilho do crest antigo
  const pad = Math.max(6, Math.round(Math.max(maxX - minX, maxY - minY) * 0.14));
  const absMinX = rx0 + minX - pad;
  const absMaxX = rx0 + maxX + pad;
  const absMinY = ry0 + minY - pad;
  const absMaxY = ry0 + maxY + pad;
  const w = absMaxX - absMinX + 1;
  const h = absMaxY - absMinY + 1;
  const side = Math.max(w, h);
  const cx = (absMinX + absMaxX) / 2;
  const cy = (absMinY + absMaxY) / 2;
  let x = Math.round(cx - side / 2);
  let y = Math.round(cy - side / 2);
  x = Math.max(0, Math.min(x, imgW - side));
  y = Math.max(0, Math.min(y, imgH - side));
  const maxSide = Math.round(Math.min(imgW, imgH) * 0.42);
  const finalSide = Math.min(side, maxSide);
  if (finalSide < side) {
    x = Math.round(cx - finalSide / 2);
    y = Math.round(cy - finalSide / 2);
    x = Math.max(0, Math.min(x, imgW - finalSide));
    y = Math.max(0, Math.min(y, imgH - finalSide));
  }
  return {
    id: slot.id,
    x,
    y,
    w: finalSide,
    h: finalSide
  };
}

async function snapPairToContent(sharp, templateBuf, slots, imgW, imgH) {
  if (!slots || slots.length < 2) return slots;
  const snapped = [];
  for (const s of slots.slice(0, 2)) {
    snapped.push(await snapSlotToContent(sharp, templateBuf, s, imgW, imgH));
  }
  const validated = validatePairSlots(snapped[0], snapped[1], imgW, imgH);
  return validated || snapped;
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
    .filter(Boolean)
    .sort((a, b) => a.x - b.x);
  let slotSource = opts.slotSource || (slots.length >= 2 ? 'provided' : null);

  // Pixels primeiro (visão costuma errar o centro do crest)
  {
    const pix = await detectSlotsByPixels(sharp, templateBuf, imgW, imgH);
    if (pix?.slots?.length >= 2) {
      slots = pix.slots.map((s) => normalizeSlot(s, imgW, imgH)).filter(Boolean);
      slotSource = 'pixels';
    }
  }

  if (slots.length >= 2) {
    const validated = validatePairSlots(slots[0], slots[1], imgW, imgH);
    if (validated) slots = validated;
    else {
      slots = [];
      slotSource = null;
    }
  }

  // Vision / provided só se pixels falhou
  if (slots.length < 2 && rawSlots.length >= 2) {
    const sorted = rawSlots
      .map((s) => normalizeSlot(s, imgW, imgH))
      .filter(Boolean)
      .sort((a, b) => a.x - b.x);
    const validated = validatePairSlots(sorted[0], sorted[1], imgW, imgH);
    if (validated) {
      slots = validated;
      slotSource = opts.slotSource || 'vision';
    }
  }

  if (slots.length < 2) {
    slots = heuristicPairSlots(imgW, imgH).map((s) => normalizeSlot(s, imgW, imgH));
    slotSource = 'heuristic';
  }

  slots = slots.sort((a, b) => a.x - b.x);
  if (slots.length >= 2) {
    slots[0].id = 'left';
    slots[1].id = 'right';
    slots = slots.slice(0, 2);
  }

  // Snap ao crest real + pad — apaga o antigo por completo
  slots = await snapPairToContent(sharp, templateBuf, slots, imgW, imgH);
  slots = slots.sort((a, b) => a.x - b.x);
  if (slots.length >= 2) {
    slots[0].id = 'left';
    slots[1].id = 'right';
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

    // 1) Apaga crest antigo (retângulo branco do tamanho do snap)
    const erase = await sharp({
      create: {
        width: slot.w,
        height: slot.h,
        channels: 3,
        background: { r: 255, g: 255, b: 255 }
      }
    })
      .png()
      .toBuffer();
    composites.push({ input: erase, left: slot.x, top: slot.y });

    // 2) Cola crest novo (com transparência; underlay já foi o erase)
    const prepared = await prepareAssetForSlot(sharp, assetBuf, slot.w, slot.h, {
      stroke: opts.stroke != null ? opts.stroke : 3,
      underlay: 'transparent'
    });
    composites.push({ input: prepared, left: slot.x, top: slot.y });
  }

  if (!composites.length) return null;

  const out = await sharp(templateBuf).composite(composites).png().toBuffer();

  console.log(
    JSON.stringify({
      tag: 'jarvis.compose',
      event: 'compose_ok',
      slots: slots.map((s) => ({ id: s.id, x: s.x, y: s.y, w: s.w, h: s.h })),
      assets: assets.map((a) => a.name || a.slot),
      slotSource,
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
  validatePairSlots,
  detectSlotsByPixels,
  detectReplaceSlots,
  snapSlotToContent,
  snapPairToContent,
  prepareAssetForSlot,
  composeLayoutReplace,
  tryComposeLayoutReplace
};
