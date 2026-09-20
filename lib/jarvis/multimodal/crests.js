/**
 * Escudos oficiais (Wikimedia) — evita alucinação do modelo de imagem.
 * Uso pessoal/ops; marcas pertencem aos clubes.
 */
const axios = require('axios');

/** @type {Record<string, { file: string, name: string }>} */
const CREST_BY_ALIAS = {
  palmeiras: { file: 'Palmeiras_logo.svg', name: 'Palmeiras' },
  verdão: { file: 'Palmeiras_logo.svg', name: 'Palmeiras' },
  verdao: { file: 'Palmeiras_logo.svg', name: 'Palmeiras' },
  sep: { file: 'Palmeiras_logo.svg', name: 'Palmeiras' },

  flamengo: { file: 'Flamengo-RJ_(BRA)_1.png', name: 'Flamengo' },
  mengão: { file: 'Flamengo-RJ_(BRA)_1.png', name: 'Flamengo' },
  mengao: { file: 'Flamengo-RJ_(BRA)_1.png', name: 'Flamengo' },
  crf: { file: 'Flamengo-RJ_(BRA)_1.png', name: 'Flamengo' },
  'clube de regatas do flamengo': { file: 'Flamengo-RJ_(BRA)_1.png', name: 'Flamengo' },

  corinthians: { file: 'Sport_Club_Corinthians_Paulista_logo.svg', name: 'Corinthians' },
  timão: { file: 'Sport_Club_Corinthians_Paulista_logo.svg', name: 'Corinthians' },
  timao: { file: 'Sport_Club_Corinthians_Paulista_logo.svg', name: 'Corinthians' },

  são_paulo: { file: 'São_Paulo_Futebol_Clube.svg', name: 'São Paulo' },
  sao_paulo: { file: 'São_Paulo_Futebol_Clube.svg', name: 'São Paulo' },
  spfc: { file: 'São_Paulo_Futebol_Clube.svg', name: 'São Paulo' },

  santos: { file: 'Santos_Logo.svg', name: 'Santos' },

  fluminense: { file: 'Fluminense_football_club_logo.png', name: 'Fluminense' },
  flu: { file: 'Fluminense_football_club_logo.png', name: 'Fluminense' },

  botafogo: { file: 'Botafogo_de_Futebol_e_Regatas_logo.svg', name: 'Botafogo' },
  fogão: { file: 'Botafogo_de_Futebol_e_Regatas_logo.svg', name: 'Botafogo' },
  fogao: { file: 'Botafogo_de_Futebol_e_Regatas_logo.svg', name: 'Botafogo' },

  grêmio: { file: 'Gremio_logo.svg', name: 'Grêmio' },
  gremio: { file: 'Gremio_logo.svg', name: 'Grêmio' },
  internacional: { file: 'Escudo_do_Sport_Club_Internacional.svg', name: 'Internacional' },
  inter: { file: 'Escudo_do_Sport_Club_Internacional.svg', name: 'Internacional' },
  atletico_mineiro: { file: 'Clube_Atlético_Mineiro_logo.svg', name: 'Atlético-MG' },
  atlético_mineiro: { file: 'Clube_Atlético_Mineiro_logo.svg', name: 'Atlético-MG' },
  galo: { file: 'Clube_Atlético_Mineiro_logo.svg', name: 'Atlético-MG' },
  cruzeiro: { file: 'Cruzeiro_Esporte_Clube_(logo).svg', name: 'Cruzeiro' },
  vasco: { file: 'Club_de_Regatas_Vasco_da_Gama.svg', name: 'Vasco' },

  'real madrid': { file: 'Real_Madrid_CF.svg', name: 'Real Madrid' },
  realmadrid: { file: 'Real_Madrid_CF.svg', name: 'Real Madrid' },
  madrid: { file: 'Real_Madrid_CF.svg', name: 'Real Madrid' },
  barcelona: { file: 'FC_Barcelona_(crest).svg', name: 'Barcelona' },
  barça: { file: 'FC_Barcelona_(crest).svg', name: 'Barcelona' },
  barca: { file: 'FC_Barcelona_(crest).svg', name: 'Barcelona' },
  sevilla: { file: 'Sevilla_FC_logo.svg', name: 'Sevilla' },
  liverpool: { file: 'Liverpool_FC.svg', name: 'Liverpool' },
  'manchester city': { file: 'Manchester_City_FC_badge.svg', name: 'Manchester City' },
  'manchester united': { file: 'Manchester_United_FC_crest.svg', name: 'Manchester United' },
  chelsea: { file: 'Chelsea_FC.svg', name: 'Chelsea' },
  arsenal: { file: 'Arsenal_FC.svg', name: 'Arsenal' },
  psg: { file: 'Paris_Saint-Germain_F.C..svg', name: 'PSG' },
  'bayern munich': { file: 'FC_Bayern_München_logo_(2017).svg', name: 'Bayern' },
  bayern: { file: 'FC_Bayern_München_logo_(2017).svg', name: 'Bayern' },
  juventus: { file: 'Juventus_Logo_2017.svg', name: 'Juventus' },
  milan: { file: 'AC_Milan.svg', name: 'Milan' },
  inter_milan: { file: 'Inter_Milan.svg', name: 'Inter Milan' }
};

