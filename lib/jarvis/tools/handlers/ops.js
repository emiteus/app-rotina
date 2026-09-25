const { requireLib, requireConnector } = require('../../host');

const TYPES = new Set([
  'cinerush_buscar',
  'cinerush_provisionar',
  'cinerush_criar',
  'cinerush_reenviar_email',
  'chatwoot_listar',
  'chatwoot_resolver',
  'chatwoot_atribuir',
  'attracione_coleta',
  'attracione_backup',
  'attracione_ranking',
  'socialhub_posts',
  'socialhub_agendar',
  'socialhub_publicar_agendados',
  'socialhub_post_acao',
  'teushub_ney_filmes',
  'clipper_criar',
  'clipper_retry',
  'minerador_em_alta',
  'minerador_paginas',
  'minerador_pagina',
  'minerador_video',
  'minerador_varrer',
  'cinerush_editor_process',
  'cinerush_editor_batch',
  'cinerush_editor_job_status',
  'cinerush_editor_jobs',
  'cinerush_editor_agendados',
  'cutflix_status',
  'projeto_milhao_fechamento',
  'snapshot_refresh',
  'ops_flag_list',
  'ops_flag_get',
  'ops_flag_set'
]);

const quando = (v) => {
  if (!v) return '?';
  const d = typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v);
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 16);
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

/** Post do TeusHub enxuto pro modelo: quando, onde e, se falhou, por quê. */
function socialhubItem(p) {
  return {
    id: p.id,
    caption: String(p.caption || '').slice(0, 120),
    status: p.status,
    quando: quando(p.status === 'PUBLISHED' ? p.publishedAt : p.scheduledAt || p.createdAt),
    redes: (p.platforms || []).map((x) => ({
      rede: x.platform,
      conta: x.account,
      status: x.status,
      ...(x.error ? { motivo: String(x.error).slice(0, 200) } : {})
    }))
  };
}

const POST_ACOES = {
  cancelar: 'cancel', cancel: 'cancel', desagendar: 'cancel',
  reagendar: 'reschedule', reprogramar: 'reschedule', reschedule: 'reschedule', adiar: 'reschedule',
  tentar_novamente: 'retry', retry: 'retry', repostar: 'retry', republicar: 'retry'
};

/**
 * Cancelar / reagendar / tentar de novo — 1 post (id) ou vários (ids | "todos" os agendados/falhos).
 * Reagendar vários: 1º em scheduledAt (ou agora), os outros a cada intervalo_min (+variacao_min).
 */
async function socialhubPostAcao(sh, acao) {
  const tipo = 'socialhub_post_acao';
  const action = POST_ACOES[String(acao.acao || acao.action || '').toLowerCase().trim()];
  if (!action) return { tipo, ok: false, erro: 'acao: cancelar | reagendar | tentar_novamente' };

  let ids = Array.isArray(acao.ids) ? acao.ids.map(String) : acao.id ? [String(acao.id)] : [];
  if (!ids.length || acao.ids === 'todos' || acao.todos === true) {
    // Sem id: pega a fila certa pro tipo de ação (falhos pra repetir, agendados pro resto)
    const out = await sh.listarPosts(action === 'retry' ? 'FAILED' : 'SCHEDULED', 30);
    ids = (out.posts || []).map((p) => p.id);
    if (!ids.length) {
      return { tipo, ok: false, erro: action === 'retry' ? 'Nenhum post com falha no TeusHub' : 'Nenhum post agendado no TeusHub' };
    }
  }
  if (ids.length > 30) ids = ids.slice(0, 30);

  let horarios = [];
  if (action === 'reschedule' || (action === 'retry' && acao.scheduledAt)) {
    const inicio = acao.scheduledAt ? new Date(acao.scheduledAt).getTime() : Date.now() + 60000;
    if (Number.isNaN(inicio)) return { tipo, ok: false, erro: 'scheduledAt inválido (ISO)' };
    horarios = sh.espalharHorarios(ids.length, {
      inicio,
      intervaloMin: Math.max(1, Number(acao.intervalo_min) || (ids.length > 1 ? 15 : 0)),
      variacaoMin: Math.max(0, Number(acao.variacao_min) || 0)
    });
  }

  const feitos = [];
  const falhas = [];
  for (let i = 0; i < ids.length; i++) {
    try {
      const r = await sh.postAcao(ids[i], action, horarios[i]);
      feitos.push({ id: ids[i], quando: r.post?.scheduledAt ? quando(r.post.scheduledAt) : null });
    } catch (e) {
      falhas.push({ id: ids[i], erro: e.message });
    }
  }
  return {
    tipo,
    ok: feitos.length > 0,
    acao: action,
    feitos,
    falhas,
    ...(feitos.length ? {} : { erro: falhas[0]?.erro || 'nada feito' })
  };
}

