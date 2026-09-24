/**
 * Tools soc_* (Fase 4 MCU, SÓ LEITURA): Instagram, TikTok e X pelo "Navegador do Jarvis" logado no PC;
 * YouTube pela API oficial (OAuth no PC). A nuvem nunca vê senha, cookie nem token.
 * Comentários e DMs são texto de OUTRAS pessoas: voltam isolados como CONTEÚDO EXTERNO.
 */
const TYPES = new Set(['soc_status', 'soc_login', 'soc_posts', 'soc_comments', 'soc_inbox', 'soc_summary']);

// O PC espaça as páginas de propósito (45 s entre elas, pra não arriscar a conta) e cada uma carrega devagar
const TIMEOUTS = { soc_posts: 130000, soc_comments: 130000, soc_inbox: 130000, soc_summary: 280000, soc_login: 20000, soc_status: 20000 };

const REDE_ALIASES = {
  instagram: 'instagram', insta: 'instagram', ig: 'instagram',
  tiktok: 'tiktok', 'tik tok': 'tiktok', tt: 'tiktok',
  youtube: 'youtube', yt: 'youtube', 'you tube': 'youtube',
  x: 'x', twitter: 'x', 'x twitter': 'x', 'x (twitter)': 'x'
};
const LABEL = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', x: 'X' };

const fold = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();

function normRede(v) {
  const r = REDE_ALIASES[fold(v)];
  if (!r) throw new Error('rede: instagram | tiktok | youtube | x');
  return r;
}

function cleanArgs(tipo, acao) {
  if (tipo === 'soc_status' || tipo === 'soc_summary') return {};
  const rede = normRede(acao.rede || acao.network || acao.plataforma);
  if (tipo === 'soc_login' || tipo === 'soc_inbox') return { rede };
  if (tipo === 'soc_posts') {
    const n = Number(acao.quantidade ?? acao.limite ?? acao.n ?? 6);
    return { rede, quantidade: Math.max(1, Math.min(20, Math.round(Number.isFinite(n) ? n : 6))) };
  }
  if (tipo === 'soc_comments') {
    const p = acao.post ?? acao.link ?? acao.url ?? 1;
    const asNum = Number(p);
    if (Number.isInteger(asNum) && asNum >= 1 && asNum <= 20) return { rede, post: asNum };
    const s = String(p).trim();
    if (!/^https:\/\/\S{8,300}$/.test(s)) throw new Error('post: número (1 = mais recente) ou link do post');
    return { rede, post: s };
  }
  return {};
}

const n = (v) => (v === null || v === undefined || Number.isNaN(v) ? '?' : Number(v).toLocaleString('pt-BR'));
const dt = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

function postsDigest(r) {
  const head = [`${LABEL[r.rede]} ${r.conta || ''}`.trim()];
  if (r.seguidores != null) head.push(`${n(r.seguidores)} seguidores`);
  if (r.inscritos != null) head.push(`${n(r.inscritos)} inscritos`);
  if (r.curtidas_total != null) head.push(`${n(r.curtidas_total)} curtidas no total`);
  const lines = (r.posts || []).map((p, i) => {
    const m = [];
    if (p.views != null) m.push(`${n(p.views)} views`);
    if (p.curtidas != null) m.push(`${n(p.curtidas)} curtidas`);
    if (p.comentarios != null) m.push(`${n(p.comentarios)} comentários`);
    if (p.respostas != null) m.push(`${n(p.respostas)} respostas`);
    if (p.reposts != null) m.push(`${n(p.reposts)} reposts`);
    const what = p.titulo || p.legenda || p.texto || p.tipo || '';
    return `${i + 1}. ${dt(p.quando)} ${p.tipo ? `[${p.tipo}] ` : ''}${what}${p.fixado ? ' (fixado)' : ''} — ${m.join(', ') || 'sem métricas'} ${p.link || ''}`.trim();
  });
  return `${head.join(' · ')}\n${lines.join('\n') || '(nenhum post)'}`;
}