function normKey(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function lookupCrest(rawName) {
  const k = normKey(rawName);
  if (!k) return null;
  if (CREST_BY_ALIAS[k]) return { ...CREST_BY_ALIAS[k], key: k };
  const compact = k.replace(/\s+/g, '_');
  if (CREST_BY_ALIAS[compact]) return { ...CREST_BY_ALIAS[compact], key: compact };
  // prefix match (ex.: "palmeiras futebol")
  for (const [alias, meta] of Object.entries(CREST_BY_ALIAS)) {
    if (k === alias || k.startsWith(alias + ' ') || k.includes(' ' + alias)) {
      return { ...meta, key: alias };
    }
  }
  return null;
}

/**
 * Extrai troca de escudos do pedido.
 * Ex.: "com os escudos do palmeiras e flamengo" → [palmeiras, flamengo]
 * @returns {{ left: object, right: object, raw: string[] }|null}
 */
function parseCrestSwapRequest(mensagem) {
  const msg = String(mensagem || '');
  let m =
    msg.match(
      /\b(?:escudos?|bras[oõ]es?|logos?)\s+(?:d[oa]s?\s+)?(.+?)\s+e\s+(.+?)(?:\.|$|,|\n)/i
    ) ||
    msg.match(
      /\bcom\s+(?:o\s+|os\s+)?(?:escudo|escudos|bras[aã]o|bras[oõ]es)\s+(?:d[oa]s?\s+)?(.+?)\s+e\s+(.+?)(?:\.|$|,|\n)/i
    ) ||
    msg.match(/\bs[oó]\s+que\s+com\s+(?:o\s+|os\s+)?(?:escudos?\s+(?:d[oa]s?\s+)?)?(.+?)\s+e\s+(.+?)(?:\.|$|,|\n)/i);

  if (!m) {
    // "palmeiras x flamengo" / "palmeiras vs flamengo"
    m = msg.match(/\b([a-zà-úA-ZÀ-Ú][\wà-úÀ-Ú\s.-]{2,30})\s+(?:x|vs\.?|versus)\s+([a-zà-úA-ZÀ-Ú][\wà-úÀ-Ú\s.-]{2,30})\b/i);
  }
  if (!m) return null;

  const rawLeft = String(m[1] || '')
    .replace(/^(?:o|os|a|as)\s+/i, '')
    .replace(/\s+(?:escudo|bras[aã]o).*$/i, '')
    .trim();
  const rawRight = String(m[2] || '')
    .replace(/^(?:o|os|a|as)\s+/i, '')
    .replace(/\s+(?:escudo|bras[aã]o).*$/i, '')
    .trim()
    .replace(/[!.?]+$/, '');

  const left = lookupCrest(rawLeft);
  const right = lookupCrest(rawRight);
  if (!left || !right) {
    return {
      left: left || null,
      right: right || null,
      raw: [rawLeft, rawRight],
      unresolved: true
    };
  }
  return { left, right, raw: [rawLeft, rawRight], unresolved: false };
}

async function fetchCrestPng(entry, { width = 640 } = {}) {
  if (!entry || !entry.file) return null;
  const url = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(entry.file)}?width=${width}`;
  try {
    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 25000,
      maxRedirects: 5,
      headers: {
        'User-Agent': 'JarvisOS/0.9 (personal assistant; crest paste; contact: local)'
      },
      validateStatus: (s) => s >= 200 && s < 400
    });
    const buf = Buffer.from(res.data);
    if (buf.length < 200) return null;
    let mime = 'image/png';
    const ct = String(res.headers['content-type'] || '');
    if (/svg/i.test(ct) || entry.file.toLowerCase().endsWith('.svg')) {
      // Special:FilePath?width= normalmente rasteriza SVG → PNG
      mime = /svg/i.test(ct) ? 'image/svg+xml' : 'image/png';
    } else if (/jpeg|jpg/i.test(ct)) mime = 'image/jpeg';
    else if (/webp/i.test(ct)) mime = 'image/webp';
    else if (/png/i.test(ct)) mime = 'image/png';

    // SVG cru não cola bem em vários modelos — rejeita
    if (mime === 'image/svg+xml') {
      console.log(
        JSON.stringify({
          tag: 'jarvis.crest',
          event: 'svg_raw_skip',
          file: entry.file
        })
      );
      return null;
    }

    console.log(
      JSON.stringify({
        tag: 'jarvis.crest',
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
      file: entry.file
    };
  } catch (err) {
    console.log(
      JSON.stringify({
        tag: 'jarvis.crest',
        event: 'fetch_fail',
        file: entry.file,
        error: String(err.message || err).slice(0, 160)
      })
    );
    return null;
  }
}

/**
 * Resolve e baixa até 2 escudos do pedido.
 */
async function resolveCrestAssets(mensagem) {
  const swap = parseCrestSwapRequest(mensagem);
  if (!swap || swap.unresolved) {
    return { swap, assets: [] };
  }
  const [leftAsset, rightAsset] = await Promise.all([
    fetchCrestPng(swap.left),
    fetchCrestPng(swap.right)
  ]);
  const assets = [];
  if (leftAsset) assets.push({ ...leftAsset, slot: 'left' });
  if (rightAsset) assets.push({ ...rightAsset, slot: 'right' });
  return { swap, assets };
}

module.exports = {
  CREST_BY_ALIAS,
  lookupCrest,
  parseCrestSwapRequest,
  fetchCrestPng,
  resolveCrestAssets,
  normKey
};
