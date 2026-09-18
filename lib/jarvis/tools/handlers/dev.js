/**
 * Dev/Ops tools — diagnosis + Railway redeploy (critical / HITL).
 * Prefer hub snapshots; optionally GitHub / Railway / local PROJETOS_ROOT.
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

/** project_id → { github, railwayService?, railwayProjectId?, localFolder? } */
const PROJECT_MAP = {
  approtina: {
    github: 'emiteus/app-rotina',
    railwayService: 'app-rotina',
    railwayProjectId: '8b776938-2e80-4906-a6ee-ca969cf0b2b5',
    localFolder: 'Approtina/app-rotina'
  },
  jarvis: {
    github: 'emiteus/jarvis-os',
    localFolder: 'Jarvis'
  },
  projeto_milhao: {
    github: 'emiteus/projeto-milhao',
    railwayService: 'projeto-milhao',
    railwayProjectId: 'b46cd3cf-44a1-4b96-ac2e-228259bdff2f',
    localFolder: 'Projeto Milhão'
  },
  cinerush: {
    github: 'emiteus/cinerush-tv-backend',
    railwayService: 'cinerush-tv',
    railwayProjectId: '5fc648e0-ea29-4615-9467-f6556d9694d4',
    localFolder: 'CineRushTV'
  },
  socialhub: {
    github: 'emiteus/socialhub',
    railwayService: 'socialhub',
    railwayProjectId: '7300e48b-c385-4261-b09f-dccee38f73ce',
    localFolder: 'SocialHub'
  },
  attracione: {
    railwayService: 'Attracione',
    railwayProjectId: '83a3e500-9dd7-4f63-9b56-92ecc32f831b',
    localFolder: 'Attracione'
  },
  cutflix: {
    localFolder: 'Cutflix'
  },
  clipper: {
    localFolder: 'Clipper'
  },
  cinerush_editor: {
    localFolder: 'Cinerush'
  }
};

const TYPES = new Set([
  'dev_diagnose',
  'dev_git_status',
  'dev_read_file',
  'dev_railway_logs',
  'dev_railway_redeploy'
]);

function projetosRoot() {
  return (
    process.env.PROJETOS_ROOT ||
    path.resolve(__dirname, '..', '..', '..', '..')
  );
}

function resolveProjectKey(acao) {
  const raw = String(
    acao.project || acao.projeto || acao.project_id || acao.id || ''
  )
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  if (!raw) return null;
  if (PROJECT_MAP[raw]) return raw;
  const aliases = {
    app_rotina: 'approtina',
    'app-rotina': 'approtina',
    milhao: 'projeto_milhao',
    milhão: 'projeto_milhao',
    cine: 'cinerush',
    cinerush_tv: 'cinerush',
    teushub: 'socialhub',
    attra: 'attracione',
    editor: 'cinerush_editor'
  };
  return aliases[raw] || null;
}

function localProjectPath(key) {
  const meta = PROJECT_MAP[key];
  if (!meta || !meta.localFolder) return null;
  const root = projetosRoot();
  const p = path.resolve(root, meta.localFolder);
  const rootResolved = path.resolve(root);
  if (!p.startsWith(rootResolved)) return null;
  return p;
}

function assertSafeRelPath(rel) {
  const s = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!s || s.includes('..') || path.isAbsolute(rel)) {
    throw new Error('path inválido (allowlist relativa, sem ..)');
  }
  if (/\.(env|pem|key|p12|pfx)$/i.test(s) || /(^|\/)\.env(\.|$)/i.test(s)) {
    throw new Error('arquivo sensível bloqueado');
  }
  return s;
}

async function githubFetch(apiPath) {
  const token = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim();
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Jarvis-OS-DevAgent'
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`https://api.github.com${apiPath}`, {
    headers,
    signal: AbortSignal.timeout(15000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || `GitHub HTTP ${res.status}`);
  }
  return data;
}

async function railwayGraphql(query, variables = {}) {
  const token = String(
    process.env.RAILWAY_TOKEN || process.env.RAILWAY_API_TOKEN || ''
  ).trim();
  if (!token) {
    throw new Error('RAILWAY_TOKEN ausente — seta no Railway pra ler logs');
  }
  // Account/workspace token → Bearer. Project token → Project-Access-Token.
  const headers = {
    'Content-Type': 'application/json'
  };
  if (/^pt_|project/i.test(token) || process.env.RAILWAY_TOKEN_KIND === 'project') {
    headers['Project-Access-Token'] = token;
  } else {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch('https://backboard.railway.app/graphql/v2', {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20000)
  });
  const data = await res.json().catch(() => ({}));
  if (data.errors && data.errors.length) {
    const msg = data.errors.map((e) => e.message).join('; ');
    throw new Error(msg || 'Railway GraphQL error');
  }
  if (!res.ok) {
    throw new Error(`Railway HTTP ${res.status}`);
  }
  return data.data;
}

