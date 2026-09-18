/**
 * JARVIS Tool Registry — catalog (Phase 3).
 * Metadata only: handlers still live in routes/ia.js until gradual extract.
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
    description: 'Busca assinantes CineRush'
  },
  cinerush_provisionar: {
    risk: 'high',
    timeoutMs: 30000,
    ownerOnly: true,
    mutatesProjetos: true,
    description: 'Provisiona assinante CineRush já pendente (não cria cadastro novo)'
  },
  cinerush_criar: {
    risk: 'high',
    timeoutMs: 120000,
    ownerOnly: true,
    mutatesProjetos: true,
    description: 'Cria acesso manual CineRush (Havok + DB). Body: email, nome?, plano?'
  },
  cinerush_reenviar_email: {
    risk: 'high',
    timeoutMs: 30000,
    ownerOnly: true,
    mutatesProjetos: true,
    description: 'Reenvia e-mail de acesso CineRush'
  },
  chatwoot_listar: {
    risk: 'low',
    timeoutMs: 20000,
    ownerOnly: true,
    description: 'Lista conversas Chatwoot'
  },
  chatwoot_resolver: {
    risk: 'medium',
    timeoutMs: 20000,
    ownerOnly: true,
    mutatesProjetos: true,
    description: 'Resolve conversa Chatwoot'
  },
  chatwoot_atribuir: {
    risk: 'medium',
    timeoutMs: 20000,
    ownerOnly: true,
    mutatesProjetos: true,
    description: 'Atribui conversa Chatwoot'
  },

  // —— Attracione (owner) ——
  attracione_coleta: {
    risk: 'high',
    timeoutMs: 60000,
    ownerOnly: true,
    mutatesProjetos: true,
    description: 'Dispara coleta Attracione'
  },
  attracione_backup: {
    risk: 'high',
    timeoutMs: 90000,
    ownerOnly: true,
    mutatesProjetos: true,
    description: 'Dispara backup Attracione'
  },
  attracione_ranking: {
    risk: 'low',
    timeoutMs: 20000,
    ownerOnly: true,
    description: 'Ranking competição Attracione'
  },

  // —— SocialHub (owner) ——
  socialhub_posts: {
    risk: 'low',
    timeoutMs: 20000,
    ownerOnly: true,
    description: 'Lista posts SocialHub'
  },
  socialhub_agendar: {
    risk: 'high',
    timeoutMs: 30000,
    ownerOnly: true,
    mutatesProjetos: true,
    description: 'Agenda post SocialHub'
  },
  socialhub_publicar_agendados: {
    risk: 'high',
    timeoutMs: 60000,
    ownerOnly: true,
    mutatesProjetos: true,
    description: 'Publica posts agendados SocialHub'
  },

  // —— Clipper (owner) ——
  clipper_criar: {
    risk: 'high',
    timeoutMs: 45000,
    ownerOnly: true,
    mutatesProjetos: true,
    description: 'Cria clip Vortex'
  },
  clipper_retry: {
    risk: 'medium',
    timeoutMs: 45000,
    ownerOnly: true,
    mutatesProjetos: true,
    description: 'Retry clip Vortex'
  },

  // —— CineRush Editor (owner) ——
  cinerush_editor_process: {
    risk: 'high',
    timeoutMs: 45000,
    ownerOnly: true,
    mutatesProjetos: true,
    description: 'Enfileira 1 corte no CineRush Editor (ops)'
  },
  cinerush_editor_batch: {
    risk: 'high',
    timeoutMs: 60000,
    ownerOnly: true,
    mutatesProjetos: true,
    description: 'Enfileira batch de cortes no CineRush Editor'
  },
  cinerush_editor_job_status: {
    risk: 'low',
    timeoutMs: 15000,
    ownerOnly: true,
    description: 'Status de job ou batch do CineRush Editor'
  },

  // —— Memória de projetos ——
  project_memory_get: {
    risk: 'low',
    timeoutMs: 8000,
    description: 'Lê memória persistente de um projeto (stack, status, decisões)'
  },
  project_memory_set: {
    risk: 'low',
    timeoutMs: 8000,
    description: 'Grava/atualiza memória de projeto (stack, objetivo, status, nota, falha)'
  },
  project_memory_list: {
    risk: 'low',
    timeoutMs: 8000,
    description: 'Lista projetos com memória salva'
  },
  project_info: {
    risk: 'low',
    timeoutMs: 8000,
    description: 'Ficha completa de um projeto do ecossistema R:/Projetos (brief + stack + wired)'
  },

  // —— Cutflix ——
  cutflix_status: {
    risk: 'low',
    timeoutMs: 10000,
    ownerOnly: true,
    description: 'Health check da API Cutflix (CUTFLIX_API_URL)'
  },

  projeto_milhao_fechamento: {
    risk: 'low',
    timeoutMs: 12000,
    ownerOnly: true,
    description: 'Fechamento Projeto Milhão (ontem ou ymd) — Mateus/Erik meta 30'
  },

  snapshot_refresh: {
    risk: 'low',
    timeoutMs: 5000,
    mutatesProjetos: true,
    description: 'Invalida cache de snapshots (projetos + assist) pra ler dados frescos'
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
