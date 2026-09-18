/**
 * Railway deploy watch — proactive FAIL/CRASH alerts (notify only).
 * Dedupes by deployment id so the same fail doesn't spam every sweep.
 */
const { PROJECT_MAP } = require('../tools/handlers/dev');

/** @type {Map<string, number>} key = `${projectKey}:${deploymentId}:${status}` */
const alertedFails = new Map();
const MAX_ALERTED = 200;

const FAIL_STATUSES = new Set(['FAILED', 'CRASHED']);

function hintName(projectKey) {
  const map = {
    projeto_milhao: 'milhão',
    approtina: 'approtina',
    cinerush: 'cinerush',
    socialhub: 'socialhub',
    attracione: 'attracione'
  };
  return map[projectKey] || projectKey;
}

async function railwayGraphql(query, variables = {}) {
  const token = String(
    process.env.RAILWAY_TOKEN || process.env.RAILWAY_API_TOKEN || ''
  ).trim();
  if (!token) return null;

  const headers = { 'Content-Type': 'application/json' };
  if (/^pt_|project/i.test(token) || process.env.RAILWAY_TOKEN_KIND === 'project') {
    headers['Project-Access-Token'] = token;
  } else {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch('https://backboard.railway.app/graphql/v2', {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(18000)
  });
  const data = await res.json().catch(() => ({}));
  if (data.errors && data.errors.length) {
    throw new Error(data.errors.map((e) => e.message).join('; '));
  }
  if (!res.ok) throw new Error(`Railway HTTP ${res.status}`);
  return data.data;
}

async function latestDeployment(serviceId, environmentId) {
  const data = await railwayGraphql(
    `query ($input: DeploymentListInput!) {
      deployments(first: 1, input: $input) {
        edges { node { id status createdAt } }
      }
    }`,
    { input: { serviceId, environmentId } }
  );
  return data?.deployments?.edges?.[0]?.node || null;
}

function rememberAlert(key) {
  if (alertedFails.has(key)) return false;
  alertedFails.set(key, Date.now());
  if (alertedFails.size > MAX_ALERTED) {
    const first = alertedFails.keys().next().value;
    alertedFails.delete(first);
  }
  return true;
}

function clearAlertsForService(projectKey) {
  for (const k of [...alertedFails.keys()]) {
    if (k.startsWith(`${projectKey}:`)) alertedFails.delete(k);
  }
}

/**
 * Check mapped Railway services for FAILED/CRASHED latest deploy.
 * @returns {Promise<Array<{level, type, text, project, status, deploymentId}>>}
 */
async function checkRailwayDeployHealth(userId = null) {
  if (process.env.JARVIS_RAILWAY_WATCH === '0') return [];
  const token = String(
    process.env.RAILWAY_TOKEN || process.env.RAILWAY_API_TOKEN || ''
  ).trim();
  if (!token) return [];

  const notes = [];
  const entries = Object.entries(PROJECT_MAP).filter(
    ([, m]) => m && m.railwayProjectId && m.railwayService
  );

  for (const [projectKey, meta] of entries) {
    try {
      const snap = await railwayGraphql(
        `query ($id: String!) {
          project(id: $id) {
            id
            name
            services { edges { node { id name } } }
            environments { edges { node { id name } } }
          }
        }`,
        { id: meta.railwayProjectId }
      );
      const project = snap?.project;
      if (!project) continue;

      const services = (project.services?.edges || []).map((e) => e.node).filter(Boolean);
      const want = String(meta.railwayService).toLowerCase();
      const service =
        services.find((s) => String(s.name).toLowerCase() === want) ||
        services.find((s) => String(s.name).toLowerCase().includes(want));
      if (!service) continue;

      const envs = (project.environments?.edges || []).map((e) => e.node).filter(Boolean);
      const environment =
        envs.find((e) => /prod/i.test(e.name)) || envs[0] || null;
      if (!environment) continue;

      const deployment = await latestDeployment(service.id, environment.id);
      if (!deployment?.id) continue;

      const status = String(deployment.status || '').toUpperCase();
      if (!FAIL_STATUSES.has(status)) {
        // recovered — allow future fails to alert again
        clearAlertsForService(projectKey);
        continue;
      }

      const dedupeKey = `${projectKey}:${deployment.id}:${status}`;
      if (!rememberAlert(dedupeKey)) continue;

      const shortId = String(deployment.id).slice(0, 8);
      notes.push({
        level: 'warn',
        type: 'railway_deploy_fail',
        project: projectKey,
        status,
        deploymentId: deployment.id,
        text:
          `Railway **${project.name}** / \`${service.name}\` (${environment.name}): ` +
          `deploy **${status}** (\`${shortId}\`) — ` +
          `manda *diagnostica ${hintName(projectKey)}* ou *restart ${hintName(projectKey)}*.`
      });

      if (userId) {
        try {
          const { upsertProjectMemory } = require('../memory/projects');
          await upsertProjectMemory(userId, {
            project: projectKey,
            ultima_falha: `Railway ${status}: ${service.name} @ ${environment.name} (${shortId})`
          });
        } catch (e) {
          console.error('[railway-watch] ultima_falha:', e.message);
        }
      }
    } catch (e) {
      console.error(
        JSON.stringify({
          tag: 'jarvis.railway_watch',
          project: projectKey,
          erro: e.message
        })
      );
    }
  }

  return notes;
}

module.exports = {
  checkRailwayDeployHealth,
  FAIL_STATUSES
};
