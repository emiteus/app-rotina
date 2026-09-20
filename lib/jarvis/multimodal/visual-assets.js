/**
 * Visual asset resolver (genérico) — busca arquivos em Wikimedia Commons.
 * Sem catálogo de domínio (times, marcas, etc.): o nome vem do pedido do user.
 */
const axios = require('axios');

const UA = 'JarvisOS/0.9 (personal assistant; commons asset resolve)';
const API = 'https://commons.wikimedia.org/w/api.php';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function normText(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extrai par "A e B" / "A x B" do pedido (genérico — não é só futebol).
 * Ex.: "com o logo da Nike e Adidas", "escudos do palmeiras e flamengo"
 */
function parseReplacePair(mensagem) {
  const msg = String(mensagem || '');
  let m =
    msg.match(
      /\b(?:escudos?|bras[oõ]es?|logos?|icones?|ícones?|imagens?)\s+(?:d[oa]s?\s+)?(.+?)\s+e\s+(.+?)(?:\.|$|,|\n)/i
    ) ||
    msg.match(
      /\bcom\s+(?:o\s+|os\s+|a\s+|as\s+)?(?:escudo|escudos|bras[aã]o|bras[oõ]es|logo|logos|icone|ícone)\s+(?:d[oa]s?\s+)?(.+?)\s+e\s+(.+?)(?:\.|$|,|\n)/i
    ) ||
    msg.match(
      /\bs[oó]\s+que\s+com\s+(?:o\s+|os\s+|a\s+|as\s+)?(?:escudos?\s+(?:d[oa]s?\s+)?|logos?\s+(?:d[oa]s?\s+)?)?(.+?)\s+e\s+(.+?)(?:\.|$|,|\n)/i
    ) ||
    msg.match(
      /\b([a-zà-úA-ZÀ-Ú][\wà-úÀ-Ú\s.-]{2,40})\s+(?:x|vs\.?|versus)\s+([a-zà-úA-ZÀ-Ú][\wà-úÀ-Ú\s.-]{2,40})\b/i
    );

  if (!m) return null;

  const clean = (raw) =>
    String(raw || '')
      .replace(/^(?:o|os|a|as|do|da|dos|das)\s+/i, '')
      .replace(/\s+(?:escudo|bras[aã]o|logo|icone|ícone).*$/i, '')
      .replace(/[!.?]+$/, '')
      .trim();

  const left = clean(m[1]);
  const right = clean(m[2]);
  if (left.length < 2 || right.length < 2) return null;
  return { left, right, raw: [left, right] };
}

function scoreCommonsTitle(title, query) {
  const t = normText(title.replace(/^file:/i, ''));
  const q = normText(query);
  const tokens = q.split(' ').filter((x) => x.length > 2);
  if (!tokens.length) return -100;

  // Obrigatório: pelo menos 1 token do nome pedido no título
  const matched = tokens.filter((tok) => t.includes(tok));
  if (!matched.length) return -100;

  let score = matched.length * 20;
  if (t.includes(q)) score += 40;
  if (/\b(logo|crest|badge|escudo|brasao|coat of arms|emblem)\b/.test(t)) score += 25;
  if (/\b(flag|kit|jersey|shirt|uniform|heart|dorgas|map|stadium|papacy|pope|vatican)\b/.test(t)) {
    score -= 50;
  }
  if (/\.png$/i.test(title)) score += 8;
  if (/\.svg$/i.test(title)) score += 6;
  if (/\.jpe?g$/i.test(title)) score += 2;
  return score;
}

/**
 * Busca candidatos ranqueados no Commons.
 * @returns {Promise<Array<{ title: string, name: string, file: string, score: number }>>}
 */
async function searchCommonsCandidates(query, { limit = 10, maxCandidates = 6 } = {}) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];

  const attempts = [`${q} logo`, `${q} crest`, `${q} escudo`, `${q} badge`, q];
  const hits = [];

  try {
    for (const srsearch of attempts) {
      const res = await axios.get(API, {
        timeout: 20000,
        headers: { 'User-Agent': UA },
        params: {
          action: 'query',
          list: 'search',
          srsearch,
          srnamespace: 6,
          srlimit: limit,
          format: 'json',
          origin: '*'
        }
      });
      for (const h of res.data?.query?.search || []) {
        if (!hits.some((x) => x.title === h.title)) hits.push(h);
      }
      const strongCount = hits.filter((h) => scoreCommonsTitle(h.title, q) >= 50).length;
      if (strongCount >= 2) break;
    }

    const ranked = hits
      .map((h) => {
        const title = String(h.title || '');
        return {
          title,
          name: q,
          file: title.replace(/^File:/i, ''),
          score: scoreCommonsTitle(title, q)
        };
      })
      .filter((c) => c.score >= 20)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxCandidates);

    if (!ranked.length) {
      console.log(
        JSON.stringify({
          tag: 'jarvis.asset',
          event: 'search_miss',
          query: q,
          hits: hits.length
        })
      );
      return [];
    }

    console.log(
      JSON.stringify({
        tag: 'jarvis.asset',
        event: 'search_hit',
        query: q,
        file: ranked[0].file,
        score: Math.round(ranked[0].score),
        candidates: ranked.length
      })
    );
    return ranked;
  } catch (err) {
    console.log(
      JSON.stringify({
        tag: 'jarvis.asset',
        event: 'search_fail',
        query: q,
        error: String(err.message || err).slice(0, 160)
      })
    );
    return [];
  }
}