/** "100k", "100 mil", "1,5 mi", 100000 → número (0 se não entendeu). "100.000" = cem mil; "1.5k" = mil e quinhentos. */
function parseViews(bruto) {
  const v = String(bruto ?? '').toLowerCase().replace(/\s+/g, '');
  const m = v.match(/^([\d.,]+)(k|mil|m|mi|milh[oõ]es)?$/);
  if (!m) return 0;
  const n = m[2] ? Number(m[1].replace(',', '.')) : Number(m[1].replace(/[.,]/g, ''));
  return Math.round(n * (m[2] === 'k' || m[2] === 'mil' ? 1e3 : m[2] ? 1e6 : 1)) || 0;
}

const fmtNum = (n) => Number(n || 0).toLocaleString('pt-BR');

// Quanto a tool espera a varredura antes de ir pro segundo plano (os smokes encurtam)
let varreduraEsperaMs = 35000;
let varreduraPollMs = 4000;
function _setVarreduraTiming(espera, poll) {
  varreduraEsperaMs = espera;
  varreduraPollMs = poll;
}

/** Resultado da varredura → itens curtos (legenda é texto externo do Kwai: cortada). */
function itensDaVarredura(out) {
  return (out.videos || []).map((v, i) => ({
    pos: i + 1,
    videoId: v.videoId,
    views: v.views,
    likes: v.likes,
    publicadoEm: v.publicadoEm ? String(v.publicadoEm).slice(0, 10) : null,
    url: v.url,
    legenda: String(v.legenda || '').replace(/\s+/g, ' ').slice(0, 80)
  }));
}

/** Aviso de fim da varredura (texto no PC/celular/WhatsApp + fala curta). */
function avisoVarredura(out, minViews) {
  const itens = itensDaVarredura(out);
  const filtro = minViews ? ` com ${fmtNum(minViews)}+ views` : '';
  const cab = `Varri a @${out.handle} inteira: ${fmtNum(out.total)} vídeos${out.completo ? '' : ' (parcial)'}; ${fmtNum(out.acimaDoMinimo)}${filtro || ' no total'}.`;
  const linhas = itens.slice(0, 15).map((v) => `${v.pos}. ${fmtNum(v.views)} views · ${v.publicadoEm || '?'}\n   ${v.url}`);
  return {
    text: `${cab}\n\nMais virais:\n${linhas.join('\n') || '(nenhum bate com o filtro)'}${out.erro ? `\n\n⚠️ ${out.erro}` : ''}`,
    speech: `Senhor, terminei a varredura da página ${out.handle}. ${itens.length ? `O mais visto tem ${fmtNum(itens[0].views)} visualizações. A lista está no painel.` : 'Nenhum vídeo bateu com o filtro.'}`
  };
}

