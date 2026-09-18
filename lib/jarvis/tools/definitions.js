/**
 * JARVIS Tool Registry — catalog (Phase 3).
 * Descriptions are the contract the LLM sees (via toolsPromptBlock).
 *
 * risk: low | medium | high | critical
 * ownerOnly: requires plano owner (projetos)
 * mutatesProjetos: invalidate snapshot cache after ok
 */

/** @typedef {'low'|'medium'|'high'|'critical'} RiskLevel */

/** @type {Record<string, {
 *   risk: RiskLevel,
 *   timeoutMs: number,
 *   ownerOnly?: boolean,
 *   mutatesProjetos?: boolean,
 *   description: string
 * }>} */
const TOOL_DEFS = {
  // —— Rotina / financeiro ——
  criar_despesa: {
    risk: 'medium',
    timeoutMs: 15000,
    description: 'Cria despesa recorrente/esperada'
  },
  criar_tarefa: {
    risk: 'low',
    timeoutMs: 10000,
    description: 'Cria tarefa do dia'
  },
  criar_meta: {
    risk: 'medium',
    timeoutMs: 10000,
    description: 'Cria meta financeira'
  },
  marcar_habito: {
    risk: 'low',
    timeoutMs: 10000,
    description: 'Check-in de hábito (ex.: Academia)'
  },
  criar_categoria: {
    risk: 'medium',
    timeoutMs: 10000,
    description: 'Cria categoria financeira'
  },
  recategorizar: {
    risk: 'high',
    timeoutMs: 25000,
    description: 'Recategoriza transações (pode afetar muitas linhas)'
  },
  renomear_categoria: {
    risk: 'medium',
    timeoutMs: 15000,
    description: 'Renomeia categoria'
  },
  fundir_categorias: {
    risk: 'high',
    timeoutMs: 25000,
    description: 'Fundir/unificar categorias'
  },
  confirmar_despesa: {
    risk: 'medium',
    timeoutMs: 15000,
    description: 'Confirma pagamento de despesa'
  },
  confirmar_receita: {
    risk: 'medium',
    timeoutMs: 15000,
    description: 'Confirma recebimento de receita'
  },
  criar_receita: {
    risk: 'medium',
    timeoutMs: 15000,
    description: 'Cria receita'
  },
  depositar_meta: {
    risk: 'medium',
    timeoutMs: 15000,
    description: 'Deposita valor em meta'
  },
  concluir_tarefa: {
    risk: 'low',
    timeoutMs: 10000,
    description: 'Marca tarefa como feita'
  },
  criar_evento: {
    risk: 'low',
    timeoutMs: 10000,
    description: 'Cria evento na agenda'
  },
  criar_alarme: {
    risk: 'low',
    timeoutMs: 10000,
    description: 'Cria alarme'
  },
  criar_transacao: {
    risk: 'medium',
    timeoutMs: 15000,
    description: 'Cria lançamento financeiro avulso'
  },
  deletar_transacao: {
    risk: 'high',
    timeoutMs: 15000,
    description: 'Apaga lançamento financeiro'
  },
  corrigir_data_tx: {
    risk: 'medium',
    timeoutMs: 15000,
    description: 'Corrige data de transação'
  },
  marcar_das: {
    risk: 'medium',
    timeoutMs: 10000,
    description: 'Marca DAS MEI do mês'
  },
  reconciliar_despesas: {
    risk: 'medium',
    timeoutMs: 45000,
    description: 'Reconcilia despesas com extrato'
  },
  sincronizar_bancos: {
    risk: 'medium',
    timeoutMs: 60000,
    description: 'Sincroniza Open Finance / Pluggy'
  },

  // —— CineRush / Chatwoot (owner) ——
  cinerush_buscar: {
    risk: 'low',
    timeoutMs: 20000,
    ownerOnly: true,
    description: 'Busca assinantes CineRush TV (IPTV). Args: search (email/nome), status opcional.'
  },
  cinerush_provisionar: {
    risk: 'high',
    timeoutMs: 30000,
    ownerOnly: true,
    mutatesProjetos: true,
    description:
      'Provisiona assinante CineRush TV JÁ pendente (Havok). NÃO cria cadastro novo — pra acesso manual use cinerush_criar.'
  },
  cinerush_criar: {
    risk: 'high',
    timeoutMs: 120000,
    ownerOnly: true,
    mutatesProjetos: true,
    description:
      'Cria acesso manual CineRush TV (Havok+DB). Obrigatório: email real. Opcional: nome, plano (mensal|trimestral|…). Nunca invente email.'
  },
  cinerush_reenviar_email: {
    risk: 'high',
    timeoutMs: 30000,
    ownerOnly: true,
    mutatesProjetos: true,
    description: 'Reenvia e-mail de acesso CineRush TV. Args: id ou search (email).'
  },
  chatwoot_listar: {
    risk: 'low',
    timeoutMs: 20000,
    ownerOnly: true,
    description: 'Lista conversas Chatwoot do suporte CineRush. Args: status open|pending.'
  },
  chatwoot_resolver: {
    risk: 'medium',
    timeoutMs: 20000,
    ownerOnly: true,
    mutatesProjetos: true,
    description: 'Resolve conversa Chatwoot. Args: id.'
  },
  chatwoot_atribuir: {
    risk: 'medium',
    timeoutMs: 20000,
    ownerOnly: true,
    mutatesProjetos: true,
    description: 'Atribui conversa Chatwoot ao time. Args: id.'
  },

  // —— Attracione (owner) ——
  attracione_coleta: {
    risk: 'high',
    timeoutMs: 60000,
    ownerOnly: true,
    mutatesProjetos: true,
    description:
      'Dispara scraper Attracione (views/vídeos). NÃO use pra responder "quantos postamos" — isso já está em projetos.attracione.hoje. Só se pedirem coletar/raspar/atualizar dados. Args: plataforma tiktok|kwai opcional.'
  },
  attracione_backup: {
    risk: 'high',
    timeoutMs: 90000,
    ownerOnly: true,
    mutatesProjetos: true,
    description: 'Dispara backup manual Attracione.'
  },
  attracione_ranking: {
    risk: 'low',
    timeoutMs: 20000,
    ownerOnly: true,
    description:
      'Ranking de competição passada Attracione. Args: n (ex. "7"). Ranking atual já vem em projetos.attracione.ranking — só chame pra comps antigas.'
  },

  // —— SocialHub (owner) ——
  socialhub_posts: {
    risk: 'low',
    timeoutMs: 20000,
    ownerOnly: true,
    description:
      'Lista posts TeuHub/SocialHub. Contagem de hoje → preferir projetos.socialhub.hoje no snapshot. Args: status SCHEDULED|PUBLISHED|FAILED.'
  },
  socialhub_agendar: {
    risk: 'high',
    timeoutMs: 30000,
    ownerOnly: true,
    mutatesProjetos: true,
    description:
      'Agenda post no TeuHub. Args: caption, socialAccountIds[], scheduledAt ISO.'
  },
  socialhub_publicar_agendados: {
    risk: 'high',
    timeoutMs: 60000,
    ownerOnly: true,
    mutatesProjetos: true,
    description: 'Publica agora os posts SCHEDULED no TeuHub (cron publish).'
  },

  // —— Clipper (owner) ——
  clipper_criar: {
    risk: 'high',
    timeoutMs: 45000,
    ownerOnly: true,
    mutatesProjetos: true,
    description:
      'Cria clip no Vortex Clipper (PC/túnel). Off sem CLIPPER_API_URL. Args: durationSeconds?, note?.'
  },
  clipper_retry: {
    risk: 'medium',
    timeoutMs: 45000,
    ownerOnly: true,
    mutatesProjetos: true,
    description: 'Retry de grupo de clip no Vortex. Args: id (groupId).'
  },

  // —— CineRush Editor (owner) ——
  cinerush_editor_process: {
    risk: 'high',
    timeoutMs: 45000,
    ownerOnly: true,
    mutatesProjetos: true,
    description:
      'Enfileira 1 corte no CineRush Editor (massa IG) — NÃO é CineRush TV. Args: url (YouTube), manual_headline?, clip_duration?.'
  },
  cinerush_editor_batch: {
    risk: 'high',
    timeoutMs: 60000,
    ownerOnly: true,
    mutatesProjetos: true,
    description: 'Batch de cortes no Editor. Args: items[{url, manual_headline?}].'
  },
  cinerush_editor_job_status: {
    risk: 'low',
    timeoutMs: 15000,
    ownerOnly: true,
    description:
      'Status de job/batch do Editor. Fila e posts IG de hoje também em projetos.cinerush_editor. Args: job_id ou batch_id.'
  },

  // —— Memória de projetos ——
  project_memory_get: {
    risk: 'low',
    timeoutMs: 8000,
    description: 'Lê memória persistente de um projeto (stack, status, decisões, ultima_falha).'
  },
  project_memory_set: {
    risk: 'low',
    timeoutMs: 8000,
    description:
      'Grava memória de projeto. Args: project + stack|objetivo|status|nota|decisao|ultima_falha|link.'
  },
  project_memory_list: {
    risk: 'low',
    timeoutMs: 8000,
    description: 'Lista projetos com memória salva.'
  },
  project_info: {
    risk: 'low',
    timeoutMs: 8000,
    description:
      'Ficha do ecossistema R:/Projetos (brief+stack+wired). Use quando perguntarem o que é X / se você conhece. Args: project id ou "all".'
  },

  // —— Cutflix ——
  cutflix_status: {
    risk: 'low',
    timeoutMs: 10000,
    ownerOnly: true,
    description:
      'Health da API Cutflix. Snapshot também em projetos.cutflix. Sem tools de write ainda.'
  },

  projeto_milhao_fechamento: {
    risk: 'low',
    timeoutMs: 12000,
    ownerOnly: true,
    description:
      'Fechamento Projeto Milhão (Mateus/Erik, meta 30). Default = ontem (turno 02h). Preferir projetos.projeto_milhao.fechamento no snapshot; tool se pedir outro ymd ou refresh. Args: ymd? YYYY-MM-DD.'
  },

  snapshot_refresh: {
    risk: 'low',
    timeoutMs: 5000,
    mutatesProjetos: true,
    description:
      'Invalida cache de projetos/assist. Use após coleta Attracione ou se o usuário pedir dados frescos / "atualiza o cache".'
  },

  // —— Dev/Ops (owner, read-only) ——
  dev_diagnose: {
    risk: 'low',
    timeoutMs: 20000,
    ownerOnly: true,
    description:
      'Diagnóstico Dev: registry + snapshot + ultima_falha + versão Jarvis. Args: project (approtina|cinerush|projeto_milhao|socialhub|attracione|jarvis|…). Use em "tá quebrado / debug / status do serviço".'
  },
  dev_git_status: {
    risk: 'low',
    timeoutMs: 15000,
    ownerOnly: true,
    description:
      'Git status/commits recentes (local PROJETOS_ROOT ou GitHub). Args: project. Precisa GITHUB_TOKEN se repo privado no Railway.'
  },
  dev_read_file: {
    risk: 'low',
    timeoutMs: 15000,
    ownerOnly: true,
    description:
      'Lê arquivo allowlist do projeto (sem .. / sem .env). Args: project, path (ex. src/index.js ou package.json).'
  },
  dev_railway_logs: {
    risk: 'low',
    timeoutMs: 25000,
    ownerOnly: true,
    description:
      'Últimas linhas de log / status do deploy Railway. Args: project ou service (app-rotina, projeto-milhao…). Precisa RAILWAY_TOKEN.'
  },

  // —— Research (owner) ——
  research_web_search: {
    risk: 'low',
    timeoutMs: 20000,
    ownerOnly: true,
    description:
      'Busca web (Brave/Serper se KEY setada; senão DuckDuckGo). Args: query, limit? (≤10). Devolve title/url/snippet.'
  },
  research_fetch_url: {
    risk: 'low',
    timeoutMs: 20000,
    ownerOnly: true,
    description:
      'Baixa URL allowlist (SSRF-safe), devolve texto limpo. Args: url, max_chars?. Allowlist em RESEARCH_FETCH_ALLOWLIST ou RESEARCH_FETCH_OPEN=1.'
  },
  research_write_report: {
    risk: 'medium',
    timeoutMs: 10000,
    ownerOnly: true,
    description:
      'Monta relatório markdown pro WA. Args: title, body? ou findings[]?, sources[]?, project? (salva preview na memória).'
  }
};

const RISK_ORDER = { low: 0, medium: 1, high: 2, critical: 3 };

function needsApproval(risk, threshold = 'high') {
  return RISK_ORDER[risk] >= RISK_ORDER[threshold];
}

module.exports = {
  TOOL_DEFS,
  RISK_ORDER,
  needsApproval,
  MAX_TOOLS_PER_TURN: 8,
  DEFAULT_TIMEOUT_MS: 30000
};