async function railwayProjectSnapshot(projectId) {
  return railwayGraphql(
    `
    query ($id: String!) {
      project(id: $id) {
        id
        name
        services {
          edges {
            node {
              id
              name
            }
          }
        }
        environments {
          edges {
            node {
              id
              name
            }
          }
        }
      }
    }
  `,
    { id: projectId }
  );
}

async function railwayLatestDeployment(serviceId, environmentId) {
  const data = await railwayGraphql(
    `
    query ($input: DeploymentListInput!) {
      deployments(first: 1, input: $input) {
        edges {
          node {
            id
            status
            createdAt
            staticUrl
          }
        }
      }
    }
  `,
    { input: { serviceId, environmentId } }
  );
  return data?.deployments?.edges?.[0]?.node || null;
}

function normalizeLogLines(raw, limit) {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((l) => {
        if (typeof l === 'string') return l;
        const msg = l.message || l.text || '';
        if (!String(msg).trim()) return '';
        const ts = l.timestamp ? String(l.timestamp).slice(11, 19) + ' ' : '';
        const sev = l.severity && !/^info$/i.test(l.severity) ? `[${l.severity}] ` : '';
        return `${ts}${sev}${msg}`;
      })
      .filter((l) => String(l || '').trim())
      .slice(-limit);
  }
  if (typeof raw === 'string') {
    return raw.split(/\n/).filter((l) => l.trim()).slice(-limit);
  }
  return [];
}

async function railwayTryLogs(deploymentId, limit) {
  // Log! exige seleção de campos — sem { message } a API valida e falha
  const attempts = [
    {
      q: `query ($id: String!, $limit: Int) {
        deploymentLogs(deploymentId: $id, limit: $limit) {
          timestamp
          message
          severity
        }
      }`,
      pick: (d) => d?.deploymentLogs,
      vars: { id: deploymentId, limit }
    },
    {
      q: `query ($id: String!, $limit: Int) {
        buildLogs(deploymentId: $id, limit: $limit) {
          timestamp
          message
          severity
        }
      }`,
      pick: (d) => d?.buildLogs,
      vars: { id: deploymentId, limit }
    }
  ];
  for (const a of attempts) {
    try {
      const data = await railwayGraphql(a.q, a.vars);
      const lines = normalizeLogLines(a.pick(data), limit);
      if (lines.length) return lines;
    } catch (_) {
      /* try next */
    }
  }
  return [];
}

async function handleRailwayLogs(acao) {
  const key = resolveProjectKey(acao);
  const meta = key ? PROJECT_MAP[key] : null;
  const serviceName =
    acao.service || acao.servico || meta?.railwayService || null;
  const projectId =
    acao.railwayProjectId ||
    meta?.railwayProjectId ||
    process.env.RAILWAY_PROJECT_ID ||
    null;

  if (!serviceName && !projectId) {
    return {
      tipo: 'dev_railway_logs',
      ok: false,
      erro: 'Informe project ou service (ex. projeto_milhao, app-rotina)'
    };
  }

  const limit = Math.min(Number(acao.limit || 40) || 40, 80);

  try {
    if (!projectId) {
      return {
        tipo: 'dev_railway_logs',
        ok: false,
        erro: `Sem railwayProjectId mapeado pra ${key || serviceName}`,
        hint: 'Atualiza o connector ou passa railwayProjectId'
      };
    }

    const snap = await railwayProjectSnapshot(projectId);
    const project = snap?.project;
    if (!project) {
      return {
        tipo: 'dev_railway_logs',
        ok: false,
        erro: 'Not Authorized ou project id inválido',
        hint:
          'Use **Account token** em railway.com/account/tokens (não Project Token de um projeto só). Re-seta RAILWAY_TOKEN no app-rotina.'
      };
    }

    const services = (project.services?.edges || []).map((e) => e.node).filter(Boolean);
    const want = String(serviceName || '').toLowerCase();
    const service =
      services.find((s) => String(s.name).toLowerCase() === want) ||
      services.find((s) => String(s.name).toLowerCase().includes(want)) ||
      services[0];

    if (!service) {
      return {
        tipo: 'dev_railway_logs',
        ok: false,
        erro: `Nenhum service em ${project.name}`,
        services: services.map((s) => s.name)
      };
    }

    const envs = (project.environments?.edges || []).map((e) => e.node).filter(Boolean);
    const environment =
      envs.find((e) => /prod/i.test(e.name)) || envs[0] || null;

    let deployment = null;
    if (environment) {
      try {
        deployment = await railwayLatestDeployment(service.id, environment.id);
      } catch (e) {
        deployment = { error: e.message };
      }
    }

    let lines = [];
    if (deployment && deployment.id) {
      lines = await railwayTryLogs(deployment.id, limit);
    }

    return {
      tipo: 'dev_railway_logs',
      ok: true,
      project: key || null,
      railwayProject: project.name,
      service: service.name,
      environment: environment?.name || null,
      deploymentId: deployment?.id || null,
      deploymentStatus: deployment?.status || deployment?.error || null,
      staticUrl: deployment?.staticUrl || null,
      lines,
      services: services.map((s) => s.name),
      note:
        lines.length === 0
          ? 'Status do deploy ok; runtime logs via API às vezes vêm vazios — use o dashboard se precisar do stream completo.'
          : null
    };
  } catch (e) {
    const msg = String(e.message || e);
    return {
      tipo: 'dev_railway_logs',
      ok: false,
      erro: msg,
      hint: /not authorized|unauthorized/i.test(msg)
        ? 'Cria de novo um **Account Token** em https://railway.com/account/tokens e roda `node scripts/set-dev-tokens.js` (só RAILWAY_TOKEN).'
        : 'Confere RAILWAY_TOKEN no serviço app-rotina'
    };
  }
}

