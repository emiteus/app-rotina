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
  'clipper_criar',
  'clipper_retry',
  'cinerush_editor_process',
  'cinerush_editor_batch',
  'cinerush_editor_job_status',
  'cutflix_status',
  'projeto_milhao_fechamento',
  'snapshot_refresh',
  'ops_flag_list',
  'ops_flag_get',
  'ops_flag_set'
]);

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
    tipo === 'socialhub_publicar_agendados'
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

  if (
    tipo === 'cinerush_editor_process' ||
    tipo === 'cinerush_editor_batch' ||
    tipo === 'cinerush_editor_job_status'
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
      return { tipo, ok: false, erro: 'job_id ou batch_id obrigatório' };
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

module.exports = { TYPES, handle };