function commentsDigest(r) {
  const title = r.post ? `Comentários do post ${r.post.link || ''} (${r.post.legenda || ''})` : r.video ? `Comentários do vídeo ${r.video}` : `Comentários recentes do canal`;
  const lines = (r.comentarios || []).map((c) => `- ${c.de} (${dt(c.quando)}${c.curtidas ? `, ${c.curtidas} curtidas` : ''}): ${c.texto}`);
  return `${LABEL[r.rede]} · ${title}\n${lines.join('\n') || '(nenhum comentário)'}`;
}

function inboxDigest(r) {
  if (r.rede === 'x') {
    const lines = (r.mencoes || []).map((m) => `- ${m.autor || '?'} (${dt(m.quando)}): ${m.texto}`);
    return `X · menções recentes\n${lines.join('\n') || '(nenhuma menção)'}`;
  }
  const lines = (r.conversas || []).map(
    (c) => `- ${c.com}${c.nao_lida ? ' [NÃO LIDA]' : ''} (${dt(c.quando)}): ${c.ultima_foi_minha ? 'você: ' : ''}${c.ultima}`
  );
  return `Instagram · DMs: ${n(r.nao_lidas)} não lida(s)\n${lines.join('\n') || '(sem conversas)'}`;
}

function summaryDigest(r) {
  const parts = [];
  for (const [rede, v] of Object.entries(r.redes || {})) {
    if (v.posts) parts.push(postsDigest(v.posts));
    else if (v.erro) parts.push(`${LABEL[rede]}: erro ao ler (${v.erro})`);
    if (v.caixa) parts.push(inboxDigest(v.caixa));
    else if (v.erro_caixa) parts.push(`${LABEL[rede]} caixa: erro (${v.erro_caixa})`);
  }
  return parts.join('\n\n');
}

async function handle(acao, ctx) {
  const tipo = acao && acao.tipo;
  if (!TYPES.has(tipo)) return null;
  let args;
  try {
    args = cleanArgs(tipo, acao);
  } catch (e) {
    return { tipo, ok: false, erro: e.message };
  }
  const { requestTool } = require('../../devices/gateway');
  const r = await requestTool(ctx.userId, tipo, args, { timeoutMs: TIMEOUTS[tipo] || 70000 });
  if (!r.ok) {
    const erro = /nenhum PC/.test(r.erro || '') ? 'as redes sociais são lidas pelo Jarvis Desktop, e nenhum PC está online agora' : r.erro || 'falhou no PC';
    return { tipo, ok: false, erro, uncertain: r.uncertain || undefined };
  }
  const res = r.result || {};
  if (tipo === 'soc_status') {
    const on = Object.entries(res).filter(([, v]) => v).map(([k]) => LABEL[k]);
    const off = Object.entries(res).filter(([, v]) => !v).map(([k]) => LABEL[k]);
    return {
      tipo,
      ok: true,
      status: res,
      texto: `${on.length ? `Conectado: ${on.join(', ')}.` : 'Nenhuma rede conectada ainda.'}${off.length ? ` Falta: ${off.join(', ')} (bandeja → Redes sociais).` : ''}`
    };
  }
  if (tipo === 'soc_login') {
    return { tipo, ok: true, ...args, texto: `Abri o Navegador do Jarvis no ${LABEL[args.rede]}. Entre na sua conta e feche a janela quando terminar.` };
  }
  const digest =
    tipo === 'soc_posts' ? postsDigest(res) : tipo === 'soc_comments' ? commentsDigest(res) : tipo === 'soc_inbox' ? inboxDigest(res) : summaryDigest(res);
  const { isolatedAnswer } = require('./data-answer');
  const texto = await isolatedAnswer({
    pergunta: acao.pergunta || acao.question,
    digest,
    source: 'redes',
    what: 'redes sociais do usuário (métricas, comentários e mensagens de outras pessoas)',
    chamarIA: ctx.chamarIA
  });
  return { tipo, ok: true, ...args, texto, device: r.deviceId };
}

module.exports = { TYPES, handle, cleanArgs, postsDigest, inboxDigest, commentsDigest };