async function handleDiagnose(acao, ctx) {
  const { userId } = ctx;
  const key = resolveProjectKey(acao) || 'approtina';
  const meta = PROJECT_MAP[key] || {};
  const { getRegistryStatus, loadAllProjectSnapshots } = require('../../projects/registry');
  const { getProjectMemory } = require('../../memory/projects');
  const { getOsStatus } = require('../../os-status');

  const registry = getRegistryStatus().find(
    (p) => p.id === key || p.snapshotKey === key
  );
  let snap = null;
  try {
    const all = await loadAllProjectSnapshots();
    snap = all && (all[key] || all[registry?.snapshotKey]);
  } catch (_) {
    /* ignore */
  }

  let mem = null;
  try {
    mem = await getProjectMemory(userId, key);
  } catch (_) {
    /* ignore */
  }

  let os = null;
  try {
    os = getOsStatus();
  } catch (_) {
    /* ignore */
  }

  const result = {
    tipo: 'dev_diagnose',
    ok: true,
    project: key,
    github: meta.github || null,
    railwayService: meta.railwayService || null,
    registry: registry
      ? {
          name: registry.name,
          conectado: registry.conectado,
          envConfigured: registry.envConfigured,
          envRequired: registry.envRequired
        }
      : null,
    snapshot: snap
      ? {
          conectado: snap.conectado,
          motivo: snap.motivo || snap.erro || null,
          nota: snap.nota || null,
          hoje: snap.hoje
            ? { data: snap.hoje.data, total: snap.hoje.total ?? snap.hoje.total_videos }
            : null
        }
      : null,
    memoria: mem
      ? {
          status: mem.status,
          ultima_falha: mem.ultima_falha?.text || mem.ultima_falha || null,
          stack: mem.stack
        }
      : null,
    jarvis: os
      ? { version: os.version, agents: (os.agents || []).map((a) => a.id) }
      : null
  };

  const lines = [];
  lines.push(`*Diagnóstico ${key}*`);
  lines.push(
    `• Registry: ${result.registry ? (result.registry.conectado ? 'ON' : 'off') : '—'}` +
      (result.registry?.name ? ` (${result.registry.name})` : '')
  );
  if (result.railwayService) lines.push(`• Railway: \`${result.railwayService}\``);
  if (result.github) lines.push(`• GitHub: \`${result.github}\``);
  if (result.snapshot) {
    lines.push(
      `• Snapshot: ${result.snapshot.conectado ? 'conectado' : 'off'}` +
        (result.snapshot.motivo ? ` — ${String(result.snapshot.motivo).slice(0, 80)}` : '') +
        (result.snapshot.nota ? ` — ${String(result.snapshot.nota).slice(0, 80)}` : '')
    );
    if (result.snapshot.hoje) {
      lines.push(
        `• Hoje (${result.snapshot.hoje.data || '?'}): ${result.snapshot.hoje.total ?? '—'}`
      );
    }
  } else {
    lines.push('• Snapshot: sem dados');
  }
  if (result.memoria?.status) lines.push(`• Status mem: ${result.memoria.status}`);
  if (result.memoria?.ultima_falha) {
    lines.push(`• Última falha: ${String(result.memoria.ultima_falha).slice(0, 120)}`);
  }
  if (result.jarvis?.version) lines.push(`• Jarvis: v${result.jarvis.version}`);
  result.texto = lines.join('\n');
  return result;
}

