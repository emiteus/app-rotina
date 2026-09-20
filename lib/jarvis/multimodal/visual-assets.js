/**
 * Visual asset resolver (genérico) — busca arquivos em Wikimedia Commons.
 * Sem catálogo de domínio (times, marcas, etc.): o nome vem do pedido do user.
 */
const axios = require('axios');

const UA = 'JarvisOS/0.9 (personal assistant; commons asset resolve)';

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
 * Busca arquivo de mídia no Commons pelo nome pedido.
 * @returns {Promise<{ title: string, name: string, file: string }|null>}
 */
async function searchCommonsAsset(query, { limit = 10 } = {}) {
  const q = String(query || '').trim();
  if (q.length < 2) return null;

  const url = 'https://commons.wikimedia.org/w/api.php';
  const attempts = [`${q} logo`, `${q} crest`, `${q} escudo`, `${q} badge`, q];
  const hits = [];

  try {
    for (const srsearch of attempts) {
      const res = await axios.get(url, {
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
      // já tem candidato forte? para cedo
      const strong = hits.find((h) => scoreCommonsTitle(h.title, q) >= 50);
      if (strong) break;
    }

    let best = null;
    let bestScore = -Infinity;
    for (const h of hits) {
      const title = String(h.title || '');
      const sc = scoreCommonsTitle(title, q);
      if (sc > bestScore) {
        bestScore = sc;
        best = title;
      }
    }
    if (!best || bestScore < 20) {
      console.log(
        JSON.stringify({
          tag: 'jarvis.asset',
          event: 'search_miss',
          query: q,
          bestScore,
          hits: hits.length
        })
      );
      return null;
    }

    const file = best.replace(/^File:/i, '');
    console.log(
      JSON.stringify({
        tag: 'jarvis.asset',
        event: 'search_hit',
        query: q,
        file,
        score: Math.round(bestScore)
      })
    );
    return { title: best, name: q, file };
  } catch (err) {
    console.log(
      JSON.stringify({
        tag: 'jarvis.asset',
        event: 'search_fail',
        query: q,
        error: String(err.message || err).slice(0, 160)
      })
    );
    return null;
  }
}

async function fetchCommonsFile(entry, { width = 640 } = {}) {
  if (!entry || !entry.file) return null;
  const url = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(entry.file)}?width=${width}`;
  try {
    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 25000,
      maxRedirects: 5,
      headers: { 'User-Agent': UA },
      validateStatus: (s) => s >= 200 && s < 400
    });
    const buf = Buffer.from(res.data);
    if (buf.length < 200) return null;
    let mime = 'image/png';
    const ct = String(res.headers['content-type'] || '');
    if (/svg/i.test(ct)) {
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
        error: String(err.message || err).slice(0, 160)
      })
    );
    return null;
  }
}

/**
 * Resolve assets visuais nomeados no pedido (busca Commons — sem hardcode de domínio).
 */
async function resolveVisualAssets(mensagem) {
  const pair = parseReplacePair(mensagem);
  if (!pair) return { pair: null, assets: [] };

  const entries = await Promise.all([
    searchCommonsAsset(pair.left),
    searchCommonsAsset(pair.right)
  ]);

  const unresolved = entries.some((e) => !e);
  if (unresolved) {
    return {
      pair,
      assets: [],
      unresolved: true,
      missing: entries.map((e, i) => (e ? null : pair.raw[i])).filter(Boolean)
    };
  }

  const [leftFile, rightFile] = entries;
  const [leftAsset, rightAsset] = await Promise.all([
    fetchCommonsFile(leftFile),
    fetchCommonsFile(rightFile)
  ]);

  const assets = [];
  if (leftAsset) assets.push({ ...leftAsset, slot: 'left' });
  if (rightAsset) assets.push({ ...rightAsset, slot: 'right' });

  return {
    pair,
    assets,
    unresolved: assets.length < 2,
    missing: assets.length < 2 ? pair.raw.filter((_, i) => !(i === 0 ? leftAsset : rightAsset)) : []
  };
}

module.exports = {
  parseReplacePair,
  searchCommonsAsset,
  fetchCommonsFile,
  resolveVisualAssets,
  scoreCommonsTitle,
  normText
};
