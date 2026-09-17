const TYPES = new Set([
  'cinerush_buscar',
  'cinerush_provisionar',
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
  'clipper_criar',
  'clipper_retry'
]);

async function handle(acao, ctx) {
  const tipo = acao && acao.tipo;
  if (!TYPES.has(tipo)) return null;

  const { userId } = ctx;

  if (
    tipo === 'cinerush_buscar' ||
    tipo === 'cinerush_provisionar' ||
    tipo === 'cinerush_reenviar_email'
  ) {
    const { isPlanoOwnerUserId } = require('../../../plano-owner');
    if (!(await isPlanoOwnerUserId(userId))) {
      return { tipo, ok: false, erro: 'CineRush só pro dono' };
    }
    const cr = require('../../../cinerush');
    if (!cr.cinerushReady()) {
      return { tipo, ok: false, erro: 'CineRush não configurado' };
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
        const found = await cr.buscarAssinantes(acao.search || acao.email || acao.nome, 'pendente');
        const hit = (found.data || [])[0];
        if (!hit) {
          return { tipo, ok: false, erro: 'Assinante pendente não encontrado' };
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
    const { isPlanoOwnerUserId } = require('../../../plano-owner');
    if (!(await isPlanoOwnerUserId(userId))) {
      return { tipo, ok: false, erro: 'Chatwoot só pro dono' };
    }
    const cr = require('../../../cinerush');
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
    const { isPlanoOwnerUserId } = require('../../../plano-owner');
    if (!(await isPlanoOwnerUserId(userId))) {
      return { tipo, ok: false, erro: 'Attracione só pro dono' };
    }
    const at = require('../../../attracione');
    if (!at.attracioneReady()) {
      return { tipo, ok: false, erro: 'Attracione não configurado' };
    }
    if (tipo === 'attracione_coleta') {
      const out = await at.dispararColeta(acao.plataforma || undefined);
      return { tipo, ok: true, resultado: out };
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
        premio: l.valor
      }))
    };
  }

  if (
    tipo === 'socialhub_posts' ||
    tipo === 'socialhub_agendar' ||
    tipo === 'socialhub_publicar_agendados'
  ) {
    const { isPlanoOwnerUserId } = require('../../../plano-owner');
    if (!(await isPlanoOwnerUserId(userId))) {
      return { tipo, ok: false, erro: 'SocialHub só pro dono' };
    }
    const sh = require('../../../socialhub');
    if (!sh.socialhubReady()) {
      return { tipo, ok: false, erro: 'SocialHub não configurado' };
    }
    if (tipo === 'socialhub_posts') {
      const out = await sh.listarPosts(acao.status || undefined, acao.limit || 10);
      return { tipo, ok: true, itens: out.posts || [] };
    }
    if (tipo === 'socialhub_agendar') {
      const out = await sh.agendarPost({
        caption: acao.caption,
        socialAccountIds: acao.socialAccountIds || acao.accountIds,
        scheduledAt: acao.scheduledAt,
        mediaUrls: acao.mediaUrls,
        mediaType: acao.mediaType
      });
      return {
        tipo,
        ok: true,
        id: out.post?.id,
        scheduledAt: out.post?.scheduledAt
      };
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
    const { isPlanoOwnerUserId } = require('../../../plano-owner');
    if (!(await isPlanoOwnerUserId(userId))) {
      return { tipo, ok: false, erro: 'Clipper só pro dono' };
    }
    const cl = require('../../../clipper');
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

  return null;
}

module.exports = { TYPES, handle };
