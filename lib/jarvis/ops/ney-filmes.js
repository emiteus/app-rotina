/**
 * Ney Filmes (25/09/2026): o Mateus joga cortes numa pasta do PC, cada arquivo com o nome da obra.
 * O Jarvis acha a sinopse pelo nome e agenda no Instagram da categoria "Ney Filmes" do TeusHub.
 *
 *  - Legenda: "<sinopse>\n\n🎬 <Tipo>: <Nome>" (Tipo = Filme, Série, Novela, Anime, Dorama…)
 *  - Obra não encontrada → sinopse de um filme aleatório (sem sinopse o engajamento cai muito)
 *  - Até 15 por dia, horários variados entre 08:00 e 23:30 (Brasília), respeitando o que já está agendado
 *  - SÓ a categoria Ney Filmes (NEY_CATEGORIA muda o nome); o PC só lê, o servidor anota o que já subiu
 */
const { requireConnector, requireLib } = require('../host');
const { once } = require('../db-once');

const TZ = 'America/Sao_Paulo';
const MAX_POR_DIA = Number(process.env.NEY_MAX_POR_DIA) || 15;
const JANELA = { ini: 8 * 60, fim: 23 * 60 + 30 }; // minutos do dia (BRT)
const TIPOS = ['Filme', 'Série', 'Novela', 'Anime', 'Dorama', 'Documentário', 'Minissérie', 'Desenho'];

// Reserva quando a busca falha de vez (obras conhecidas; sinopse curta e sem spoiler)
const POOL = [
  ['Filme', 'Um Sonho de Liberdade', 'Condenado injustamente pela morte da esposa, o banqueiro Andy Dufresne é enviado a uma penitenciária brutal. Ao longo de décadas, ele constrói uma amizade improvável com Red e encontra formas silenciosas de manter a esperança viva.'],
  ['Filme', 'Interestelar', 'Com a Terra à beira do colapso, um ex-piloto da NASA lidera uma missão através de um buraco de minhoca em busca de um novo lar para a humanidade, deixando para trás os filhos e enfrentando os limites do tempo e do espaço.'],
  ['Filme', 'O Poderoso Chefão', 'Don Vito Corleone comanda uma das famílias mais poderosas da máfia de Nova York. Quando um atentado abala o clã, seu filho Michael, que queria distância dos negócios, é arrastado para o centro do poder.'],
  ['Filme', 'Clube da Luta', 'Um homem insone e insatisfeito com a vida conhece o carismático Tyler Durden. Juntos, eles criam um clube secreto de lutas que rapidamente se transforma em algo muito maior e mais perigoso.'],
  ['Filme', 'A Origem', 'Dom Cobb é um ladrão especialista em roubar segredos do subconsciente durante os sonhos. Em troca de voltar para casa, ele aceita um trabalho quase impossível: plantar uma ideia na mente de alguém.'],
  ['Filme', 'Cidade de Deus', 'Nas décadas de 60 a 80, Buscapé cresce na Cidade de Deus, no Rio de Janeiro, e acompanha com sua câmera a ascensão do crime na comunidade, enquanto sonha em escapar daquela realidade como fotógrafo.'],
  ['Filme', 'Gladiador', 'Traído pelo novo imperador, o general romano Máximo perde a família e é vendido como escravo. Transformado em gladiador, ele luta nas arenas com um único objetivo: vingança.'],
  ['Filme', 'Coringa', 'Arthur Fleck, um comediante fracassado que luta contra problemas mentais, é ignorado e maltratado pela sociedade de Gotham. Aos poucos, ele mergulha numa espiral de violência que o transforma no Coringa.'],
  ['Filme', 'O Resgate do Soldado Ryan', 'Após o desembarque na Normandia, um grupo de soldados recebe a missão de atravessar as linhas inimigas para encontrar e trazer de volta o único irmão sobrevivente de uma família que perdeu três filhos na guerra.'],
  ['Filme', 'Parasita', 'A família Kim, desempregada e vivendo num porão, começa a se infiltrar aos poucos na rotina da rica família Park. Mas o plano perfeito esconde segredos que ninguém poderia prever.']
];

