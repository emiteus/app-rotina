/**
 * Analytics temporal — séries de métricas + alertas genéricos.
 * Samples gravados no Postgres; comparação vs janela recente.
 */
const { run, all } = require('../host').requireLib('db');

async function ensureTable() {
  await run(`
    CREATE TABLE IF NOT EXISTS jarvis_metric_samples (
      id BIGSERIAL PRIMARY KEY,
      project_id TEXT NOT NULL,
      metric TEXT NOT NULL,
      value DOUBLE PRECISION NOT NULL,
      meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      sampled_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await run(
    `CREATE INDEX IF NOT EXISTS idx_jarvis_metrics_lookup
     ON jarvis_metric_samples (project_id, metric, sampled_at DESC)`
  ).catch(() => {});
}

async function recordSample(projectId, metric, value, meta = {}) {
  if (projectId == null || metric == null || !Number.isFinite(Number(value))) {
    return null;
  }
  await ensureTable();
  await run(
    `INSERT INTO jarvis_metric_samples (project_id, metric, value, meta, sampled_at)
     VALUES ($1, $2, $3, $4::jsonb, CURRENT_TIMESTAMP)`,
    [
      String(projectId).slice(0, 64),
      String(metric).slice(0, 64),
      Number(value),
      JSON.stringify(meta || {})
    ]
  );
  return true;
}

/**
 * @returns {Promise<Array<{value, sampled_at, meta}>>}
 */
async function getSeries(projectId, metric, { limit = 48, sinceHours = 72 } = {}) {
  await ensureTable();
  const rows = await all(
    `SELECT value, sampled_at, meta
     FROM jarvis_metric_samples
     WHERE project_id = $1 AND metric = $2
       AND sampled_at >= NOW() - ($3::int * INTERVAL '1 hour')
     ORDER BY sampled_at DESC
     LIMIT $4`,
    [projectId, metric, Math.max(1, Number(sinceHours) || 72), limit]
  );
  return (rows || []).map((r) => ({
    value: Number(r.value),
    sampled_at: r.sampled_at,
    meta: typeof r.meta === 'string' ? JSON.parse(r.meta) : r.meta || {}
  }));
}

/**
 * Alerta genérico: valor atual vs média da série (ou limiar absoluto).
 * @param {object} rule
 * @param {string} rule.project_id
 * @param {string} rule.metric
 * @param {'below'|'above'|'drop_pct'|'rise_pct'} rule.when
 * @param {number} [rule.threshold]
 * @param {number} [rule.pct] — para drop_pct/rise_pct vs média
 */
async function evaluateRule(rule) {
  const series = await getSeries(rule.project_id, rule.metric, {
    limit: 24,
    sinceHours: rule.sinceHours || 48
  });
  if (series.length < 1) return null;
  const current = series[0].value;
  const older = series.slice(1);
  const avg =
    older.length > 0
      ? older.reduce((s, p) => s + p.value, 0) / older.length
      : current;

  let fired = false;
  let detail = '';
  const when = rule.when || 'below';
  if (when === 'below' && rule.threshold != null) {
    fired = current < Number(rule.threshold);
    detail = `${current} < ${rule.threshold}`;
  } else if (when === 'above' && rule.threshold != null) {
    fired = current > Number(rule.threshold);
    detail = `${current} > ${rule.threshold}`;
  } else if (when === 'drop_pct' && older.length >= 2) {
    const pct = Number(rule.pct != null ? rule.pct : 30);
    fired = avg > 0 && (avg - current) / avg >= pct / 100;
    detail = `${current} vs média ${avg.toFixed(1)} (−${pct}%+)`;
  } else if (when === 'rise_pct' && older.length >= 2) {
    const pct = Number(rule.pct != null ? rule.pct : 50);
    fired = avg > 0 && (current - avg) / avg >= pct / 100;
    detail = `${current} vs média ${avg.toFixed(1)} (+${pct}%+)`;
  }

  if (!fired) return null;
  return {
    level: rule.level || 'warn',
    type: `metric_${rule.metric}`,
    project_id: rule.project_id,
    metric: rule.metric,
    value: current,
    text:
      rule.text ||
      `**${rule.project_id}.${rule.metric}**: ${detail}`
  };
}

/** Regras default — Havok credits + fila editor. */
function defaultRules() {
  return [
    {
      project_id: 'cinerush',
      metric: 'havok_credits',
      when: 'below',
      threshold: Number(process.env.JARVIS_HAVOK_CREDITS_WARN || 50),
      text: null
    },
    {
      project_id: 'cinerush_editor',
      metric: 'queue_waiting',
      when: 'above',
      threshold: Number(process.env.JARVIS_EDITOR_QUEUE_WARN || 8),
      text: null
    },
    {
      project_id: 'cinerush_editor',
      metric: 'queue_failed',
      when: 'above',
      threshold: 0,
      text: null
    }
  ];
}

async function runGenericMetricAlerts() {
  if (process.env.JARVIS_ANALYTICS === '0') return [];
  const notes = [];
  for (const rule of defaultRules()) {
    try {
      const hit = await evaluateRule({
        ...rule,
        text:
          rule.text ||
          (rule.metric === 'havok_credits'
            ? `Havok credits baixos: **${rule.threshold}** threshold`
            : null)
      });
      if (hit) {
        // rewrite text with actual value after evaluate
        const series = await getSeries(rule.project_id, rule.metric, { limit: 1 });
        const v = series[0] && series[0].value;
        hit.text =
          rule.metric === 'havok_credits'
            ? `Havok credits **${v}** (limite ${rule.threshold})`
            : rule.metric === 'queue_waiting'
              ? `Editor fila waiting **${v}** (limite ${rule.threshold})`
              : rule.metric === 'queue_failed'
                ? `Editor fila failed **${v}**`
                : hit.text;
        // only fire queue_failed if > 0
        if (rule.metric === 'queue_failed' && !(v > 0)) continue;
        notes.push(hit);
      }
    } catch (e) {
      console.log(
        JSON.stringify({
          tag: 'jarvis.analytics',
          event: 'rule_fail',
          metric: rule.metric,
          erro: e.message
        })
      );
    }
  }
  return notes;
}

module.exports = {
  ensureTable,
  recordSample,
  getSeries,
  evaluateRule,
  defaultRules,
  runGenericMetricAlerts
};
