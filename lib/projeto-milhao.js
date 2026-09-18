/**
 * Projeto Milhão — fechamento diário (Mateus/Erik, meta 30).
 * Prefere HTTP (PROJETO_MILHAO_URL); fallback lê data/dia-*.json no disco.
 *
 * Env:
 *   PROJETO_MILHAO_URL (+ opcional PROJETO_MILHAO_OPS_KEY)
 *   PROJETO_MILHAO_DATA_DIR — pasta data/ (default R:/Projetos/Projeto Milhão/data)
 */
const fs = require('fs');
const path = require('path');

const META = 30;
const PESSOAS = [
  { id: 'mateus', nome: 'Mateus', paginas: ['filmelabs', 'ney.filmes', 'mister.cine'] },
  { id: 'erik', nome: 'Erik', paginas: ['isinhafilmes', 'maniadefilmesbr'] }
];

function baseUrl() {
  return String(process.env.PROJETO_MILHAO_URL || '').replace(/\/+$/, '');
}

function opsKey() {
  return String(process.env.PROJETO_MILHAO_OPS_KEY || '').trim();
}

function dataDir() {
  if (process.env.PROJETO_MILHAO_DATA_DIR) {
    return path.resolve(process.env.PROJETO_MILHAO_DATA_DIR);
  }
  const root = process.env.PROJETOS_ROOT || path.resolve(__dirname, '..', '..');
  const candidates = [
    path.join(root, 'Projeto Milhão', 'data'),
    path.join(root, 'Projeto Milhao', 'data')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

function projetoMilhaoReady() {
  if (baseUrl()) return true;
  try {
    return fs.existsSync(dataDir());
  } catch {
    return false;
  }
}

function ymdBR(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
}

function ontemBR(d = new Date()) {
  const [y, m, day] = ymdBR(d).split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, day));
  utc.setUTCDate(utc.getUTCDate() - 1);
  return utc.toISOString().slice(0, 10);
}

function formatarDataBR(ymd) {
  const [, m, d] = String(ymd).split('-');
  return `${d}/${m}`;
}

function somarViews(videos) {
  let views = 0;
  let comDado = 0;
  for (const v of videos || []) {
    const n = Number(v.viewCount);
    if (Number.isFinite(n) && n >= 0) {
      views += n;
      comDado += 1;
    }
  }
  return { views, comDado };
}

function lerDiaLocal(ymd) {
  const f = path.join(dataDir(), `dia-${ymd}.json`);
  if (!fs.existsSync(f)) return null;
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
}

function agregarLocal(ymd) {
  const state = lerDiaLocal(ymd);
  if (!state) {
    return {
      ymd,
      data_br: formatarDataBR(ymd),
      meta_por_pessoa: META,
      arquivo_existe: false,
      por_pessoa: [],
      ambos_na_meta: false,
      na_meta: 0,
      total_pessoas: PESSOAS.length,
      enviado_fechamento: null,
      texto: null
    };
  }
  const por_pessoa = PESSOAS.map((pessoa) => {
    let posts = 0;
    let views = 0;
    let comDado = 0;
    const detalhe = {};
    for (const handle of pessoa.paginas) {
      const videos = state.paginas?.[handle]?.shortcodes || [];
      const sv = somarViews(videos);
      posts += videos.length;
      views += sv.views;
      comDado += sv.comDado;
      detalhe[handle] = { posts: videos.length, views: sv.views, comDado: sv.comDado };
    }
    return {
      id: pessoa.id,
      nome: pessoa.nome,
      posts,
      views,
      views_ok: comDado > 0,
      meta: META,
      meta_ok: posts >= META,
      faltam: Math.max(0, META - posts),
      paginas: detalhe
    };
  });
  const ambos = por_pessoa.every((p) => p.meta_ok);
  const linhas = por_pessoa.map(
    (p) =>
      `${p.meta_ok ? '✅' : '⚠️'} *${p.nome}*  ${p.posts}/${META}` +
      (p.views_ok ? ` · ${p.views.toLocaleString('pt-BR')} views` : '')
  );
  return {
    ymd,
    data_br: formatarDataBR(ymd),
    meta_por_pessoa: META,
    arquivo_existe: true,
    ambos_na_meta: ambos,
    na_meta: por_pessoa.filter((p) => p.meta_ok).length,
    total_pessoas: por_pessoa.length,
    por_pessoa,
    enviado_fechamento: state.enviado?.['2'] || null,
    texto:
      `🎬 Projeto Milhão — Fechamento ${formatarDataBR(ymd)}\n` +
      `Meta: ${META}/pessoa\n` +
      linhas.join('\n') +
      (ambos
        ? '\n🔥 Dia fechado no verde.'
        : `\n📉 ${por_pessoa.filter((p) => !p.meta_ok).map((p) => p.nome).join(', ')} abaixo da meta.`)
  };
}

async function milhaoFetch(pathname) {
  const headers = { 'Content-Type': 'application/json' };
  const key = opsKey();
  if (key) headers.Authorization = `Bearer ${key}`;
  const res = await fetch(`${baseUrl()}${pathname}`, {
    headers,
    signal: AbortSignal.timeout(12000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.message || `Projeto Milhão HTTP ${res.status}`);
  }
  return data;
}

async function getProjetoMilhaoSnapshot(opts = {}) {
  if (!projetoMilhaoReady()) {
    return {
      conectado: false,
      motivo: 'PROJETO_MILHAO_URL ou pasta data/ ausente'
    };
  }
  const ymd = opts.ymd || ontemBR();
  try {
    if (baseUrl()) {
      const data = await milhaoFetch(`/fechamento?ymd=${encodeURIComponent(ymd)}`);
      return {
        conectado: true,
        projeto: 'Projeto Milhão',
        fonte: 'http',
        fechamento: data,
        nota: 'Meta 30 posts/dia por pessoa (Mateus/Erik). Fechamento oficial = turno 02h (dia anterior).'
      };
    }
    const fechamento = agregarLocal(ymd);
    return {
      conectado: true,
      projeto: 'Projeto Milhão',
      fonte: 'arquivo',
      data_dir: dataDir(),
      fechamento,
      nota: fechamento.arquivo_existe
        ? 'Lido de data/dia-*.json local.'
        : `Sem arquivo dia-${ymd}.json — serviço Docker pode estar em outra máquina.`
    };
  } catch (e) {
    return { conectado: false, erro: e.message };
  }
}

async function projetoMilhaoFechamento(ymd) {
  const snap = await getProjetoMilhaoSnapshot({ ymd: ymd || ontemBR() });
  if (!snap.conectado) return { ok: false, erro: snap.erro || snap.motivo };
  const f = snap.fechamento || {};
  return {
    ok: true,
    ymd: f.ymd,
    data_br: f.data_br,
    ambos_na_meta: f.ambos_na_meta,
    por_pessoa: f.por_pessoa,
    texto: f.texto,
    enviado_fechamento: f.enviado_fechamento,
    arquivo_existe: f.arquivo_existe,
    fonte: snap.fonte
  };
}

module.exports = {
  projetoMilhaoReady,
  getProjetoMilhaoSnapshot,
  projetoMilhaoFechamento,
  ontemBR,
  ymdBR
};
