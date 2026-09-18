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
  const { getRegistryStatus, loadAllProjectSnapshots } = require('../projects/registry');
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

  // Ops alerts from live snapshots (Attracione / CineRush)
  try {
    const snaps = await loadAllProjectSnapshots();
    const at = snaps && snaps.attracione;
    if (at && at.conectado) {
      if (at.operacao?.backup_atrasado) {
        notes.push({
          level: 'warn',
          type: 'attracione_backup',
          text: 'Attracione: **backup atrasado** — vale rodar backup manual.'
        });
      }
      const contas = at.operacao?.contas_com_problema || [];
      if (contas.length) {
        const nomes = contas
          .slice(0, 3)
          .map((c) => c.quem || c.conta)
          .join(', ');
        notes.push({
          level: 'warn',
          type: 'attracione_contas',
          text: `Attracione: ${contas.length} conta(s) com problema (${nomes}).`
        });
      }
      const quebradas = at.operacao?.plataformas_quebradas || [];
      if (quebradas.length) {
        notes.push({
          level: 'warn',
          type: 'attracione_plataformas',
          text: `Attracione: plataforma(s) quebrada(s): ${quebradas.slice(0, 4).join(', ')}.`
        });
      }
    }
    const cr = snaps && snaps.cinerush;
    if (cr && cr.conectado) {
      const credits = cr.havok?.credits;
      if (typeof credits === 'number' && credits >= 0 && credits < 50) {
        notes.push({
          level: 'warn',
          type: 'cinerush_credits',
          text: `CineRush Havok: só **${credits}** crédito(s) restantes.`
        });
      }
      const pend = cr.assinantes?.pendentes;
      if (typeof pend === 'number' && pend > 0) {
        notes.push({
          level: 'info',
          type: 'cinerush_pendentes',
          text: `CineRush: **${pend}** assinante(s) pendente(s) de provision.`
        });
      }
    }
  } catch (e) {
    console.error('[proactive] snapshots:', e.message);
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
  notifyOwnerWhatsApp
};