/** Minerador: em alta / páginas / marcar vídeo. Legenda e @ vêm do Kwai → texto externo, curto. */
async function mineradorAcao(mn, tipo, acao, userId) {
  if (tipo === 'minerador_varrer') {
    // Uma ou várias: `paginas` (lista) ou vários links/@ no mesmo texto
    const bruto = Array.isArray(acao.paginas) ? acao.paginas.join(' ') : String(acao.pagina || acao.paginas || acao.handle || acao.link || '');
    const refs = [...new Set((bruto.match(/https?:\/\/\S+|@[\w.-]{2,40}/g) || []).map((x) => x.replace(/[),.;]+$/, '')))];
    if (!refs.length && bruto.trim()) refs.push(bruto.trim());
    if (!refs.length) return { tipo, ok: false, erro: 'Qual página? Manda o @ ou o link de um vídeo dela' };
    const minViews = parseViews(acao.min_views ?? acao.minimo);
    const limite = Math.min(30, Math.max(1, parseInt(acao.limite, 10) || 10));
    const dias = Math.max(0, parseInt(acao.dias, 10) || 0) || undefined;
    const bus = () => require('../../events/bus');
    const avisar = (text, speech) => bus().notifyWarnNotes([{ level: 'warn', type: 'minerador_varredura', text, speech }], { source: 'minerador', userId });

    /** Começa (esperando a vez se outra varredura estiver rodando) e acompanha até `ate`. */
    async function varrerUma(ref, ate) {
      let job = null;
      while (!job) {
        try {
          job = await mn.varrer(ref, { dias });
        } catch (e) {
          if (e.status !== 409 || Date.now() > ate) throw e;
          await new Promise((ok) => setTimeout(ok, varreduraPollMs * 3));
        }
      }
      const ver = () => mn.varredura(job.id, { minViews, limite: Math.max(limite, 15), dias });
      let out = await ver();
      while (out.status === 'rodando' && Date.now() < ate) {
        await new Promise((ok) => setTimeout(ok, varreduraPollMs));
        out = await ver().catch(() => out);
      }
      return { ...out, reaproveitada: !!job.reaproveitada };
    }

    async function avisarFim(ref, out) {
      if (out.status === 'pronta') {
        const { text, speech } = avisoVarredura(out, minViews);
        return avisar(text, speech);
      }
      return avisar(`Varredura da @${out.handle || ref} não terminou: ${out.erro || 'demorou demais'}`, 'Senhor, a varredura da página no Kwai não terminou.');
    }

    if (refs.length === 1) {
      // Página pequena termina em segundos: espera um pouco antes de ir pro segundo plano
      const out = await varrerUma(refs[0], Date.now() + varreduraEsperaMs);
      if (out.status === 'erro') return { tipo, ok: false, erro: `Não consegui varrer @${out.handle}: ${out.erro}` };
      if (out.status === 'pronta') {
        return {
          tipo, ok: true, pronta: true, handle: out.handle, total: out.total, acimaDoMinimo: out.acimaDoMinimo,
          minViews, completo: out.completo, erro_parcial: out.erro || null, itens: itensDaVarredura(out).slice(0, limite)
        };
      }
      // Segue em segundo plano e avisa no fim (até 25 min)
      varrerUma(refs[0], Date.now() + 25 * 60 * 1000)
        .then((r) => avisarFim(refs[0], r))
        .catch((e) => avisar(`Varredura da ${refs[0]} parou: ${e.message}`, 'Senhor, a varredura da página no Kwai parou.'))
        .catch(() => {});
      return { tipo, ok: true, pronta: false, paginas: [out.handle], lidos: out.lidos, reaproveitada: out.reaproveitada };
    }

    // Várias: uma de cada vez em segundo plano, um aviso por página
    (async () => {
      for (const ref of refs.slice(0, 10)) {
        const r = await varrerUma(ref, Date.now() + 25 * 60 * 1000).catch((e) => ({ status: 'erro', handle: ref.replace(/^@/, ''), erro: e.message }));
        await avisarFim(ref, r).catch(() => {});
      }
    })().catch(() => {});
    return { tipo, ok: true, pronta: false, paginas: refs.slice(0, 10), minViews };
  }
  if (tipo === 'minerador_em_alta') {
    const minViews = parseViews(acao.min_views ?? acao.minimo);
    const ordem = /views|virais|vistos|mais/.test(String(acao.ordem || '')) ? 'views' : 'alta';
    const out = await mn.feed({
      janela: acao.janela || 6,
      limite: Math.min(20, acao.limite || 10),
      pagina: acao.pagina,
      minViews,
      ordem,
      dias: acao.dias || (ordem === 'views' ? 30 : undefined)
    });
    return {
      tipo,
      ok: true,
      ordem: out.ordem,
      minViews: out.minViews,
      dias: out.maxIdadeDias,
      janelaH: out.janelaH,
      itens: (out.videos || []).map((v, i) => ({
        pos: i + 1,
        videoId: v.videoId,
        pagina: v.handle,
        views: v.views,
        porHora: v.porHora,
        estimado: !!v.estimado,
        acimaDaPagina: v.acimaDaPagina,
        idadeH: v.idadeH,
        url: v.url,
        legenda: String(v.legenda || '').slice(0, 90)
      }))
    };
  }
  if (tipo === 'minerador_paginas') {
    const [s, st] = await Promise.all([mn.sources(), mn.status()]);
    return {
      tipo,
      ok: true,
      paginas: (s.sources || []).map((p) => ({ pagina: p.handle, ativa: p.ativo, videos: p.videosUltima, erro: p.ultimoErro })),
      ultimaRodada: st.ultimaRodada || null
    };
  }
  if (tipo === 'minerador_pagina') {
    // Uma ou várias: lista em `paginas`, ou vários links/@ colados no mesmo texto
    const bruto = Array.isArray(acao.paginas) ? acao.paginas.join(' ') : String(acao.pagina || acao.handle || acao.link || acao.paginas || '');
    const refs = [...new Set((bruto.match(/https?:\/\/\S+|@[\w.-]{2,40}/g) || []).map((x) => x.replace(/[),.;]+$/, '')))];
    if (!refs.length && bruto.trim()) refs.push(bruto.trim());
    if (!refs.length) return { tipo, ok: false, erro: 'Qual página? Manda o @ ou o link de um vídeo dela' };
    if (/^(remover|parar|tirar|desligar)/i.test(String(acao.acao || ''))) {
      for (const r of refs) await mn.removeSource(r);
      return { tipo, ok: true, acao: 'remover', paginas: refs.map((r) => r.replace(/^@/, '')) };
    }
    const out = await mn.addSources(refs.slice(0, 50));
    return {
      tipo,
      ok: true, // mesmo com 0 adicionadas: a narração explica quais estavam paradas/erradas
      acao: 'adicionar',
      adicionadas: (out.resultados || []).filter((r) => r.ok).map((r) => r.handle),
      paradas: (out.resultados || []).filter((r) => r.parada).map((r) => `${r.handle} (${r.diasParada} dias)`),
      falhas: (out.resultados || []).filter((r) => !r.ok && !r.parada).map((r) => `${r.ref}: ${r.erro}`)
    };
  }
  const status = String(acao.status || '').toLowerCase();
  if (!['descartado', 'cortado', 'novo'].includes(status)) return { tipo, ok: false, erro: 'status: descartado | cortado | novo' };
  if (!acao.videoId) return { tipo, ok: false, erro: 'videoId obrigatório' };
  await mn.setStatus(acao.videoId, status);
  return { tipo, ok: true, videoId: String(acao.videoId), status };
}