/** @deprecated prefer searchCommonsCandidates — mantém compat smoke/API */
async function searchCommonsAsset(query, opts) {
  const list = await searchCommonsCandidates(query, opts);
  return list[0] || null;
}

function statusOf(err) {
  return err?.response?.status || err?.status || 0;
}

/**
 * Resolve URL de thumb via imageinfo (mais estável que Special:FilePath).
 */
async function resolveThumbUrl(fileTitle, width = 640) {
  const title = String(fileTitle || '').startsWith('File:')
    ? fileTitle
    : `File:${fileTitle}`;
  const res = await axios.get(API, {
    timeout: 20000,
    headers: { 'User-Agent': UA },
    params: {
      action: 'query',
      titles: title,
      prop: 'imageinfo',
      iiprop: 'url|mime|size',
      iiurlwidth: width,
      format: 'json',
      origin: '*'
    }
  });
  const pages = res.data?.query?.pages || {};
  const page = Object.values(pages)[0];
  const info = page?.imageinfo?.[0];
  if (!info) return null;
  return {
    url: info.thumburl || info.url,
    mime: info.thumbmime || info.mime || 'image/png',
    width: info.thumbwidth || info.width,
    height: info.thumbheight || info.height
  };
}

async function downloadBytes(url, { retries = 3 } = {}) {
  let lastErr = null;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 25000,
        maxRedirects: 5,
        headers: { 'User-Agent': UA },
        validateStatus: (s) => s >= 200 && s < 400
      });
      return { buf: Buffer.from(res.data), contentType: String(res.headers['content-type'] || '') };
    } catch (err) {
      lastErr = err;
      const st = statusOf(err);
      if (st === 429 || st === 503 || st === 502) {
        const wait = 400 * Math.pow(2, i) + Math.floor(Math.random() * 200);
        console.log(
          JSON.stringify({
            tag: 'jarvis.asset',
            event: 'fetch_retry',
            status: st,
            attempt: i + 1,
            waitMs: wait
          })
        );
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

async function fetchCommonsFile(entry, { width = 640 } = {}) {
  if (!entry || !entry.file) return null;
  try {
    let url;
    let mimeHint = null;
    try {
      const thumb = await resolveThumbUrl(entry.file, width);
      if (thumb?.url) {
        url = thumb.url;
        mimeHint = thumb.mime;
      }
    } catch (_) {
      /* fallback Special:FilePath */
    }
    if (!url) {
      url = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(entry.file)}?width=${width}`;
    }

    const { buf, contentType } = await downloadBytes(url, { retries: 3 });
    if (buf.length < 200) return null;

    let mime = 'image/png';
    const ct = contentType || mimeHint || '';
    if (/svg/i.test(ct) || /\.svg$/i.test(entry.file)) {
      // SVG bruto não cola bem no sharp sem raster — pula, próximo candidato
      console.log(
        JSON.stringify({
          tag: 'jarvis.asset',
          event: 'svg_raw_skip',
          file: entry.file
        })
      );
      return null;
    }
    if (/jpeg|jpg/i.test(ct)) mime = 'image/jpeg';
    else if (/webp/i.test(ct)) mime = 'image/webp';
    else if (/png/i.test(ct)) mime = 'image/png';

    console.log(
      JSON.stringify({
        tag: 'jarvis.asset',
        event: 'fetch_ok',
        name: entry.name,
        file: entry.file,
        bytes: buf.length,
        mime
      })
    );
    return {
      base64: buf.toString('base64'),
      mime,
      name: entry.name,
      file: entry.file,
      source: 'wikimedia_commons'
    };
  } catch (err) {
    console.log(
      JSON.stringify({
        tag: 'jarvis.asset',
        event: 'fetch_fail',
        file: entry.file,
        status: statusOf(err) || undefined,
        error: String(err.message || err).slice(0, 160)
      })
    );
    return null;
  }
}

/**
 * Tenta candidatos em ordem até baixar um PNG/JPEG válido.
 */
async function fetchFirstWorking(candidates) {
  for (const c of candidates) {
    const asset = await fetchCommonsFile(c);
    if (asset) return asset;
  }
  return null;
}

/**
 * Resolve assets visuais nomeados no pedido (busca Commons — sem hardcode de domínio).
 * Fetch sequencial + candidatos + retry 429 — evita half-resolve.
 */
async function resolveVisualAssets(mensagem) {
  const pair = parseReplacePair(mensagem);
  if (!pair) return { pair: null, assets: [] };

  const [leftCands, rightCands] = await Promise.all([
    searchCommonsCandidates(pair.left),
    searchCommonsCandidates(pair.right)
  ]);

  if (!leftCands.length || !rightCands.length) {
    return {
      pair,
      assets: [],
      unresolved: true,
      missing: [
        !leftCands.length ? pair.left : null,
        !rightCands.length ? pair.right : null
      ].filter(Boolean)
    };
  }

  // Sequencial: paralelo dobrava 429 no Commons
  let leftAsset = await fetchFirstWorking(leftCands);
  await sleep(250);
  let rightAsset = await fetchFirstWorking(rightCands);

  // Uma nova passada curta se um lado falhou (rate limit)
  if (!leftAsset || !rightAsset) {
    await sleep(800);
    if (!leftAsset) leftAsset = await fetchFirstWorking(leftCands);
    if (!rightAsset) {
      await sleep(250);
      rightAsset = await fetchFirstWorking(rightCands);
    }
  }

  // Par incompleto → não devolve 1 asset (Gemini cola só um e deixa o outro do template)
  if (!leftAsset || !rightAsset) {
    return {
      pair,
      assets: [],
      unresolved: true,
      missing: [
        !leftAsset ? pair.left : null,
        !rightAsset ? pair.right : null
      ].filter(Boolean)
    };
  }

  return {
    pair,
    assets: [
      { ...leftAsset, slot: 'left' },
      { ...rightAsset, slot: 'right' }
    ],
    unresolved: false,
    missing: []
  };
}

module.exports = {
  parseReplacePair,
  searchCommonsAsset,
  searchCommonsCandidates,
  fetchCommonsFile,
  resolveVisualAssets,
  scoreCommonsTitle,
  normText
};