async function handleGitStatus(acao) {
  const key = resolveProjectKey(acao);
  if (!key) {
    return {
      tipo: 'dev_git_status',
      ok: false,
      erro: 'Informe project (approtina|jarvis|projeto_milhao|cinerush|socialhub|…)'
    };
  }
  const meta = PROJECT_MAP[key];
  const local = localProjectPath(key);

  // Local git when disk available
  if (local && fs.existsSync(path.join(local, '.git'))) {
    try {
      const { stdout: branch } = await execFileAsync(
        'git',
        ['-C', local, 'rev-parse', '--abbrev-ref', 'HEAD'],
        { timeout: 8000 }
      );
      const { stdout: status } = await execFileAsync(
        'git',
        ['-C', local, 'status', '-sb'],
        { timeout: 8000 }
      );
      const { stdout: log } = await execFileAsync(
        'git',
        ['-C', local, 'log', '-5', '--oneline'],
        { timeout: 8000 }
      );
      return {
        tipo: 'dev_git_status',
        ok: true,
        project: key,
        fonte: 'local',
        branch: branch.trim(),
        status: status.trim().slice(0, 1500),
        recent: log.trim().split(/\n/).slice(0, 5)
      };
    } catch (e) {
      /* fall through to github */
      if (!meta.github) {
        return { tipo: 'dev_git_status', ok: false, erro: e.message };
      }
    }
  }

  if (!meta.github) {
    return {
      tipo: 'dev_git_status',
      ok: false,
      erro: 'Sem pasta local nem repo GitHub mapeado pra este projeto'
    };
  }

  try {
    const repo = await githubFetch(`/repos/${meta.github}`);
    const commits = await githubFetch(
      `/repos/${meta.github}/commits?per_page=5`
    );
    return {
      tipo: 'dev_git_status',
      ok: true,
      project: key,
      fonte: 'github',
      repo: meta.github,
      default_branch: repo.default_branch,
      pushed_at: repo.pushed_at,
      recent: (commits || []).slice(0, 5).map((c) => ({
        sha: String(c.sha || '').slice(0, 7),
        message: String(c.commit?.message || '')
          .split('\n')[0]
          .slice(0, 100),
        date: c.commit?.author?.date || null
      }))
    };
  } catch (e) {
    return {
      tipo: 'dev_git_status',
      ok: false,
      erro: e.message,
      hint: 'Seta GITHUB_TOKEN no Railway se o repo for privado'
    };
  }
}

async function handleReadFile(acao) {
  const key = resolveProjectKey(acao);
  if (!key) {
    return { tipo: 'dev_read_file', ok: false, erro: 'Informe project' };
  }
  let rel;
  try {
    rel = assertSafeRelPath(acao.path || acao.file || acao.arquivo);
  } catch (e) {
    return { tipo: 'dev_read_file', ok: false, erro: e.message };
  }
  const max = Math.min(Number(acao.maxBytes || 12000) || 12000, 20000);
  const meta = PROJECT_MAP[key];
  const local = localProjectPath(key);

  if (local) {
    const full = path.resolve(local, rel);
    if (!full.startsWith(path.resolve(local))) {
      return { tipo: 'dev_read_file', ok: false, erro: 'path fora do projeto' };
    }
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      const buf = fs.readFileSync(full);
      const text = buf.slice(0, max).toString('utf8');
      return {
        tipo: 'dev_read_file',
        ok: true,
        project: key,
        fonte: 'local',
        path: rel,
        truncated: buf.length > max,
        bytes: buf.length,
        content: text
      };
    }
  }

  if (!meta.github) {
    return {
      tipo: 'dev_read_file',
      ok: false,
      erro: 'Arquivo não encontrado localmente e sem GitHub mapeado'
    };
  }

  try {
    const data = await githubFetch(
      `/repos/${meta.github}/contents/${rel
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`
    );
    if (data.encoding === 'base64' && data.content) {
      const buf = Buffer.from(data.content, 'base64');
      return {
        tipo: 'dev_read_file',
        ok: true,
        project: key,
        fonte: 'github',
        path: rel,
        truncated: buf.length > max,
        bytes: buf.length,
        content: buf.slice(0, max).toString('utf8')
      };
    }
    return { tipo: 'dev_read_file', ok: false, erro: 'conteúdo GitHub inválido' };
  } catch (e) {
    return { tipo: 'dev_read_file', ok: false, erro: e.message };
  }
}

