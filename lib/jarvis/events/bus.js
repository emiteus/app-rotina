/**
 * Event bus + proactive sweep (Phase 10).
 * Never auto-runs CRITICAL/HIGH tools — notify only.
 */
const listeners = new Map(); // event -> Set<fn>

function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event).delete(fn);
}

function emit(event, payload = {}) {
  const set = listeners.get(event);
  console.log(
    JSON.stringify({
      tag: 'jarvis.event',
      event,
      ...payload,
      at: new Date().toISOString()
    })
  );
  if (!set) return;
  for (const fn of set) {
    try {
      Promise.resolve(fn(payload)).catch((e) =>
        console.error('[jarvis.event] listener', event, e.message)
      );
    } catch (e) {
      console.error('[jarvis.event] listener sync', event, e.message);
    }
  }
}

/**
 * Lightweight health/proactive checks — returns notification texts (low risk).
 */
async function runProactiveSweep(userId) {
  const notes = [];
  const { getRegistryStatus } = require('../projects/registry');
  const { getPendingApproval } = require('../permissions/engine');
  const { getActiveMission } = require('../missions/planner');

  const projects = getRegistryStatus().filter((p) => p.snapshotKey);
  const offline = projects.filter((p) => !p.conectado);
  // Only nudge if previously expected connectors missing key envs partially configured
  for (const p of offline) {
    if (p.envRequired > 0 && p.envConfigured > 0 && p.envConfigured < p.envRequired) {
      notes.push({
        level: 'info',
        type: 'project_partial',
        text: `${p.name}: env parcial (${p.envConfigured}/${p.envRequired}) — conectado=off`
      });
    }
  }

  try {
    const pending = await getPendingApproval(userId);
    if (pending) {
      notes.push({
        level: 'warn',
        type: 'approval_pending',
        text: `Aprovação pendente **${pending.id}** [${pending.channel || '?'}]: ${pending.summary}`
      });
    }
  } catch (_) { /* ignore */ }

  try {
    const mission = await getActiveMission(userId);
    if (mission && ['planned', 'waiting_approval', 'paused', 'running'].includes(mission.status)) {
      notes.push({
        level: mission.status === 'waiting_approval' ? 'warn' : 'info',
        type: 'mission_active',
        text: `Missão **${mission.id}** ainda ${mission.status}: ${mission.goal.slice(0, 60)}`
      });
    }
    if (mission && mission.status === 'failed') {
      const failStep = (mission.steps || []).find((s) => s.status === 'failed');
      const err =
        failStep && failStep.result
          ? String(failStep.result.erro || failStep.result.error || '').slice(0, 80)
          : '';
      notes.push({
        level: 'warn',
        type: 'mission_failed',
        text:
          `Missão **${mission.id}** falhou` +
          (err ? `: ${err}` : '') +
          ` — manda **retry passo** ou **cancela missão**.`
      });
    }
  } catch (_) { /* ignore */ }

  // Ops alerts (Editor fila / Havok / Attracione) — dedupe no ops-watch
  try {
    const { checkOpsHealth } = require('../ops/ops-watch');
    const opsNotes = await checkOpsHealth(userId);
    for (const n of opsNotes) notes.push(n);
  } catch (e) {
    console.error('[proactive] ops:', e.message);
  }

  // Railway deploy FAIL/CRASH (notify only — nunca redeploy automático)
  try {
    const { checkRailwayDeployHealth } = require('../ops/railway-watch');
    const railwayNotes = await checkRailwayDeployHealth(userId);
    for (const n of railwayNotes) notes.push(n);
  } catch (e) {
    console.error('[proactive] railway:', e.message);
  }

  emit('proactive.sweep', { userId, notes: notes.length });
  return notes;
}

/**
 * Format notes for WhatsApp/Web — never executes tools.
 */
function formatProactiveNotes(notes) {
  if (!notes || !notes.length) return null;
  const lines = notes.map((n) => `• ${n.text}`);
  return `Jarvis (proativo — só aviso, sem ação automática):\n${lines.join('\n')}`;
}

/**
 * Ping WA só com notes level=warn. Nunca executa tools.
 */
async function notifyWarnNotes(notes, { source = 'sweep' } = {}) {
  const warns = (notes || []).filter((n) => n && n.level === 'warn');
  if (!warns.length) return { skipped: true, reason: 'no_warns', count: 0 };
  const text = formatProactiveNotes(warns);
  if (!text) return { skipped: true, reason: 'empty', count: 0 };
  const result = await notifyOwnerWhatsApp(text);
  emit('proactive.warn_notify', {
    source,
    count: warns.length,
    ok: !!(result && result.ok),
    skipped: !!(result && result.skipped)
  });
  return { ...result, count: warns.length, text, types: warns.map((w) => w.type) };
}

/** Cron 15min — só Railway FAIL/CRASH. */
async function runRailwayWatchNotify(userId) {
  if (process.env.JARVIS_RAILWAY_WATCH === '0') {
    return { skipped: true, reason: 'disabled' };
  }
  const notes = await require('../ops/railway-watch').checkRailwayDeployHealth(userId);
  return notifyWarnNotes(notes, { source: 'railway' });
}

/** Cron 30min — Editor fila / Havok / Attracione. */
async function runOpsWatchNotify(userId) {
  if (process.env.JARVIS_OPS_WATCH === '0') {
    return { skipped: true, reason: 'disabled' };
  }
  const notes = await require('../ops/ops-watch').checkOpsHealth(userId);
  return notifyWarnNotes(notes, { source: 'ops' });
}

/**
 * Notify owner via WhatsApp if Evolution ready and whitelist set.
 */
async function notifyOwnerWhatsApp(text) {
  if (process.env.JARVIS_PROACTIVE_WA === '0') return { skipped: true };
  const { evolutionReady, sendText, phonesAllowed } = require('../host').requireLib(
    'evolution'
  );
  if (!evolutionReady()) return { skipped: true, reason: 'evolution' };
  const phones = phonesAllowed();
  if (!phones.length) return { skipped: true, reason: 'no_phones' };
  const body = String(text || '').slice(0, 1500);
  if (!body) return { skipped: true };
  await sendText(phones[0], body);
  emit('proactive.notify', { channel: 'whatsapp', phone: phones[0] });
  return { ok: true };
}

module.exports = {
  on,
  emit,
  runProactiveSweep,
  formatProactiveNotes,
  notifyOwnerWhatsApp,
  notifyWarnNotes,
  runRailwayWatchNotify,
  runOpsWatchNotify,
  checkRailwayDeployHealth: (...args) =>
    require('../ops/railway-watch').checkRailwayDeployHealth(...args),
  checkOpsHealth: (...args) => require('../ops/ops-watch').checkOpsHealth(...args)
};
