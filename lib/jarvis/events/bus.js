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
        text: `Aprovação pendente **${pending.id}**: ${pending.summary}`
      });
    }
  } catch (_) { /* ignore */ }

  try {
    const mission = await getActiveMission(userId);
    if (mission && ['planned', 'waiting_approval', 'paused'].includes(mission.status)) {
      notes.push({
        level: 'info',
        type: 'mission_active',
        text: `Missão **${mission.id}** ainda ${mission.status}: ${mission.goal.slice(0, 60)}`
      });
    }
  } catch (_) { /* ignore */ }

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
 * Notify owner via WhatsApp if Evolution ready and whitelist set.
 */
async function notifyOwnerWhatsApp(text) {
  if (process.env.JARVIS_PROACTIVE_WA === '0') return { skipped: true };
  const { evolutionReady, sendText, phonesAllowed } = require('../../evolution');
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
  notifyOwnerWhatsApp
};