const dbi = () => requireLib('db');
const ensureTable = once(async () => {
  await dbi().run(`
    CREATE TABLE IF NOT EXISTS jarvis_ney_postados (
      chave TEXT PRIMARY KEY,
      arquivo TEXT NOT NULL,
      titulo TEXT,
      post_id TEXT,
      agendado_para TIMESTAMP,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
});
const chaveDe = (v) => `${String(v.nome).toLowerCase()}|${v.bytes}`;

/** "O.Poderoso.Chefao_1080p (2).mp4" → "O Poderoso Chefao" */
function nomeDaObra(arquivo) {
  return String(arquivo || '')
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .replace(/[._]+/g, ' ')
    .replace(/\((\d{1,2})\)|\[[^\]]*\]/g, ' ')
    .replace(/\b(1080p|720p|480p|2160p|4k|hd|fhd|x264|x265|hevc|web-?dl|bluray|dublado|legendado|corte|cortes|parte\s*\d+|pt\s*\d+|final|v\d)\b/gi, ' ')
    .replace(/\s*-\s*\d+\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s\-–—]+$/, '')
    .trim();
}

function legenda({ sinopse, tipo, titulo }) {
  return `${String(sinopse).trim()}\n\n🎬 ${tipo}: ${String(titulo).trim()}`;
}

function extrairJson(txt) {
  const s = String(txt || '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(s.slice(a, b + 1));
  } catch (_) {
    return null;
  }
}

/** Gemini com busca no Google. Devolve o texto da resposta. */
async function geminiBusca(prompt, { fetchImpl = fetch, timeoutMs = 30000 } = {}) {
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  if (!key) throw new Error('GEMINI_API_KEY ausente');
  // 2.5-flash saiu do ar pra chaves novas (404, 25/09/2026); 3.5-flash dá 503 em pico → tenta na ordem
  const models = String(process.env.NEY_MODELS || 'gemini-flash-latest,gemini-3.5-flash,gemini-3.8-flash')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  let ultimo = null;
  for (const model of models) {
    try {
      const r = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0.2 }
        }),
        signal: AbortSignal.timeout(timeoutMs)
      });
      const d = await r.json().catch(() => ({}));
      if (r.status === 401 || r.status === 402 || r.status === 403) {
        // Sem crédito / chave recusada: a mesma chave vale pra todos os modelos, não adianta insistir
        const e = new Error(`Gemini sem crédito (HTTP ${r.status})`);
        e.semCredito = true;
        throw e;
      }
      if (!r.ok) throw new Error(`Gemini ${model} HTTP ${r.status}`);
      const txt = (d.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
      if (txt) return txt;
      ultimo = new Error(`Gemini ${model} sem texto`);
    } catch (e) {
      if (e.semCredito) throw e;
      ultimo = e;
    }
  }
  throw ultimo || new Error('Gemini sem resposta');
}

function promptObra(nome) {
  return (
    `Nome de arquivo de um corte de vídeo: "${nome}". Descubra qual obra audiovisual é ` +
    `(filme, série, novela, anime, dorama, documentário, desenho…). Pesquise em AdoroCinema, TMDB e Wikipedia.\n` +
    `Responda SÓ um JSON: {"achou": true|false, "tipo": "${TIPOS.join('|')}", "titulo": "título oficial em português do Brasil", ` +
    `"ano": 2014, "sinopse": "sinopse em português do Brasil, 2 a 4 frases, envolvente, SEM contar o final"}. ` +
    `Se não tiver certeza de qual obra é, "achou": false.`
  );
}

function valida(o) {
  if (!o || o.achou !== true) return null;
  const sinopse = String(o.sinopse || '').trim();
  const titulo = String(o.titulo || '').trim();
  if (sinopse.length < 60 || !titulo) return null;
  const tipo = TIPOS.find((t) => t.toLowerCase() === String(o.tipo || '').toLowerCase()) || 'Filme';
  return { tipo, titulo: titulo.slice(0, 120), ano: Number(o.ano) || null, sinopse: sinopse.slice(0, 900) };
}

/** Sinopse da obra pelo nome do arquivo. Não achou → filme aleatório (sempre volta algo). */
async function sinopseDe(arquivo, deps = {}) {
  const nome = nomeDaObra(arquivo);
  const busca = deps.busca || geminiBusca;
  if (nome.length >= 2) {
    // O Google dá 503 ("alta demanda") em pico; roda em segundo plano, então insiste antes do aleatório
    const esperas = deps.esperas || [0, 3000, 8000];
    for (const ms of esperas) {
      if (ms) await new Promise((ok) => setTimeout(ok, ms));
      try {
        const resp = extrairJson(await busca(promptObra(nome)));
        const obra = valida(resp);
        if (obra) return { ...obra, achou: true, nome };
        if (resp && resp.achou === false) break; // respondeu que não sabe: não adianta repetir
      } catch (e) {
        // Sem crédito NÃO cai no aleatório: postaria sinopse errada em tudo (26/09/2026)
        if (e && e.semCredito) throw e;
      }
    }
  }
  const [tipo, titulo, sinopse] = POOL[Math.floor((deps.rand || Math.random)() * POOL.length)];
  return { tipo, titulo, sinopse, achou: false, nome };
}

/** Minutos do dia em Brasília e a data (YYYY-MM-DD) de um instante. */
function brt(ms) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ms))
    .reduce((o, x) => ((o[x.type] = x.value), o), {});
  return { dia: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) };
}

/** Próximo instante (ms) em que o relógio de Brasília marca `min` no dia seguinte ao de `ms`. */
function amanhaAs(ms, min) {
  const { min: agora } = brt(ms);
  return ms + ((24 * 60 - agora) + min) * 60000;
}

/**
 * Horários de postagem: até MAX_POR_DIA por dia, espaçados e variados dentro da janela 08:00–23:30.
 * @param {number} n  quantos vídeos
 * @param {{ agora?: number, ocupados?: number[], rand?: () => number }} opts  ocupados = já agendados (ms)
 */
function horarios(n, { agora = Date.now(), ocupados = [], rand = Math.random } = {}) {
  const gapBase = Math.floor((JANELA.fim - JANELA.ini) / MAX_POR_DIA); // ~62 min
  const porDia = new Map();
  for (const t of ocupados) porDia.set(brt(t).dia, (porDia.get(brt(t).dia) || 0) + 1);
  let t = Math.max(agora + 5 * 60000, ...ocupados.map((x) => x + gapBase * 0.6 * 60000));
  const out = [];
  for (let i = 0; i < n; i++) {
    if (i > 0 || ocupados.length) t += Math.round(gapBase * (0.7 + rand() * 0.9)) * 60000; // 43–99 min
    for (let guarda = 0; guarda < 30; guarda++) {
      const { dia, min } = brt(t);
      if (min < JANELA.ini) t += (JANELA.ini - min + Math.floor(rand() * 40)) * 60000;
      else if (min > JANELA.fim || (porDia.get(dia) || 0) >= MAX_POR_DIA) t = amanhaAs(t, JANELA.ini + Math.floor(rand() * 40));
      else break;
    }
    const d = brt(t).dia;
    porDia.set(d, (porDia.get(d) || 0) + 1);
    out.push(t);
  }
  return out;
}

/** Contas da categoria Ney Filmes (só Instagram). */
async function contasNey(sh) {
  const alvo = String(process.env.NEY_CATEGORIA || 'Ney Filmes').trim().toLowerCase();
  const { categories = [] } = await sh.listarCategorias();
  const cat = categories.find((c) => String(c.name).trim().toLowerCase() === alvo);
  if (!cat) throw new Error(`categoria "${alvo}" não existe no TeusHub`);
  const ig = (cat.accounts || []).filter((a) => a.platform === 'INSTAGRAM');
  if (!ig.length) throw new Error('a categoria Ney Filmes não tem Instagram conectado');
  return ig;
}

async function jaPostados(videos) {
  try {
    await ensureTable();
    const chaves = videos.map(chaveDe);
    const rows = await dbi().all(`SELECT chave FROM jarvis_ney_postados WHERE chave = ANY($1)`, [chaves]);
    return new Set(rows.map((r) => r.chave));
  } catch (_) {
    return new Set();
  }
}

async function marcarPostado(v, { titulo, postId, quando }) {
  try {
    await ensureTable();
    await dbi().run(
      `INSERT INTO jarvis_ney_postados (chave, arquivo, titulo, post_id, agendado_para) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (chave) DO NOTHING`,
      [chaveDe(v), v.nome, titulo, postId, new Date(quando).toISOString()]
    );
  } catch (_) {
    /* sem registro: no pior caso repete se mandar a mesma pasta */
  }
}

const quandoTxt = (ms) =>
  new Date(ms).toLocaleString('pt-BR', { timeZone: TZ, weekday: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });

/**
 * Passo 1 (rápido): lista a pasta no PC e separa o que é novo.
 * @returns {{ pasta, novos: Array, repetidos: number }}
 */
async function prepararPasta(userId, pasta, deps = {}) {
  const requestTool = deps.requestTool || require('../devices/gateway').requestTool;
  const r = await requestTool(userId, 'pc_media_list', { pasta }, { timeoutMs: 20000 });
  if (!r.ok) throw new Error(r.erro || 'não consegui ler a pasta no PC');
  const videos = (r.result && r.result.videos) || [];
  const ja = await (deps.jaPostados || jaPostados)(videos);
  const novos = videos.filter((v) => !ja.has(chaveDe(v)));
  return { pasta: (r.result && r.result.pasta) || pasta, novos, repetidos: videos.length - novos.length };
}

/**
 * Passo 2 (demorado, em segundo plano): sinopse → sobe → agenda, um por um.
 * @returns {Promise<{ agendados: Array, falhas: Array }>}
 */
async function postarVideos(userId, videos, deps = {}) {
  const sh = deps.sh || requireConnector('socialhub');
  const requestTool = deps.requestTool || require('../devices/gateway').requestTool;
  const contas = await contasNey(sh);
  const { posts = [] } = await sh.listarPosts('SCHEDULED', 30).catch(() => ({ posts: [] }));
  const ids = new Set(contas.map((c) => c.id));
  const ocupados = posts
    .filter((p) => (p.platforms || []).some((x) => ids.has(x.accountId)))
    .map((p) => Date.parse(p.scheduledAt))
    .filter(Number.isFinite);
  const quandos = horarios(videos.length, { agora: deps.agora || Date.now(), ocupados, rand: deps.rand });

  const agendados = [];
  const falhas = [];
  for (const [i, v] of videos.entries()) {
    try {
      const obra = await sinopseDe(v.nome, deps);
      const up = await sh.assinarUpload();
      const r = await requestTool(userId, 'pc_media_upload', { arquivo: v.arquivo, upload: { url: up.url, fields: up.fields } }, { timeoutMs: 11 * 60 * 1000 });
      if (!r.ok || !r.result || !r.result.url) throw new Error(r.erro || 'upload falhou');
      const out = await sh.agendarPost({
        caption: legenda(obra),
        socialAccountIds: contas.map((c) => c.id),
        scheduledAt: new Date(quandos[i]).toISOString(),
        mediaUrls: [r.result.url],
        mediaType: 'REEL'
      });
      await (deps.marcarPostado || marcarPostado)(v, { titulo: obra.titulo, postId: out.post && out.post.id, quando: quandos[i] });
      agendados.push({ arquivo: v.nome, tipo: obra.tipo, titulo: obra.titulo, achou: obra.achou, quando: quandoTxt(quandos[i]) });
    } catch (e) {
      if (e && e.semCredito) {
        for (const w of videos.slice(i)) falhas.push({ arquivo: w.nome, erro: 'a busca de sinopse (Gemini) está sem crédito; não postei' });
        break;
      }
      falhas.push({ arquivo: v.nome, erro: String(e.message || e).slice(0, 160) });
    }
  }
  return { agendados, falhas, conta: contas.map((c) => `@${c.username}`).join(', ') };
}

/** Resumo pro aviso de fim (voz + texto). */
function resumo({ agendados, falhas, conta }) {
  const aleatorios = agendados.filter((a) => !a.achou).length;
  const linhas = agendados.slice(0, 15).map((a) => `• ${a.quando} — ${a.tipo}: ${a.titulo}${a.achou ? '' : ' (sinopse aleatória)'}`);
  const text =
    `Ney Filmes: agendei **${agendados.length}** vídeo(s) no ${conta}` +
    (aleatorios ? ` (${aleatorios} com sinopse aleatória, não achei a obra)` : '') +
    (falhas.length ? `. ${falhas.length} falharam: ${falhas.map((f) => `${f.arquivo} (${f.erro})`).join('; ')}` : '') +
    (linhas.length ? `\n${linhas.join('\n')}` : '');
  const speech = `Senhor, agendei ${agendados.length} vídeos no Ney Filmes${falhas.length ? `, e ${falhas.length} falharam` : ''}.`;
  return { text, speech };
}

module.exports = {
  nomeDaObra,
  legenda,
  sinopseDe,
  horarios,
  brt,
  prepararPasta,
  postarVideos,
  resumo,
  contasNey,
  POOL,
  TIPOS,
  MAX_POR_DIA
};