/** Trabalhos do Editor em texto pro modelo (vai isolado como conteúdo externo). */
function editorJobsDigest(out, usuario) {
  const q = out.queue || {};
  const linhas = [
    `Fila agora: ${q.running || 0} processando, ${q.queued || 0} esperando (até ${q.max_concurrent || 3} ao mesmo tempo).`,
    `Na memória do servidor (os terminados somem ~1 h depois): ${Object.entries(out.counts || {}).map(([k, n]) => `${n} ${k}`).join(', ') || 'nenhum trabalho'}.`
  ];
  const pu = Object.entries(out.por_usuario || {});
  if (pu.length) linhas.push(`Ativos/erro por usuário: ${pu.map(([e, c]) => `${e} (${c.running} processando, ${c.queued} na fila, ${c.error} com erro)`).join('; ')}.`);
  if (usuario) linhas.push(`Filtro de usuário: "${usuario}" → ${out.total || 0} trabalho(s).`);
  for (const j of out.jobs || []) {
    linhas.push(`- [${j.status}] ${j.email} · ${j.output_name || 'corte'} · etapa ${j.step || '?'} ${j.progress != null ? `${j.progress}%` : ''} · criado ${quando(j.created_at)}${j.error ? ` · ERRO: ${j.error}` : ''}${j.batch_id ? ' · lote' : ''}`);
  }
  return linhas.join('\n');
}

/** Posts (agendados/falhos/postados) em texto pro modelo. */
function editorPostsDigest(out, usuario) {
  const nome = { scheduled: 'agendados', failed: 'que falharam', posted: 'publicados' }[out.status] || out.status;
  const linhas = [`Posts ${nome}${usuario ? ` do filtro "${usuario}"` : ''}: ${out.total || 0}.`];
  const pu = Object.entries(out.por_usuario || {}).sort((a, b) => b[1].total - a[1].total);
  if (pu.length) {
    linhas.push(
      `Por usuário: ${pu
        .slice(0, 15)
        .map(([e, u]) => `${e}: ${u.total}${out.status === 'scheduled' && u.proximo ? ` (próximo ${quando(u.proximo)}, último ${quando(u.ultimo)})` : u.ultimo ? ` (mais recente ${quando(u.ultimo)})` : ''}`)
        .join('; ')}.`
    );
  }
  for (const p of out.posts || []) {
    linhas.push(`- ${p.email} · ${quando(p.quando)}${p.legenda ? ` · "${p.legenda}"` : ''}${p.erro ? ` · ERRO: ${p.erro}` : ''}`);
  }
  return linhas.join('\n');
}

