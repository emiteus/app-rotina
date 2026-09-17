/**
 * Mission planner + runner (Phase 7) — single-agent, tool-backed steps.
 */
const {
  createMission,
  getActiveMission,
  getMission,
  updateMission,
  cancelMission,
  listMissions
} = require('./store');

/**
 * Heuristic plan from natural language goal (no extra LLM roundtrip).
 * @returns {{ description: string, tipo: string|null, args: object }[]}
 */
function planFromGoal(goal) {
  const g = String(goal || '').trim();
  const steps = [];

  if (/sincroniz.*banco|pluggy|extrato/i.test(g)) {
    steps.push({
      description: 'Sincronizar bancos (Open Finance)',
      tipo: 'sincronizar_bancos',
      args: { tipo: 'sincronizar_bancos' }
    });
  }
  if (/reconcili/i.test(g)) {
    steps.push({
      description: 'Reconciliar despesas com extrato',
      tipo: 'reconciliar_despesas',
      args: { tipo: 'reconciliar_despesas' }
    });
  }
  if (/coleta|attracione/i.test(g)) {
    steps.push({
      description: 'Disparar coleta Attracione',
      tipo: 'attracione_coleta',
      args: { tipo: 'attracione_coleta' }
    });
  }
  if (/backup.*attracione|attracione.*backup/i.test(g)) {
    steps.push({
      description: 'Backup Attracione',
      tipo: 'attracione_backup',
      args: { tipo: 'attracione_backup' }
    });
  }
  if (/publicar.*agend|socialhub.*public/i.test(g)) {
    steps.push({
      description: 'Publicar posts agendados SocialHub',
      tipo: 'socialhub_publicar_agendados',
      args: { tipo: 'socialhub_publicar_agendados' }
    });
  }
  if (/academia|h[aá]bito/i.test(g) && /marcar|check/i.test(g)) {
    steps.push({
      description: 'Marcar Academia',
      tipo: 'marcar_habito',
      args: { tipo: 'marcar_habito', titulo: 'Academia' }
    });
  }

  if (!steps.length) {
    steps.push({
      description: `Objetivo livre: ${g.slice(0, 120)}`,
      tipo: null,
      args: { tipo: null, note: g }
    });
  }
  return steps;
}

/**
 * Parse mission-related user commands.
 * @returns {null | { cmd: string, goal?: string, id?: string }}
 */
function parseMissionCommand(mensagem) {
  const t = String(mensagem || '').trim();

  let m = t.match(/^(?:miss[aã]o|plano|mission)\s*[:\-]\s*(.+)$/i);
  if (m) return { cmd: 'create', goal: m[1].trim() };

  m = t.match(/^(?:cria|criar|abre|abrir)\s+(?:uma\s+)?(?:miss[aã]o|plano)\s+(?:pra|para|de|:)\s*(.+)$/i);
  if (m) return { cmd: 'create', goal: m[1].trim() };

  if (/^(status\s+miss[aã]o|miss[aã]o\s+status|qual\s+miss[aã]o)\s*[?.!]*$/i.test(t)) {
    return { cmd: 'status' };
  }
  if (/^(lista|listar)\s+miss[oõ]es\s*[?.!]*$/i.test(t)) {
    return { cmd: 'list' };
  }
  if (/^(cancela|cancelar|aborta)\s+(a\s+)?miss[aã]o(?:\s+([a-f0-9]{6,12}))?\s*[!.]*$/i.test(t)) {
    const id = t.match(/([a-f0-9]{6,12})\s*$/i);
    return { cmd: 'cancel', id: id ? id[1] : null };
  }
  if (/^(pr[oó]ximo\s+passo|continua\s+miss[aã]o|seguir\s+miss[aã]o|roda\s+miss[aã]o)\s*[!.]*$/i.test(t)) {
    return { cmd: 'advance' };
  }
  return null;
}

