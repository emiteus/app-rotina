/**
 * Tools soc_* (Fase 4 MCU): Instagram, TikTok e X pelo "Navegador do Jarvis" no PC;
 * YouTube pela API oficial (OAuth no PC). A nuvem nunca vê senha, cookie nem token.
 * Leitura: comentários/DMs voltam isolados como CONTEÚDO EXTERNO.
 * Escrita (4.3): critical com preview; PC executa e registra localmente.
 */
const TYPES = new Set([
  'soc_status',
  'soc_login',
  'soc_posts',
  'soc_comments',
  'soc_inbox',
  'soc_summary',
  'soc_post',
  'soc_reply',
  'soc_dm'
]);

const WRITE = new Set(['soc_post', 'soc_reply', 'soc_dm']);

// O PC espaça as páginas de propósito (45 s entre elas; escrita 90 s) e cada uma carrega devagar
const TIMEOUTS = {
  soc_posts: 130000,
  soc_comments: 130000,
  soc_inbox: 130000,
  soc_summary: 280000,
  soc_login: 20000,
  soc_status: 20000,
  soc_post: 115000,
  soc_reply: 145000,
  soc_dm: 145000
};

const REDE_ALIASES = {
  instagram: 'instagram',
  insta: 'instagram',
  ig: 'instagram',
  tiktok: 'tiktok',
  'tik tok': 'tiktok',
  tt: 'tiktok',
  youtube: 'youtube',
  yt: 'youtube',
  'you tube': 'youtube',
  x: 'x',
  twitter: 'x',
  'x twitter': 'x',
  'x (twitter)': 'x'
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

function cleanTexto(v, max = 500) {
  const t = String(v ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
  if (!t) throw new Error('texto obrigatório');
  if (t.length > max) throw new Error(`texto até ${max} caracteres`);
  return t;
}

function cleanPara(v) {
  const p = String(v ?? '')
    .replace(/^@/, '')
    .trim();
  if (!/^[\w.]{1,30}$/.test(p)) throw new Error('para: @usuario');
  return p;
}

function cleanArgs(tipo, acao) {
  if (tipo === 'soc_status' || tipo === 'soc_summary') return {};
  if (tipo === 'soc_post') {
    return { rede: normRede(acao.rede || acao.network || acao.plataforma), texto: cleanTexto(acao.texto ?? acao.mensagem ?? acao.caption) };
  }
  if (tipo === 'soc_reply') {
    const rede = normRede(acao.rede || acao.network || acao.plataforma);
    const p = acao.post ?? acao.link ?? acao.url ?? 1;
    const asNum = Number(p);
    const post = Number.isInteger(asNum) && asNum >= 1 && asNum <= 20 ? asNum : String(p).trim();
    if (typeof post === 'string' && !/^https:\/\/\S{8,300}$/.test(post)) throw new Error('post: número (1 = mais recente) ou link');
    return { rede, texto: cleanTexto(acao.texto ?? acao.mensagem ?? acao.resposta), post };
  }
  if (tipo === 'soc_dm') {
    return {
      rede: normRede(acao.rede || acao.network || acao.plataforma),
      texto: cleanTexto(acao.texto ?? acao.mensagem, 1000),
      para: cleanPara(acao.para ?? acao.destino ?? acao.usuario ?? acao.username)
    };
  }
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

/** Preview pra aprovação HITL — o Mateus vê exatamente o que vai sair. */
function writePreview(tipo, args) {
  const rede = LABEL[args.rede] || args.rede;
  const texto = String(args.texto || '');
  const block = `«${texto}»`;
  if (tipo === 'soc_post') return `publicar no ${rede}:\n${block}`;
  if (tipo === 'soc_reply') {
    const dest = args.post === 1 || args.post === '1' ? 'no post mais recente' : `em ${args.post}`;
    return `responder ${dest} no ${rede}:\n${block}`;
  }
  if (tipo === 'soc_dm') return `mandar DM no ${rede} pra @${args.para}:\n${block}`;
  return '';
}

const n = (v) => (v === null || v === undefined || Number.isNaN(v) ? '?' : Number(v).toLocaleString('pt-BR'));
const dt = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

/** Sessão caiu / pediu verificação — não é "PC offline" nem freio de ritmo. */
const SESSION_ERR =
  /n[aã]o est[aá] logad|pediu verifica|challenge|checkpoint|account_locked|suspended|entre na sua conta|abra o Navegador do Jarvis.*confirm/i;

/** Evita spam: 1 aviso por rede a cada 6 h (mesmo se a tool falhar várias vezes). */
const ALERT_COOLDOWN_MS = Number(process.env.JARVIS_SOC_ALERT_MS) || 6 * 60 * 60 * 1000;
const lastAlert = new Map(); // `${userId}|${rede}` → ts

function isSessionError(erro) {
  return SESSION_ERR.test(String(erro || ''));
}

async function maybeAlertSession(userId, rede, erro) {
  if (!userId || !isSessionError(erro)) return { skipped: true };
  const key = `${userId}|${rede || '?'}`;
  const now = Date.now();
  if ((lastAlert.get(key) || 0) + ALERT_COOLDOWN_MS > now) return { skipped: true, reason: 'cooldown' };
  lastAlert.set(key, now);
  const nome = LABEL[rede] || rede || 'rede social';
  const text = /verifica|challenge|checkpoint/i.test(String(erro || ''))
    ? `Senhor, o ${nome} pediu verificação da conta. Abra o Navegador do Jarvis (bandeja → Redes sociais) e confirme lá — eu não tento contornar.`
    : `Senhor, o ${nome} não está logado no Navegador do Jarvis. Entre pela bandeja → Redes sociais; eu não digito senha.`;
  const speech = /verifica|challenge|checkpoint/i.test(String(erro || ''))
    ? `Senhor, o ${nome} pediu verificação. Confirme no Navegador do Jarvis.`
    : `Senhor, falta login no ${nome}. Entre pelo Navegador do Jarvis.`;
  return require('../../events/bus').notifyWarnNotes(
    [{ level: 'warn', type: 'soc_session', text, speech }],
    { source: 'social', userId }
  );
}

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
    const erro = /nenhum PC/.test(r.erro || '')
      ? WRITE.has(tipo)
        ? 'as redes sociais escrevem pelo Jarvis Desktop, e nenhum PC está online agora'
        : 'as redes sociais são lidas pelo Jarvis Desktop, e nenhum PC está online agora'
      : r.erro || 'falhou no PC';
    // Fase 4.5: sessão caiu / pediu verificação → avisa (além da resposta da tool)
    try {
      await maybeAlertSession(ctx.userId, args.rede, erro);
    } catch (_) {
      /* aviso nunca derruba a tool */
    }
    return { tipo, ok: false, erro, uncertain: r.uncertain || undefined };
  }
  const res = r.result || {};
  if (tipo === 'soc_status') {
    const on = Object.entries(res)
      .filter(([, v]) => v)
      .map(([k]) => LABEL[k]);
    const off = Object.entries(res)
      .filter(([, v]) => !v)
      .map(([k]) => LABEL[k]);
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
  if (WRITE.has(tipo)) {
    const rede = LABEL[args.rede] || args.rede;
    let texto;
    if (tipo === 'soc_post') texto = `Publiquei no ${rede}: «${args.texto}»`;
    else if (tipo === 'soc_reply') texto = `Respondi no ${rede}${res.destino ? ` (${res.destino})` : ''}: «${args.texto}»`;
    else texto = `Mandei DM no ${rede} pra @${args.para}: «${args.texto}»`;
    return { tipo, ok: true, ...args, destino: res.destino || null, texto, device: r.deviceId };
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

module.exports = {
  TYPES,
  WRITE,
  handle,
  cleanArgs,
  writePreview,
  postsDigest,
  inboxDigest,
  commentsDigest,
  isSessionError,
  maybeAlertSession,
  _resetAlerts: () => lastAlert.clear()
};
