/**
 * Snapshot → prompt pack (Phase 4 + registry Phase 6).
 */
const { detectIntent } = require('./intent');
const { getRegistryStatus } = require('../projects/registry');
const { ecosystemLite, getProjectKnowledge } = require('../projects/knowledge');

/** Sempre no pack — conexão real, não só o hint da frase. */
const PROJETOS_PACK_KEYS = [
  'cinerush',
  'cinerush_editor',
  'attracione',
  'socialhub',
  'clipper',
  'projeto_milhao',
  'cutflix'
];

function slimProjetos(projetos, hints) {
  if (!projetos || typeof projetos !== 'object') return null;
  // Hints primeiro (prioridade de detalhe), mas nunca corta o set wired.
  const keys = [...new Set([...(hints || []).filter(Boolean), ...PROJETOS_PACK_KEYS])];
  const out = {};
  for (const k of keys) {
    const p = projetos[k];
    if (!p) continue;
    if (p.conectado === false) {
      out[k] = {
        conectado: false,
        motivo: p.motivo || p.erro || null,
        projeto: p.projeto || null
      };
      continue;
    }
    const copy = { ...p };
    if (Array.isArray(copy.chart_7d) && copy.chart_7d.length > 7) {
      copy.chart_7d = copy.chart_7d.slice(-7);
    }
    if (Array.isArray(copy.ranking) && copy.ranking.length > 10) {
      copy.ranking = copy.ranking.slice(0, 10);
    }
    if (copy.ranking?.top && Array.isArray(copy.ranking.top) && copy.ranking.top.length > 12) {
      copy.ranking = { ...copy.ranking, top: copy.ranking.top.slice(0, 12) };
    }
    if (copy.hoje?.por_pessoa && Array.isArray(copy.hoje.por_pessoa) && copy.hoje.por_pessoa.length > 15) {
      copy.hoje = { ...copy.hoje, por_pessoa: copy.hoje.por_pessoa.slice(0, 15) };
    }
    if (copy.hoje?.por_conta && Array.isArray(copy.hoje.por_conta) && copy.hoje.por_conta.length > 12) {
      copy.hoje = { ...copy.hoje, por_conta: copy.hoje.por_conta.slice(0, 12) };
    }
    if (Array.isArray(copy.posts) && copy.posts.length > 8) {
      copy.posts = copy.posts.slice(0, 8);
    }
    out[k] = copy;
  }
  return out;
}

function registryLite() {
  return getRegistryStatus()
    .filter((p) => p.snapshotKey || p.id === 'approtina')
    .map((p) => ({
      id: p.id,
      name: p.name,
      conectado: p.conectado,
      aliases: p.aliases.slice(0, 4)
    }));
}

function packTasks(tarefas, mode) {
  if (!tarefas) return null;
  if (mode === 'mini') {
    return {
      hoje: {
        total: tarefas.hoje?.total,
        concluidas: tarefas.hoje?.concluidas,
        pendentes: (tarefas.hoje?.itens || [])
          .filter((t) => !t.concluida)
          .slice(0, 8)
          .map((t) => t.titulo)
      },
      atrasadas_qtd: (tarefas.atrasadas || []).length,
      stats_7d: tarefas.stats_7d,
      streak_dias_completos: tarefas.streak_dias_completos
    };
  }
  return {
    ...tarefas,
    hoje: {
      ...tarefas.hoje,
      itens: (tarefas.hoje?.itens || []).slice(0, 20)
    },
    amanha: (tarefas.amanha || []).slice(0, 10),
    proximos_dias: (tarefas.proximos_dias || []).slice(0, 12),
    atrasadas: (tarefas.atrasadas || []).slice(0, 10)
  };
}

function packFinance(snap, mode) {
  const fin = snap.financeiro;
  if (!fin) return null;
  if (mode === 'mini') {
    return {
      mes_atual: fin.mes_atual,
      d7: fin.d7,
      saldos_resumo: (fin.saldos_contas || []).map((s) => ({
        nome: s.nome,
        saldo: s.saldo
      }))
    };
  }
  return {
    ...fin,
    ultimas_transacoes: (fin.ultimas_transacoes || []).slice(0, 12),
    categorias: (fin.categorias || []).slice(0, 40),
    gastos_por_categoria_30d: (fin.gastos_por_categoria_30d || []).slice(0, 15)
  };
}

/**
 * @param {object} snap full lite snapshot
 * @param {string} mensagem
 * @param {object} [prefs]
 * @returns {{ pack: object, intent: object, stats: { charsFull: number, charsPack: number, savedPct: number } }}
 */