function formatMission(mission) {
  if (!mission) return 'Nenhuma missão ativa.';
  const steps = (mission.steps || [])
    .map((s, i) => {
      const mark =
        s.status === 'done' ? '✓' : s.status === 'failed' ? '✗' : i === mission.currentStep ? '→' : '·';
      return `${mark} ${i + 1}. ${s.description || s.tipo || '?'}${s.tipo ? ` (\`${s.tipo}\`)` : ''}`;
    })
    .join('\n');
  return (
    `Missão **${mission.id}** — **${mission.status}**\n` +
    `Objetivo: ${mission.goal}\n` +
    `${steps}\n` +
    (mission.status === 'planned' || mission.status === 'running'
      ? '\nManda **próximo passo** pra executar o próximo (ações high-risk pedem SIM).'
      : '')
  );
}

/**
 * Create mission from goal.
 */
async function startMission(userId, goal) {
  const steps = planFromGoal(goal);
  return createMission(userId, goal, steps);
}

/**
 * Execute next pending tool step.
 * @param {function} executeAcoes (acoes, userId) => Promise<results>
 */
async function advanceMission(userId, executeAcoes, missionId = null) {
  const mission = missionId
    ? await getMission(missionId, userId)
    : await getActiveMission(userId);
  if (!mission) {
    return { ok: false, resposta: 'Não há missão ativa. Crie com: missão: …' };
  }
  if (['done', 'cancelled', 'failed'].includes(mission.status)) {
    return { ok: false, resposta: formatMission(mission) };
  }

  const steps = [...mission.steps];
  let idx = steps.findIndex((s) => s.status === 'pending');
  if (idx < 0) {
    await updateMission(mission.id, userId, { status: 'done', currentStep: steps.length });
    return {
      ok: true,
      resposta: `Missão **${mission.id}** concluída.`,
      mission: await getMission(mission.id, userId),
      acoes: []
    };
  }

  const step = steps[idx];
  await updateMission(mission.id, userId, { status: 'running', currentStep: idx });

  if (!step.tipo) {
    steps[idx] = {
      ...step,
      status: 'done',
      result: { note: 'Passo informativo — sem tool automática. Faça manualmente ou refine a missão.' }
    };
    const more = steps.some((s) => s.status === 'pending');
    await updateMission(mission.id, userId, {
      steps,
      status: more ? 'planned' : 'done',
      currentStep: more ? idx + 1 : steps.length
    });
    return {
      ok: true,
      resposta:
        `Passo ${idx + 1} é livre (sem tool): ${step.description}\n\n` +
        formatMission(await getMission(mission.id, userId)),
      acoes: [],
      mission: await getMission(mission.id, userId)
    };
  }

  const acao = { tipo: step.tipo, ...(step.args || {}) };
  delete acao.description;
  const acoes = await executeAcoes([acao], userId);
  const done = acoes[0];

  if (done && done.pending_approval) {
    steps[idx] = { ...step, status: 'waiting_approval', result: done };
    await updateMission(mission.id, userId, {
      steps,
      status: 'waiting_approval',
      currentStep: idx
    });
    return {
      ok: true,
      resposta:
        `Missão **${mission.id}** passo ${idx + 1} precisa de confirmação.\n` +
        `Responde **SIM** / **NÃO**, depois **próximo passo**.`,
      acoes,
      mission: await getMission(mission.id, userId)
    };
  }

  if (done && done.ok) {
    steps[idx] = { ...step, status: 'done', result: done };
    const more = steps.some((s) => s.status === 'pending');
    await updateMission(mission.id, userId, {
      steps,
      status: more ? 'planned' : 'done',
      currentStep: more ? idx + 1 : steps.length,
      result: more ? null : { ok: true }
    });
    return {
      ok: true,
      resposta: `Passo ${idx + 1} ok (**${step.tipo}**).\n\n` + formatMission(await getMission(mission.id, userId)),
      acoes,
      mission: await getMission(mission.id, userId)
    };
  }

  steps[idx] = { ...step, status: 'failed', result: done };
  await updateMission(mission.id, userId, {
    steps,
    status: 'failed',
    currentStep: idx,
    result: done
  });
  return {
    ok: false,
    resposta: `Passo ${idx + 1} falhou: ${(done && done.erro) || 'erro'}\n\n` + formatMission(await getMission(mission.id, userId)),
    acoes,
    mission: await getMission(mission.id, userId)
  };
}

/**
 * Handle mission command inside chat turn.
 */
async function tryHandleMissionCommand(userId, mensagem, executeAcoes) {
  const parsed = parseMissionCommand(mensagem);
  if (!parsed) return null;

  if (parsed.cmd === 'create') {
    const m = await startMission(userId, parsed.goal);
    return {
      handled: true,
      resposta: `Missão criada.\n\n${formatMission(m)}`,
      acoes: [],
      provider: 'mission'
    };
  }
  if (parsed.cmd === 'status') {
    const m = await getActiveMission(userId);
    return { handled: true, resposta: formatMission(m), acoes: [], provider: 'mission' };
  }
  if (parsed.cmd === 'list') {
    const list = await listMissions(userId, 5);
    if (!list.length) {
      return { handled: true, resposta: 'Nenhuma missão ainda.', acoes: [], provider: 'mission' };
    }
    const txt = list
      .map((m) => `• **${m.id}** [${m.status}] ${m.goal.slice(0, 60)}`)
      .join('\n');
    return { handled: true, resposta: txt, acoes: [], provider: 'mission' };
  }
  if (parsed.cmd === 'cancel') {
    const m = parsed.id
      ? await getMission(parsed.id, userId)
      : await getActiveMission(userId);
    if (!m) {
      return { handled: true, resposta: 'Nada pra cancelar.', acoes: [], provider: 'mission' };
    }
    await cancelMission(m.id, userId);
    return {
      handled: true,
      resposta: `Missão **${m.id}** cancelada.`,
      acoes: [],
      provider: 'mission'
    };
  }
  if (parsed.cmd === 'advance') {
    const out = await advanceMission(userId, executeAcoes, parsed.id || null);
    return {
      handled: true,
      resposta: out.resposta,
      acoes: out.acoes || [],
      provider: 'mission'
    };
  }
  return null;
}

module.exports = {
  planFromGoal,
  parseMissionCommand,
  formatMission,
  startMission,
  advanceMission,
  tryHandleMissionCommand,
  getActiveMission,
  listMissions
};
