/**
 * Dev/Ops tools — read-only diagnosis (Gap Map day 31–60 trilho B).
 * Prefer hub snapshots; optionally GitHub / Railway / local PROJETOS_ROOT.
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

/** project_id → { github, railwayService?, localFolder? } */
const PROJECT_MAP = {
  approtina: {
    github: 'emiteus/app-rotina',
    railwayService: 'app-rotina',
    localFolder: 'Approtina/app-rotina'
  },
  jarvis: {
    github: 'emiteus/jarvis-os',
    localFolder: 'Jarvis'
  },
  projeto_milhao: {
    github: 'emiteus/projeto-milhao',
    railwayService: 'projeto-milhao',
    localFolder: 'Projeto Milhão'
  },
  cinerush: {
    github: 'emiteus/cinerush-tv-backend',
    railwayService: 'cinerush-tv',
    localFolder: 'CineRushTV'
  },
  socialhub: {
    github: 'emiteus/socialhub',
    railwayService: 'socialhub',
    localFolder: 'SocialHub'
  },
  attracione: {
    railwayService: 'Attracione',
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
  'dev_railway_logs'
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
  const res = await fetch('https://backboard.railway.app/graphql/v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20000)
  });
  const data = await res.json().catch(() => ({}));
  if (data.errors && data.errors.length) {
    throw new Error(data.errors[0].message || 'Railway GraphQL error');
  }
  return data.data;
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

  return {
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
      : null,
    next:
      'Se precisar de código/logs: dev_git_status / dev_read_file / dev_railway_logs (GITHUB_TOKEN / RAILWAY_TOKEN).'
  };
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

async function handleRailwayLogs(acao) {
  const key = resolveProjectKey(acao);
  const meta = key ? PROJECT_MAP[key] : null;
  const serviceName =
    acao.service ||
    acao.servico ||
    meta?.railwayService ||
    null;
  if (!serviceName) {
    return {
      tipo: 'dev_railway_logs',
      ok: false,
      erro: 'Informe project ou service (ex. app-rotina, projeto-milhao)'
    };
  }

  const limit = Math.min(Number(acao.limit || 40) || 40, 80);

  try {
    // Resolve service + latest deployment via GraphQL (token-scoped)
    const data = await railwayGraphql(`
      query {
        me {
          workspaces {
            team {
              projects {
                edges {
                  node {
                    id
                    name
                    services {
                      edges {
                        node {
                          id
                          name
                          deployments(first: 1) {
                            edges {
                              node {
                                id
                                status
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `);

    let found = null;
    const workspaces = data?.me?.workspaces || [];
    for (const ws of workspaces) {
      const projects = ws?.team?.projects?.edges || [];
      for (const pe of projects) {
        const services = pe?.node?.services?.edges || [];
        for (const se of services) {
          const n = se?.node;
          if (
            n &&
            String(n.name).toLowerCase() === String(serviceName).toLowerCase()
          ) {
            found = {
              project: pe.node.name,
              serviceId: n.id,
              service: n.name,
              deploymentId: n.deployments?.edges?.[0]?.node?.id || null,
              deploymentStatus: n.deployments?.edges?.[0]?.node?.status || null
            };
            break;
          }
        }
        if (found) break;
      }
      if (found) break;
    }

    if (!found) {
      return {
        tipo: 'dev_railway_logs',
        ok: false,
        erro: `Serviço "${serviceName}" não encontrado no token Railway`,
        hint: 'Confere o nome (app-rotina, projeto-milhao, …) e RAILWAY_TOKEN'
      };
    }

    // Build logs: Railway HTTP logs stream is complex; return deployment meta + tip
    // Try environmentBuildLogs / deploymentLogs if available
    let lines = [];
    if (found.deploymentId) {
      try {
        const logData = await railwayGraphql(
          `
          query ($id: String!) {
            deploymentLogs(deploymentId: $id, limit: ${limit})
          }
        `,
          { id: found.deploymentId }
        );
        const raw = logData?.deploymentLogs;
        if (Array.isArray(raw)) {
          lines = raw
            .map((l) => (typeof l === 'string' ? l : l.message || JSON.stringify(l)))
            .slice(-limit);
        } else if (typeof raw === 'string') {
          lines = raw.split(/\n/).slice(-limit);
        }
      } catch (e) {
        lines = [`(deploymentLogs indisponível: ${e.message})`];
      }
    }

    return {
      tipo: 'dev_railway_logs',
      ok: true,
      project: key || null,
      service: found.service,
      railwayProject: found.project,
      deploymentId: found.deploymentId,
      deploymentStatus: found.deploymentStatus,
      lines,
      note:
        lines.length <= 1
          ? 'Se lines vazio, abre o deploy no dashboard ou confere escopo do RAILWAY_TOKEN.'
          : null
    };
  } catch (e) {
    return {
      tipo: 'dev_railway_logs',
      ok: false,
      erro: e.message,
      hint: 'Cria token em railway.app → Account → Tokens e seta RAILWAY_TOKEN no app-rotina'
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
  return null;
}

module.exports = { TYPES, handle, PROJECT_MAP };
