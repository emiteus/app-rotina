/**
 * Ops proactive watch — editor fila + Havok credits + Attracione (notify only).
 * Dedupe by fingerprint so the same condition doesn't spam every cron.
 */
/** @type {Map<string, number>} */
const alerted = new Map();
const MAX_ALERTED = 120;
const DEDUPE_TTL_MS = 6 * 60 * 60 * 1000; // 6h same fingerprint

function remember(key) {
  const now = Date.now();
  for (const [k, ts] of alerted) {
    if (now - ts > DEDUPE_TTL_MS) alerted.delete(k);
  }
  if (alerted.has(key)) return false;
  alerted.set(key, now);
  if (alerted.size > MAX_ALERTED) {
    alerted.delete(alerted.keys().next().value);
  }
  return true;
}

function normalizeQueue(q) {
  if (q == null) return null;
  if (typeof q === 'number') return { waiting: q, active: 0, failed: 0 };
  if (typeof q === 'object') {
    return {
      waiting: Number(q.waiting ?? q.wait ?? q.pending ?? q.queued ?? 0) || 0,
      active: Number(q.active ?? q.processing ?? q.running ?? 0) || 0,
      failed: Number(q.failed ?? q.failures ?? q.dead ?? 0) || 0,
      delayed: Number(q.delayed ?? 0) || 0
    };
  }
  return null;
}

function havokThreshold() {
  const n = Number(process.env.JARVIS_HAVOK_CREDITS_WARN || 50);
  return Number.isFinite(n) && n >= 0 ? n : 50;
}

function editorQueueThreshold() {
  const n = Number(process.env.JARVIS_EDITOR_QUEUE_WARN || 8);
  return Number.isFinite(n) && n >= 0 ? n : 8;
}

/**
 * @returns {Promise<Array<{level, type, text}>>}
 */
async function checkOpsHealth(userId = null) {
  if (process.env.JARVIS_OPS_WATCH === '0') return [];

  const notes = [];
  const { loadAllProjectSnapshots } = require('../projects/registry');

  let snaps;
  try {
    snaps = await loadAllProjectSnapshots();
  } catch (e) {
    console.error('[ops-watch] snapshots:', e.message);
    return notes;
  }

  // —— CineRush Editor fila ——
  const ed = snaps && snaps.cinerush_editor;
  if (ed) {
    if (ed.conectado === false && process.env.CINERUSH_EDITOR_URL) {
      const key = `editor_down:${String(ed.motivo || ed.erro || 'off').slice(0, 40)}`;
      if (remember(key)) {
        notes.push({
          level: 'warn',
          type: 'editor_down',
          text:
            `CineRush Editor **off**: ${String(ed.motivo || ed.erro || 'sem conexão').slice(0, 100)}`
        });
      }
    } else if (ed.conectado) {
      const q = normalizeQueue(ed.queue);
      const thr = editorQueueThreshold();
      if (q && q.failed > 0) {
        const key = `editor_failed:${q.failed}`;
        if (remember(key)) {
          notes.push({
            level: 'warn',
            type: 'editor_queue_failed',
            text:
              `Editor: **${q.failed}** job(s) failed na fila` +
              (q.waiting ? ` (${q.waiting} waiting)` : '') +
              ' — confere `cinerush_editor_job_status`.'
          });
        }
      } else if (q && q.waiting >= thr) {
        const key = `editor_wait:${q.waiting}`;
        if (remember(key)) {
          notes.push({
            level: 'warn',
            type: 'editor_queue_backlog',
            text:
              `Editor: fila **${q.waiting}** waiting` +
              (q.active ? ` / ${q.active} active` : '') +
              ` (limite ${thr}).`
          });
        }
      }
    }
  }

  // —— CineRush TV Havok + pendentes ——
  const cr = snaps && snaps.cinerush;
  if (cr && cr.conectado) {
    const credits = cr.havok?.credits;
    const thr = havokThreshold();
    if (typeof credits === 'number' && credits >= 0 && credits < thr) {
      const band = credits < 10 ? 'critical_low' : credits < 25 ? 'low' : 'warn';
      const key = `havok:${band}:${credits}`;
      if (remember(key)) {
        notes.push({
          level: 'warn',
          type: 'cinerush_credits',
          text: `CineRush Havok: só **${credits}** crédito(s) (alerta < ${thr}).`
        });
      }
    }
    const pend = cr.assinantes?.pendentes;
    const pendThr = Number(process.env.JARVIS_CINERUSH_PEND_WARN || 3);
    if (typeof pend === 'number' && pend >= pendThr) {
      const key = `cinerush_pend:${pend}`;
      if (remember(key)) {
        notes.push({
          level: 'warn',
          type: 'cinerush_pendentes',
          text: `CineRush: **${pend}** assinante(s) pendente(s) de provision.`
        });
      }
    }
  }

  // —— Attracione ——
  const at = snaps && snaps.attracione;
  if (at && at.conectado) {
    if (at.operacao?.backup_atrasado) {
      if (remember('attracione_backup')) {
        notes.push({
          level: 'warn',
          type: 'attracione_backup',
          text: 'Attracione: **backup atrasado** — vale rodar backup manual.'
        });
      }
    }
    const contas = at.operacao?.contas_com_problema || [];
    if (contas.length) {
      const nomes = contas
        .slice(0, 3)
        .map((c) => c.quem || c.conta)
        .join(', ');
      if (remember(`attracione_contas:${contas.length}:${nomes}`)) {
        notes.push({
          level: 'warn',
          type: 'attracione_contas',
          text: `Attracione: ${contas.length} conta(s) com problema (${nomes}).`
        });
      }
    }
    const quebradas = at.operacao?.plataformas_quebradas || [];
    if (quebradas.length) {
      const list = quebradas.slice(0, 4).join(', ');
      if (remember(`attracione_plat:${list}`)) {
        notes.push({
          level: 'warn',
          type: 'attracione_plataformas',
          text: `Attracione: plataforma(s) quebrada(s): ${list}.`
        });
      }
    }
  }

  if (notes.length && userId) {
    console.log(
      JSON.stringify({
        tag: 'jarvis.ops_watch',
        userId,
        count: notes.length,
        types: notes.map((n) => n.type)
      })
    );
  }

  return notes;
}

module.exports = {
  checkOpsHealth,
  normalizeQueue,
  havokThreshold,
  editorQueueThreshold
};