function packContext(snap, mensagem, prefs = {}, opts = {}) {
  const intent = detectIntent(mensagem);
  const needs = intent.needs;
  const pack = {
    agora: snap.agora,
    _ctx: { intent: intent.kind, packed: true },
    registry: registryLite(),
    ecossistema: ecosystemLite(24)
  };

  const notas = Array.isArray(prefs.extras?.notas) ? prefs.extras.notas.slice(0, 12) : [];
  if (notas.length) pack.memoria = { notas };
  if (prefs.extras?.tom) pack.prefs_tom = prefs.extras.tom;

  const projectMemories = Array.isArray(opts.projectMemories)
    ? opts.projectMemories
    : prefs.projectMemories;
  if (projectMemories && projectMemories.length) {
    pack.memoria_projetos = projectMemories;
  }

  if (opts.recallTemporal) {
    pack.recall_temporal = opts.recallTemporal;
  }
  if (opts.recallSemantico) {
    pack.recall_semantico = opts.recallSemantico;
  }

  // Detalhe do(s) projeto(s) citados na mensagem (além do registry wired)
  const mentioned = [];
  for (const id of intent.projectHints || []) {
    const k = getProjectKnowledge(id);
    if (k) {
      mentioned.push({
        id: k.id,
        folder: k.folder,
        wired: k.wired,
        stack: k.stack,
        summary: k.summary,
        structure: (k.structure || []).slice(0, 10),
        note: k.note
      });
    }
  }
  if (mentioned.length) pack.projeto_detalhe = mentioned;

  if (intent.kind === 'greeting') {
    pack.tarefas = packTasks(snap.tarefas, 'mini');
    pack.nota =
      'Cumprimento curto — não despeje status a menos que o usuário peça.';
    delete pack.memoria_projetos;
    delete pack.ecossistema;
    delete pack.projeto_detalhe;
  } else if (needs.full) {
    pack.tarefas = packTasks(snap.tarefas, 'full');
    pack.recorrentes = (snap.recorrentes || []).slice(0, 15);
    pack.financeiro = packFinance(snap, 'full');
    pack.despesas_mes = snap.despesas_mes;
    pack.receitas_mes = snap.receitas_mes;
    pack.plano_financeiro = snap.plano_financeiro;
    pack.metas = snap.metas;
    pack.alarmes = snap.alarmes;
    pack.habitos = snap.habitos;
    pack.eventos_proximos = (snap.eventos_proximos || []).slice(0, 12);
    pack.consistencia_horario = snap.consistencia_horario;
    pack.projetos = slimProjetos(snap.projetos, intent.projectHints);
  } else {
    if (needs.tasks) {
      pack.tarefas = packTasks(snap.tarefas, 'full');
      pack.recorrentes = (snap.recorrentes || []).slice(0, 12);
      pack.eventos_proximos = (snap.eventos_proximos || []).slice(0, 10);
      pack.alarmes = snap.alarmes;
    } else {
      pack.tarefas = packTasks(snap.tarefas, 'mini');
    }

    if (needs.habits) {
      pack.habitos = snap.habitos;
      pack.consistencia_horario = snap.consistencia_horario;
    }

    if (needs.finance) {
      pack.financeiro = packFinance(snap, 'full');
      pack.despesas_mes = snap.despesas_mes;
      pack.receitas_mes = snap.receitas_mes;
      pack.plano_financeiro = snap.plano_financeiro;
      pack.metas = snap.metas;
    } else {
      pack.financeiro = packFinance(snap, 'mini');
      pack.metas = (snap.metas || []).slice(0, 5);
    }

    if (needs.projects || (projectMemories && projectMemories.length)) {
      pack.projetos = slimProjetos(snap.projetos, intent.projectHints);
    } else if (snap.projetos) {
      pack.projetos = slimProjetos(snap.projetos, []);
    }

    // general: include a bit of everything compact
    if (intent.kind === 'general') {
      pack.habitos = snap.habitos;
      pack.despesas_mes = {
        resumo: snap.despesas_mes?.resumo,
        itens: (snap.despesas_mes?.itens || [])
          .filter((d) => d.status !== 'pago')
          .slice(0, 8)
      };
      pack.receitas_mes = {
        resumo: snap.receitas_mes?.resumo,
        itens: (snap.receitas_mes?.itens || []).slice(0, 8)
      };
    }
  }

  const charsFull = JSON.stringify(snap || {}).length;
  const charsPack = JSON.stringify(pack).length;
  const savedPct = charsFull > 0 ? Math.round((1 - charsPack / charsFull) * 100) : 0;

  return {
    pack,
    intent,
    stats: { charsFull, charsPack, savedPct }
  };
}

module.exports = {
  packContext,
  slimProjetos,
  detectIntent
};