async function handle(acao, ctx) {
  const tipo = acao && acao.tipo;
  if (!TYPES.has(tipo)) return null;

  const { userId } = ctx;

  if (
    tipo === 'cinerush_buscar' ||
    tipo === 'cinerush_provisionar' ||
    tipo === 'cinerush_criar' ||
    tipo === 'cinerush_reenviar_email'
  ) {
    const { isPlanoOwnerUserId } = requireLib('plano-owner');
    if (!(await isPlanoOwnerUserId(userId))) {
      return { tipo, ok: false, erro: 'CineRush só pro dono' };
    }
    const cr = requireConnector('cinerush');
    if (!cr.cinerushReady()) {
      return { tipo, ok: false, erro: 'CineRush não configurado' };
    }
    if (tipo === 'cinerush_criar') {
      const email = String(acao.email || acao.search || '').trim().toLowerCase();
      const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      if (!emailOk) {
        return {
          tipo,
          ok: false,
          erro: 'Pra criar acesso preciso de um **email** válido. Ex.: criar acesso pra joao@x.com no cinerush'
        };
      }
      if (
        /^(email@x\.com|a@b\.com)$/i.test(email) ||
        /@(example\.com|exemplo\.com|test\.com)$/i.test(email)
      ) {
        return {
          tipo,
          ok: false,
          erro:
            'Esse email parece de exemplo (tipo email@x.com). Manda o email **real** do cliente pra eu gerar o acesso e o link de config.'
        };
      }
      const nome =
        String(acao.nome || acao.name || '').trim() ||
        email.split('@')[0].replace(/[._]+/g, ' ').slice(0, 80);
      const plano = String(acao.plano || 'mensal').toLowerCase();
      try {
        const out = await cr.criarAssinante({
          nome,
          email,
          telefone: acao.telefone || acao.phone || null,
          plano: /^(mensal|trimestral|semestral|anual)$/.test(plano) ? plano : 'mensal',
          send_whatsapp: !!acao.send_whatsapp
        });
        return {
          tipo,
          ok: true,
          id: out.id,
          nome: out.nome,
          email: out.email,
          usuario: out.usuario,
          status: out.status,
          plano: out.plano,
          config_link: out.config_link,
          access_url: out.access_url
        };
      } catch (e) {
        return { tipo, ok: false, erro: e.message || 'falha ao criar acesso' };
      }
    }
    if (tipo === 'cinerush_buscar') {
      const out = await cr.buscarAssinantes(acao.search || acao.q || '', acao.status || undefined);
      return {
        tipo,
        ok: true,
        total: out.total,
        itens: (out.data || []).slice(0, 8).map((s) => ({
          id: s.id,
          nome: s.nome,
          email: s.email,
          plano: s.plano,
          status: s.status
        }))
      };
    }
    if (tipo === 'cinerush_provisionar') {
      let id = acao.id;
      if (!id && (acao.search || acao.email || acao.nome)) {
        const q = acao.search || acao.email || acao.nome;
        let found = await cr.buscarAssinantes(q, 'pendente');
        let hit = (found.data || [])[0];
        if (!hit) {
          found = await cr.buscarAssinantes(q);
          hit = (found.data || [])[0];
          if (hit && hit.status && hit.status !== 'pendente') {
            return {
              tipo,
              ok: false,
              erro: `Assinante **${hit.email || hit.nome || q}** já está **${hit.status}** (não é pendente). Quer reenviar e-mail?`,
              id: hit.id,
              status: hit.status
            };
          }
        }
        if (!hit) {
          return {
            tipo,
            ok: false,
            erro:
              `Não achei assinante pendente com "${q}". ` +
              `Pra acesso novo use cinerush_criar; provisionar só libera quem já está **pendente**.`
          };
        }
        id = hit.id;
      }
      if (!id) {
        return { tipo, ok: false, erro: 'id ou search obrigatório' };
      }
      const updated = await cr.provisionarAssinante(id);
      return {
        tipo,
        ok: true,
        id: updated.id || id,
        nome: updated.nome,
        email: updated.email,
        status: updated.status
      };
    }
    let id = acao.id;
    if (!id && (acao.search || acao.email || acao.nome)) {
      const found = await cr.buscarAssinantes(acao.search || acao.email || acao.nome);
      const hit = (found.data || [])[0];
      if (!hit) {
        return { tipo, ok: false, erro: 'Assinante não encontrado' };
      }
      id = hit.id;
    }
    if (!id) {
      return { tipo, ok: false, erro: 'id ou search obrigatório' };
    }
    const updated = await cr.reenviarEmailAssinante(id, acao.force !== false);
    return {
      tipo,
      ok: true,
      id: updated.id || id,
      nome: updated.nome,
      email: updated.email,
      status: updated.status
    };
  }

  if (
    tipo === 'chatwoot_listar' ||
    tipo === 'chatwoot_resolver' ||
    tipo === 'chatwoot_atribuir'
  ) {
    const { isPlanoOwnerUserId } = requireLib('plano-owner');
    if (!(await isPlanoOwnerUserId(userId))) {
      return { tipo, ok: false, erro: 'Chatwoot só pro dono' };
    }
    const cr = requireConnector('cinerush');
    if (!cr.cinerushReady()) {
      return { tipo, ok: false, erro: 'CineRush/Chatwoot não configurado' };
    }
    if (tipo === 'chatwoot_listar') {
      const out = await cr.listarChatwoot(acao.status || 'open', acao.limit || 15);
      return {
        tipo,
        ok: true,
        total: out.total,
        itens: out.items || []
      };
    }
    if (tipo === 'chatwoot_resolver') {
      if (!acao.id) {
        return { tipo, ok: false, erro: 'id da conversa obrigatório' };
      }
      await cr.resolverChatwoot(acao.id);
      return { tipo, ok: true, id: acao.id };
    }
    if (!acao.id) {
      return { tipo, ok: false, erro: 'id da conversa obrigatório' };
    }
    await cr.atribuirChatwoot(acao.id, acao.team_id);
    return { tipo, ok: true, id: acao.id };
  }

  if (tipo === 'attracione_coleta' || tipo === 'attracione_backup' || tipo === 'attracione_ranking') {
    const { isPlanoOwnerUserId } = requireLib('plano-owner');
    if (!(await isPlanoOwnerUserId(userId))) {
      return { tipo, ok: false, erro: 'Attracione só pro dono' };
    }
    const at = requireConnector('attracione');
    if (!at.attracioneReady()) {
      return { tipo, ok: false, erro: 'Attracione não configurado' };
    }
    if (tipo === 'attracione_coleta') {
      const out = await at.dispararColeta(acao.plataforma || undefined);
      const { bypassProjetosCache, scheduleProjetosRefresh } = require('../../snapshot-cache');
      bypassProjetosCache(userId, 120000);
      scheduleProjetosRefresh(userId, [45000, 90000, 150000]);
      return {
        tipo,
        ok: true,
        resultado: out,
        aviso:
          'Coleta disparada — ranking/hoje atualizam quando o scraper terminar (pode levar 1–3 min). Use snapshot_refresh depois.'
      };
    }
    if (tipo === 'attracione_backup') {
      const out = await at.dispararBackup();
      return { tipo, ok: true, resultado: out };
    }
    const out = await at.rankingComp(acao.n || acao.comp || acao.numero);
    return {
      tipo,
      ok: true,
      competicao: out.competicao,
      top: (out.linhas || []).slice(0, 15).map((l) => ({
        pos: l.posicao,
        nome: l.nomeCompleto,
        views: l.views,
        videos: l.videos != null ? l.videos : null,
        premio: l.valor
      }))
    };
  }

  if (
    tipo === 'socialhub_posts' ||
    tipo === 'socialhub_agendar' ||
    tipo === 'socialhub_publicar_agendados' ||
    tipo === 'socialhub_post_acao'
  ) {
    const { isPlanoOwnerUserId } = requireLib('plano-owner');
    if (!(await isPlanoOwnerUserId(userId))) {
      return { tipo, ok: false, erro: 'SocialHub só pro dono' };
    }
    const sh = requireConnector('socialhub');
    if (!sh.socialhubReady()) {
      return { tipo, ok: false, erro: 'SocialHub não configurado' };
    }
    if (tipo === 'socialhub_posts') {
      const out = await sh.listarPosts(acao.status || undefined, acao.limit || 10, { id: acao.id });
      return { tipo, ok: true, status: sh.normalizeStatus(acao.status), itens: (out.posts || []).map(socialhubItem) };
    }
    if (tipo === 'socialhub_agendar') {
      // Aceita ids ou nomes ("instagram", "tiktok", "@misterressence", "todas")
      let ids = acao.socialAccountIds || acao.accountIds;
      if (!Array.isArray(ids) || !ids.length || acao.contas) {
        const { accounts = [] } = await sh.listarContas();
        const r = sh.resolverContas(acao.contas || ids || [], accounts);
        if (r.naoAchei.length || !r.ids.length) {
          const tem = accounts.map((c) => `${c.platform.toLowerCase()} @${c.username}`).join(', ');
          return { tipo, ok: false, erro: `Não achei a conta ${r.naoAchei.join(', ') || '(nenhuma informada)'} no TeusHub. Conectadas: ${tem}` };
        }
        ids = r.ids;
      }
      const mediaUrls = acao.mediaUrls || (acao.media_url ? [acao.media_url] : undefined);
      const out = await sh.agendarPost({
        caption: acao.caption,
        socialAccountIds: ids,
        scheduledAt: acao.scheduledAt || new Date(Date.now() + 60000).toISOString(),
        mediaUrls,
        mediaType: acao.mediaType
      });
      return {
        tipo,
        ok: true,
        id: out.post?.id,
        scheduledAt: out.post?.scheduledAt,
        quando: quando(out.post?.scheduledAt),
        contas: ids.length
      };
    }
    if (tipo === 'socialhub_post_acao') {
      return socialhubPostAcao(sh, acao);
    }
    const out = await sh.publicarAgendados();
    return {
      tipo,
      ok: true,
      processed: out.cron?.processed,
      resultado: out.cron || out
    };
  }

  if (tipo === 'clipper_criar' || tipo === 'clipper_retry') {
    const { isPlanoOwnerUserId } = requireLib('plano-owner');
    if (!(await isPlanoOwnerUserId(userId))) {
      return { tipo, ok: false, erro: 'Clipper só pro dono' };
    }
    const cl = requireConnector('clipper');
    if (!cl.clipperReady()) {
      return {
        tipo,
        ok: false,
        erro: 'Clipper offline — defina CLIPPER_API_URL (túnel pro PC)'
      };
    }
    if (tipo === 'clipper_criar') {
      const out = await cl.criarClip({
        durationSeconds: acao.durationSeconds || acao.duracao || 30,
        note: acao.note || acao.nota,
        streamIds: acao.streamIds
      });
      return { tipo, ok: true, id: out.group?.id, group: out.group };
    }
    if (!acao.id) {
      return { tipo, ok: false, erro: 'id do grupo obrigatório' };
    }
    const out = await cl.retryClip(acao.id);
    return { tipo, ok: true, id: acao.id, group: out.group };
  }

  if (tipo === 'teushub_ney_filmes') {
    const { isPlanoOwnerUserId } = requireLib('plano-owner');
    if (!(await isPlanoOwnerUserId(userId))) return { tipo, ok: false, erro: 'Ney Filmes só pro dono' };
    const sh = requireConnector('socialhub');
    if (!sh.socialhubReady()) return { tipo, ok: false, erro: 'TeusHub não configurado' };
    const pasta = String(acao.pasta || acao.path || '').trim();
    if (!pasta) return { tipo, ok: false, erro: 'Qual pasta? Ex.: "posta os vídeos da pasta Downloads/Ney no Ney Filmes"' };
    const ney = require('../../ops/ney-filmes');
    const contas = await ney.contasNey(sh);
    const prep = await ney.prepararPasta(userId, pasta);
    if (!prep.novos.length) {
      return { tipo, ok: true, pasta: prep.pasta, novos: 0, repetidos: prep.repetidos, conta: contas.map((c) => `@${c.username}`).join(', ') };
    }
    // Sobe e agenda em segundo plano (vários minutos); o aviso chega no fim (voz no PC / celular / WhatsApp)
    ney
      .postarVideos(userId, prep.novos)
      .then((r) => {
        const { text, speech } = ney.resumo(r);
        return require('../../events/bus').notifyWarnNotes([{ level: 'warn', type: 'ney_filmes', text, speech }], { source: 'ney', userId });
      })
      .catch((e) =>
        require('../../events/bus').notifyWarnNotes(
          [{ level: 'warn', type: 'ney_filmes', text: `Ney Filmes: parei no meio — ${e.message}`, speech: 'Senhor, a postagem do Ney Filmes parou no meio.' }],
          { source: 'ney', userId }
        )
      );
    return {
      tipo,
      ok: true,
      pasta: prep.pasta,
      novos: prep.novos.length,
      repetidos: prep.repetidos,
      conta: contas.map((c) => `@${c.username}`).join(', '),
      arquivos: prep.novos.slice(0, 20).map((v) => v.nome)
    };
  }

  if (tipo.startsWith('minerador_')) {
    const { isPlanoOwnerUserId } = requireLib('plano-owner');
    if (!(await isPlanoOwnerUserId(userId))) return { tipo, ok: false, erro: 'Minerador só pro dono' };
    const mn = requireConnector('minerador');
    if (!mn.mineradorReady()) return { tipo, ok: false, erro: 'Minerador ainda não está no ar (falta MINERADOR_URL/OPS_KEY)' };
    return mineradorAcao(mn, tipo, acao, userId);
  }

  if (
    tipo === 'cinerush_editor_process' ||
    tipo === 'cinerush_editor_batch' ||
    tipo === 'cinerush_editor_job_status' ||
    tipo === 'cinerush_editor_jobs' ||
    tipo === 'cinerush_editor_agendados'
  ) {
    const { isPlanoOwnerUserId } = requireLib('plano-owner');
    if (!(await isPlanoOwnerUserId(userId))) {
      return { tipo, ok: false, erro: 'CineRush Editor só pro dono' };
    }
    const ed = requireConnector('cinerush-editor');
    if (!ed.cinerushEditorReady()) {
      return {
        tipo,
        ok: false,
        erro: 'CineRush Editor offline — CINERUSH_EDITOR_URL/OPS_KEY'
      };
    }
    // Consultas (25/09/2026): antes o Jarvis só via o total da fila e respondia com um resumo genérico
    if (tipo === 'cinerush_editor_jobs' || tipo === 'cinerush_editor_agendados') {
      const { isolatedAnswer } = require('./data-answer');
      const usuario = String(acao.usuario || acao.user || acao.email || '').trim().slice(0, 60);
      const pergunta = acao.pergunta || acao.question || '';
      let digest;
      if (tipo === 'cinerush_editor_jobs') {
        const mapa = { erro: 'error', erros: 'error', falha: 'error', processando: 'running', rodando: 'running', fila: 'queued', esperando: 'queued', prontos: 'done', todos: 'all' };
        const st = mapa[String(acao.status || '').toLowerCase()] || String(acao.status || '').toLowerCase();
        const out = await ed.listJobs({ status: ['error', 'running', 'queued', 'done', 'all'].includes(st) ? st : '', user: usuario, limit: 20 });
        digest = editorJobsDigest(out, usuario);
      } else {
        const mapa = { agendados: 'scheduled', programados: 'scheduled', falhos: 'failed', falharam: 'failed', erro: 'failed', postados: 'posted', publicados: 'posted' };
        const st = mapa[String(acao.status || 'agendados').toLowerCase()] || 'scheduled';
        const out = await ed.listScheduled({ status: st, user: usuario, limit: 30 });
        digest = editorPostsDigest(out, usuario);
      }
      const texto = await isolatedAnswer({ pergunta, digest, source: 'cinerush_editor', what: 'dados do CineRush Editor (clientes, legendas e erros escritos por terceiros)', chamarIA: ctx.chamarIA });
      return { tipo, ok: true, texto, usuario: usuario || null };
    }
    if (tipo === 'cinerush_editor_process') {
      const out = await ed.processClip(acao);
      return {
        tipo,
        ok: true,
        job_id: out.job_id,
        status: out.status,
        position: out.position
      };
    }
    if (tipo === 'cinerush_editor_batch') {
      const out = await ed.processBatch(acao);
      return {
        tipo,
        ok: true,
        batch_id: out.batch_id,
        jobs: out.jobs || []
      };
    }
    const jobId = acao.job_id || acao.jobId || acao.id;
    const batchId = acao.batch_id || acao.batchId;
    if (batchId) {
      const out = await ed.getBatchStatus(batchId);
      return { tipo, ok: true, batch_id: batchId, batch: out };
    }
    if (!jobId) {
      // "status da fila" sem código de trabalho (24/09/2026: dava erro) → responde com a fila geral
      const snap = await ed.getCinerushEditorSnapshot().catch(() => null);
      const q = snap && snap.queue;
      if (!q) return { tipo, ok: false, erro: 'não consegui ler a fila do Editor agora' };
      const rodando = Number(q.running || 0);
      const esperando = Number(q.queued || 0);
      const texto =
        rodando || esperando
          ? `Fila do CineRush Editor: **${rodando}** processando e **${esperando}** esperando (até ${q.max_concurrent || 3} ao mesmo tempo).`
          : 'Fila do CineRush Editor vazia: nada processando nem esperando agora.';
      return { tipo, ok: true, fila: true, running: rodando, queued: esperando, texto };
    }
    const out = await ed.getJobStatus(jobId);
    const failed =
      out.error ||
      /^(failed|error|cancelled|canceled)$/i.test(String(out.status || ''));
    return {
      tipo,
      ok: !failed,
      job_id: jobId,
      status: out.status,
      result: out.result || null,
      error: out.error || null,
      erro: failed
        ? out.error || `Job em status **${out.status}**`
        : undefined,
      job: out
    };
  }

  if (tipo === 'cutflix_status') {
    const { isPlanoOwnerUserId } = requireLib('plano-owner');
    if (!(await isPlanoOwnerUserId(userId))) {
      return { tipo, ok: false, erro: 'Cutflix só pro dono' };
    }
    const cf = requireConnector('cutflix');
    const snap = await cf.getCutflixSnapshot();
    return {
      tipo,
      ok: true,
      conectado: !!snap.conectado,
      status: snap.status || null,
      motivo: snap.motivo || null,
      erro: snap.erro || null,
      snapshot: snap
    };
  }

  if (tipo === 'projeto_milhao_fechamento') {
    const { isPlanoOwnerUserId } = requireLib('plano-owner');
    if (!(await isPlanoOwnerUserId(userId))) {
      return { tipo, ok: false, erro: 'Projeto Milhão só pro dono' };
    }
    const pm = requireConnector('projeto-milhao');
    if (!pm.projetoMilhaoReady()) {
      return { tipo, ok: false, erro: 'Projeto Milhão não configurado (URL ou data/)' };
    }
    const ymd = acao.ymd || acao.data || acao.dia || undefined;
    const out = await pm.projetoMilhaoFechamento(ymd);
    return { tipo, ...out };
  }

  if (tipo === 'snapshot_refresh') {
    const {
      invalidateUserCaches,
      bypassProjetosCache
    } = require('../../snapshot-cache');
    bypassProjetosCache(userId, 30000);
    invalidateUserCaches(userId, { projetos: true });
    return {
      tipo,
      ok: true,
      refreshed: true,
      note: 'Cache de projetos/assist limpo — próximo turno busca fresco.'
    };
  }

  if (tipo === 'ops_flag_list' || tipo === 'ops_flag_get' || tipo === 'ops_flag_set') {
    const { isPlanoOwnerUserId } = requireLib('plano-owner');
    if (!(await isPlanoOwnerUserId(userId))) {
      return { tipo, ok: false, erro: 'Ops flags só pro dono' };
    }
    const flags = require('../../ops/flags/service');
    const project = acao.project || acao.projeto || acao.project_id;
    if (tipo === 'ops_flag_list') {
      const out = await flags.listProjectFlags(userId, project);
      return { tipo, ...out };
    }
    if (tipo === 'ops_flag_get') {
      const out = await flags.getProjectFlag(
        userId,
        project,
        acao.key || acao.flag || acao.flag_key
      );
      return { tipo, ...out };
    }
    const enabledRaw = acao.enabled;
    let want;
    if (enabledRaw === undefined || enabledRaw === null) {
      const hint = String(acao.acao || acao.action || acao.mode || '').toLowerCase();
      if (/liga|ativ|enable|on\b|retom|volta/.test(hint)) want = true;
      else want = false;
    } else {
      want = !(
        enabledRaw === false ||
        enabledRaw === 'false' ||
        enabledRaw === 0 ||
        enabledRaw === '0'
      );
    }
    const out = await flags.setProjectFlag(
      userId,
      project,
      acao.key || acao.flag || acao.flag_key,
      want,
      acao.note || acao.nota || null
    );
    if (out.ok) {
      try {
        const { bypassProjetosCache, invalidateUserCaches } = require('../../snapshot-cache');
        bypassProjetosCache(userId, 60000);
        invalidateUserCaches(userId, { projetos: true });
      } catch {
        /* ignore */
      }
    }
    return { tipo, ...out };
  }

  return null;
}

module.exports = { TYPES, handle, parseViews, avisoVarredura, _setVarreduraTiming };