async function handleRailwayRedeploy(acao) {
  const key = resolveProjectKey(acao);
  const meta = key ? PROJECT_MAP[key] : null;
  const serviceName =
    acao.service || acao.servico || meta?.railwayService || null;
  const projectId =
    acao.railwayProjectId || meta?.railwayProjectId || null;

  if (!projectId || !serviceName) {
    return {
      tipo: 'dev_railway_redeploy',
      ok: false,
      erro: 'Informe project mapeado com Railway (ex. projeto_milhao, approtina)'
    };
  }

  try {
    const snap = await railwayProjectSnapshot(projectId);
    const project = snap?.project;
    if (!project) {
      return {
        tipo: 'dev_railway_redeploy',
        ok: false,
        erro: 'Not Authorized ou project id inválido',
        hint: 'Account token em railway.com/account/tokens'
      };
    }

    const services = (project.services?.edges || []).map((e) => e.node).filter(Boolean);
    const want = String(serviceName).toLowerCase();
    const service =
      services.find((s) => String(s.name).toLowerCase() === want) ||
      services.find((s) => String(s.name).toLowerCase().includes(want));
    if (!service) {
      return {
        tipo: 'dev_railway_redeploy',
        ok: false,
        erro: `Service ${serviceName} não achado`,
        services: services.map((s) => s.name)
      };
    }

    const envs = (project.environments?.edges || []).map((e) => e.node).filter(Boolean);
    const environment =
      envs.find((e) => /prod/i.test(e.name)) || envs[0] || null;
    if (!environment) {
      return { tipo: 'dev_railway_redeploy', ok: false, erro: 'Sem environment' };
    }

    // Prefer redeploy do service instance (puxa source); fallback deploymentRedeploy
    let mode = 'serviceInstanceRedeploy';
    let deploymentId = null;
    try {
      await railwayGraphql(
        `mutation ($serviceId: String!, $environmentId: String!) {
          serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId)
        }`,
        { serviceId: service.id, environmentId: environment.id }
      );
    } catch (e1) {
      mode = 'deploymentRedeploy';
      const deployment = await railwayLatestDeployment(service.id, environment.id);
      if (!deployment?.id) {
        return {
          tipo: 'dev_railway_redeploy',
          ok: false,
          erro: e1.message || 'Redeploy falhou e sem deployment',
          hint: String(e1.message || '')
        };
      }
      deploymentId = deployment.id;
      await railwayGraphql(
        `mutation ($id: String!) {
          deploymentRedeploy(id: $id) { id status }
        }`,
        { id: deploymentId }
      );
    }

    return {
      tipo: 'dev_railway_redeploy',
      ok: true,
      project: key,
      railwayProject: project.name,
      service: service.name,
      environment: environment.name,
      mode,
      deploymentId,
      texto: `*Redeploy*\n• Projeto: **${project.name}**\n• Service: \`${service.name}\`\n• Env: ${environment.name}\n• Modo: ${mode}`
    };
  } catch (e) {
    return {
      tipo: 'dev_railway_redeploy',
      ok: false,
      erro: e.message,
      hint: 'Confere RAILWAY_TOKEN (Account) e se o service está no PROJECT_MAP'
    };
  }
}

async function handle(acao, ctx) {
  const tipo = acao && acao.tipo;
  if (!TYPES.has(tipo)) return null;

  const { requireLib } = require('../../host');
  const { isPlanoOwnerUserId } = requireLib('plano-owner');
  if (!(await isPlanoOwnerUserId(ctx.userId))) {
    return { tipo, ok: false, erro: 'só owner' };
  }

  console.log(
    JSON.stringify({
      tag: 'jarvis.dev',
      event: 'tool',
      tipo,
      project: acao.project || acao.projeto || null,
      userId: ctx.userId
    })
  );

  if (tipo === 'dev_diagnose') return handleDiagnose(acao, ctx);
  if (tipo === 'dev_git_status') return handleGitStatus(acao);
  if (tipo === 'dev_read_file') return handleReadFile(acao);
  if (tipo === 'dev_railway_logs') return handleRailwayLogs(acao);
  if (tipo === 'dev_railway_redeploy') return handleRailwayRedeploy(acao);
  return null;
}

module.exports = { TYPES, handle, PROJECT_MAP };
