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
    github: 'emiteus/cutflix',
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
  'dev_git_diff',
  'dev_read_file',
  'dev_propose_patch',
  'dev_apply_patch_local',
  'dev_github_pr',
  'dev_run_tests',
  'dev_deploy_checklist',
  'dev_railway_logs',
  'dev_railway_redeploy',
  'dev_railway_restart'
]);

const PATCH_MAX_BYTES = 48000;
const PATCH_MAX_FILES = 5;
const PATCH_MAX_TOTAL_BYTES = 120000;

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

function formatReadFileTexto({ project, path: rel, fonte, content, truncated, bytes }) {
  const body = String(content || '').slice(0, 3500);
  const fence =
    /\.(json|js|ts|mjs|cjs|py|md|yml|yaml|toml|css|html|sql)$/i.test(rel)
      ? (rel.split('.').pop() || '').toLowerCase()
      : '';
  return (
    `*\`${project}/${rel}\`* (${fonte}${truncated ? ', truncado' : ''}, ${bytes || body.length}B)\n` +
    `\`\`\`${fence}\n${body}\n\`\`\``
  );
}

function assertPatchContent(raw) {
  const content = String(raw ?? '');
  if (!content.length) throw new Error('content vazio');
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > PATCH_MAX_BYTES) {
    throw new Error(`content grande demais (${bytes}B > ${PATCH_MAX_BYTES})`);
  }
  return { content, bytes };
}

/** Normalize single path+content or files[{path,content}] (≤5). */
function normalizePatchFiles(acao) {
  const rawFiles = Array.isArray(acao.files) ? acao.files : null;
  const out = [];
  if (rawFiles && rawFiles.length) {
    if (rawFiles.length > PATCH_MAX_FILES) {
      throw new Error(`máx ${PATCH_MAX_FILES} arquivos por patch`);
    }
    for (const f of rawFiles) {
      const rel = assertSafeRelPath(f.path || f.file || f.arquivo);
      const pack = assertPatchContent(f.content || f.conteudo || f.body);
      out.push({ path: rel, content: pack.content, bytes: pack.bytes });
    }
  } else {
    const rel = assertSafeRelPath(acao.path || acao.file || acao.arquivo);
    const pack = assertPatchContent(acao.content || acao.conteudo || acao.body);
    out.push({ path: rel, content: pack.content, bytes: pack.bytes });
  }
  const total = out.reduce((s, f) => s + f.bytes, 0);
  if (total > PATCH_MAX_TOTAL_BYTES) {
    throw new Error(`total ${total}B > ${PATCH_MAX_TOTAL_BYTES}`);
  }
  // de-dupe by path (last wins)
  const map = new Map();
  for (const f of out) map.set(f.path, f);
  return [...map.values()];
}

/** Unified diff preview (no external deps). */
function unifiedDiff(pathRel, before, after, maxLines = 80) {
  const a = String(before || '').split(/\r?\n/);
  const b = String(after || '').split(/\r?\n/);
  const lines = [`--- a/${pathRel}`, `+++ b/${pathRel}`];
  let i = 0;
  let j = 0;
  let shown = 0;
  while ((i < a.length || j < b.length) && shown < maxLines) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lines.push(` ${a[i]}`);
      i += 1;
      j += 1;
    } else if (j < b.length && (i >= a.length || a[i] !== b[j])) {
      if (i < a.length && (j >= b.length || !b.slice(j, j + 3).includes(a[i]))) {
        lines.push(`-${a[i]}`);
        i += 1;
      } else {
        lines.push(`+${b[j]}`);
        j += 1;
      }
    } else if (i < a.length) {
      lines.push(`-${a[i]}`);
      i += 1;
    } else {
      lines.push(`+${b[j]}`);
      j += 1;
    }
    shown += 1;
  }
  if (i < a.length || j < b.length) lines.push('… (diff truncado)');
  return lines.join('\n');
}

async function readProjectFileText(key, rel) {
  const meta = PROJECT_MAP[key];
  const local = localProjectPath(key);
  if (local) {
    const full = path.resolve(local, rel);
    if (!full.startsWith(path.resolve(local))) {
      throw new Error('path fora do projeto');
    }
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      return {
        fonte: 'local',
        content: fs.readFileSync(full, 'utf8'),
        exists: true,
        sha: null
      };
    }
  }
  if (!meta?.github) {
    return { fonte: local ? 'local' : null, content: '', exists: false, sha: null };
  }
  try {
    const data = await githubFetch(
      `/repos/${meta.github}/contents/${rel
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`
    );
    if (data.encoding === 'base64' && data.content) {
      return {
        fonte: 'github',
        content: Buffer.from(data.content, 'base64').toString('utf8'),
        exists: true,
        sha: data.sha || null
      };
    }
  } catch (e) {
    if (e.status === 404 || /404|Not Found/i.test(e.message || '')) {
      return { fonte: 'github', content: '', exists: false, sha: null };
    }
    throw e;
  }
  return { fonte: 'github', content: '', exists: false, sha: null };
}

async function githubFetch(apiPath, opts = {}) {
  const token = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim();
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Jarvis-OS-DevAgent',
    ...(opts.body ? { 'Content-Type': 'application/json' } : {})
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`https://api.github.com${apiPath}`, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(opts.timeoutMs || 20000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || `GitHub HTTP ${res.status}`);
    err.status = res.status;
    throw err;
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
      const result = {
        tipo: 'dev_read_file',
        ok: true,
        project: key,
        fonte: 'local',
        path: rel,
        truncated: buf.length > max,
        bytes: buf.length,
        content: text
      };
      result.texto = formatReadFileTexto(result);
      return result;
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
      const result = {
        tipo: 'dev_read_file',
        ok: true,
        project: key,
        fonte: 'github',
        path: rel,
        truncated: buf.length > max,
        bytes: buf.length,
        content: buf.slice(0, max).toString('utf8')
      };
      result.texto = formatReadFileTexto(result);
      return result;
    }
    return { tipo: 'dev_read_file', ok: false, erro: 'conteúdo GitHub inválido' };
  } catch (e) {
    return { tipo: 'dev_read_file', ok: false, erro: e.message };
  }
}

async function handleGitDiff(acao) {
  const key = resolveProjectKey(acao);
  if (!key) {
    return {
      tipo: 'dev_git_diff',
      ok: false,
      erro: 'Informe project (approtina|jarvis|…)'
    };
  }
  const local = localProjectPath(key);
  if (!local || !fs.existsSync(path.join(local, '.git'))) {
    return {
      tipo: 'dev_git_diff',
      ok: false,
      erro: 'Diff local precisa de PROJETOS_ROOT com .git (no Railway use propose/PR)'
    };
  }
  try {
    const args = ['-C', local, 'diff', '--stat'];
    const pathRel = acao.path || acao.file || null;
    if (pathRel) {
      const rel = assertSafeRelPath(pathRel);
      args.push('--', rel);
    }
    const { stdout: stat } = await execFileAsync('git', args, { timeout: 12000 });
    const diffArgs = ['-C', local, 'diff', '--no-color'];
    if (pathRel) diffArgs.push('--', assertSafeRelPath(pathRel));
    const { stdout: diff } = await execFileAsync('git', diffArgs, {
      timeout: 15000,
      maxBuffer: 512 * 1024
    });
    const body = String(diff || '').slice(0, 6000);
    return {
      tipo: 'dev_git_diff',
      ok: true,
      project: key,
      fonte: 'local',
      path: pathRel ? assertSafeRelPath(pathRel) : null,
      stat: String(stat || '').trim().slice(0, 800) || '(limpo)',
      diff: body || '(sem mudanças)',
      texto: `*Git diff ${key}*\n${String(stat || '').trim() || '(limpo)'}\n\`\`\`\n${(body || '(sem mudanças)').slice(0, 2500)}\n\`\`\``
    };
  } catch (e) {
    return { tipo: 'dev_git_diff', ok: false, erro: e.message };
  }
}

async function handleProposePatch(acao) {
  const key = resolveProjectKey(acao);
  if (!key) {
    return { tipo: 'dev_propose_patch', ok: false, erro: 'Informe project' };
  }
  let files;
  try {
    files = normalizePatchFiles(acao);
  } catch (e) {
    return { tipo: 'dev_propose_patch', ok: false, erro: e.message };
  }

  try {
    const previews = [];
    let unchangedAll = true;
    for (const f of files) {
      const cur = await readProjectFileText(key, f.path);
      if (cur.content !== f.content) unchangedAll = false;
      const diff = unifiedDiff(f.path, cur.content, f.content);
      const beforeLines = cur.content ? cur.content.split(/\r?\n/).length : 0;
      const afterLines = f.content.split(/\r?\n/).length;
      previews.push({
        path: f.path,
        fonte: cur.fonte,
        exists: cur.exists,
        bytes: f.bytes,
        before_lines: beforeLines,
        after_lines: afterLines,
        unchanged: cur.content === f.content,
        diff_preview: diff.slice(0, 2000),
        content: f.content
      });
    }
    if (unchangedAll) {
      return {
        tipo: 'dev_propose_patch',
        ok: true,
        project: key,
        unchanged: true,
        files: previews.map((p) => ({ path: p.path, unchanged: true })),
        texto: `Patch *${key}*: ${files.length} arquivo(s) idênticos — nada a aplicar.`
      };
    }
    const changed = previews.filter((p) => !p.unchanged);
    const head = changed
      .map((p) => `· \`${p.path}\` ${p.before_lines}→${p.after_lines} linhas`)
      .join('\n');
    const diffBlock = changed
      .map((p) => p.diff_preview)
      .join('\n\n')
      .slice(0, 2800);
    return {
      tipo: 'dev_propose_patch',
      ok: true,
      project: key,
      path: files.length === 1 ? files[0].path : undefined,
      content: files.length === 1 ? files[0].content : undefined,
      files: previews,
      texto:
        `*Patch proposto* **${key}** (${changed.length}/${files.length} mudam)\n${head}\n` +
        `Pra gravar: **dev_apply_patch_local** ou **dev_github_pr** — pedem SIM.\n` +
        `\`\`\`diff\n${diffBlock}\n\`\`\``
    };
  } catch (e) {
    return { tipo: 'dev_propose_patch', ok: false, erro: e.message };
  }
}

async function handleApplyPatchLocal(acao) {
  const key = resolveProjectKey(acao);
  if (!key) {
    return { tipo: 'dev_apply_patch_local', ok: false, erro: 'Informe project' };
  }
  let files;
  try {
    files = normalizePatchFiles(acao);
  } catch (e) {
    return { tipo: 'dev_apply_patch_local', ok: false, erro: e.message };
  }

  const local = localProjectPath(key);
  if (!local || !fs.existsSync(local)) {
    return {
      tipo: 'dev_apply_patch_local',
      ok: false,
      erro: 'Sem pasta local (PROJETOS_ROOT). No Railway use dev_github_pr.',
      hint: 'Seta PROJETOS_ROOT apontando pra R:/Projetos (ou equivalente) no host com disco'
    };
  }

  const written = [];
  try {
    for (const f of files) {
      const full = path.resolve(local, f.path);
      if (!full.startsWith(path.resolve(local))) {
        return { tipo: 'dev_apply_patch_local', ok: false, erro: `path fora: ${f.path}` };
      }
      fs.mkdirSync(path.dirname(full), { recursive: true });
      const created = !fs.existsSync(full);
      fs.writeFileSync(full, f.content, 'utf8');
      written.push({ path: f.path, bytes: f.bytes, created });
    }
    const list = written.map((w) => `· \`${w.path}\` (${w.bytes}B)`).join('\n');
    return {
      tipo: 'dev_apply_patch_local',
      ok: true,
      project: key,
      path: written.length === 1 ? written[0].path : undefined,
      files: written,
      texto:
        `*Patch aplicado* (local) **${key}** — ${written.length} arquivo(s)\n${list}\n` +
        `Sem commit — revisa ou manda **dev_github_pr** / **dev_run_tests**.`
    };
  } catch (e) {
    return { tipo: 'dev_apply_patch_local', ok: false, erro: e.message };
  }
}

async function handleGithubPr(acao) {
  const key = resolveProjectKey(acao);
  if (!key) {
    return { tipo: 'dev_github_pr', ok: false, erro: 'Informe project' };
  }
  const meta = PROJECT_MAP[key];
  if (!meta?.github) {
    return {
      tipo: 'dev_github_pr',
      ok: false,
      erro: `Projeto ${key} sem github mapeado`
    };
  }
  if (!String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim()) {
    return {
      tipo: 'dev_github_pr',
      ok: false,
      erro: 'GITHUB_TOKEN ausente',
      hint: 'Seta GITHUB_TOKEN no Railway com scope repo'
    };
  }

  let files;
  try {
    files = normalizePatchFiles(acao);
  } catch (e) {
    return { tipo: 'dev_github_pr', ok: false, erro: e.message };
  }

  const pathsLabel = files.map((f) => f.path).join(', ');
  const title =
    String(acao.title || acao.titulo || `Jarvis: update ${pathsLabel}`).trim().slice(0, 120) ||
    `Jarvis: update ${files[0].path}`;
  const body = String(
    acao.body_pr ||
      acao.pr_body ||
      acao.message ||
      `Patch via Jarvis coding agent.\n\n` +
        files.map((f) => `- \`${f.path}\``).join('\n') +
        `\n- project: ${key}`
  ).slice(0, 2000);
  const branchName = String(
    acao.branch || `jarvis/patch-${Date.now().toString(36)}`
  )
    .replace(/[^a-zA-Z0-9._\-/]/g, '-')
    .slice(0, 60);

  try {
    const repo = await githubFetch(`/repos/${meta.github}`);
    const base = String(acao.base || repo.default_branch || 'main');
    const refData = await githubFetch(`/repos/${meta.github}/git/ref/heads/${base}`);
    const baseSha = refData.object?.sha;
    if (!baseSha) throw new Error('sem SHA da branch base');

    await githubFetch(`/repos/${meta.github}/git/refs`, {
      method: 'POST',
      body: { ref: `refs/heads/${branchName}`, sha: baseSha }
    });

    for (const f of files) {
      let fileSha = null;
      try {
        const existing = await githubFetch(
          `/repos/${meta.github}/contents/${f.path
            .split('/')
            .map(encodeURIComponent)
            .join('/')}?ref=${encodeURIComponent(branchName)}`
        );
        fileSha = existing.sha || null;
      } catch (e) {
        if (e.status !== 404) throw e;
      }

      await githubFetch(
        `/repos/${meta.github}/contents/${f.path
          .split('/')
          .map(encodeURIComponent)
          .join('/')}`,
        {
          method: 'PUT',
          body: {
            message: files.length === 1 ? title : `${title} (${f.path})`,
            content: Buffer.from(f.content, 'utf8').toString('base64'),
            branch: branchName,
            ...(fileSha ? { sha: fileSha } : {})
          }
        }
      );
    }

    const pr = await githubFetch(`/repos/${meta.github}/pulls`, {
      method: 'POST',
      body: {
        title,
        head: branchName,
        base,
        body
      }
    });

    return {
      tipo: 'dev_github_pr',
      ok: true,
      project: key,
      path: files.length === 1 ? files[0].path : undefined,
      files: files.map((f) => f.path),
      branch: branchName,
      base,
      pr_number: pr.number,
      pr_url: pr.html_url,
      texto:
        `*PR aberto* [#${pr.number}](${pr.html_url})\n` +
        `\`${meta.github}\` · \`${branchName}\` → \`${base}\` · ${files.length} arquivo(s)\n` +
        files.map((f) => `· \`${f.path}\``).join('\n') +
        `\n\nPróximo: **dev_deploy_checklist** (não redeploy automático).`
    };
  } catch (e) {
    return {
      tipo: 'dev_github_pr',
      ok: false,
      erro: e.message,
      hint: 'Confere GITHUB_TOKEN (repo) e se a branch jarvis/* pode ser criada'
    };
  }
}

async function handleDeployChecklist(acao) {
  const key = resolveProjectKey(acao) || 'approtina';
  const meta = PROJECT_MAP[key] || {};
  const header = [
    `*Checklist deploy* **${key}** _(só orientação — nada executado)_`,
    meta.github ? `· Repo: \`${meta.github}\`` : '· Sem GitHub mapeado',
    meta.railwayService
      ? `· Railway: \`${meta.railwayService}\``
      : '· Sem Railway mapeado'
  ];

  let steps;
  if (key === 'cutflix') {
    steps = [
      '1. Código: `dev_git_status` cutflix (GitHub `emiteus/cutflix`)',
      '2. Local: `pnpm install` + `docker compose up -d` (Postgres/Redis/MinIO) + `pnpm dev`',
      '3. Health: seta `CUTFLIX_API_URL` no host → tool `cutflix_status`',
      '4. Site: smoke em cutflix.ai / API `/api/v1/health`',
      '5. Ainda **sem** Railway no mapa — deploy prod = infra à parte (não `redeploy approtina`)',
      '',
      '_Hub só health por enquanto. Deploy Cutflix ≠ sync Jarvis._'
    ];
  } else if (key === 'jarvis') {
    steps = [
      '1. Código OK? `dev_git_status` / `dev_run_tests` (disco)',
      '2. Sync: `npm run sync:host` no jarvis-os',
      '3. Commit + push **app-rotina** (Railway pega o host)',
      '4. Smoke WA: mensagem curta + tool com SIM se crítica',
      '',
      '_Jarvis não sobe sozinho — o deploy é o app-rotina._'
    ];
  } else if (key === 'approtina' || meta.railwayService) {
    steps = [
      '1. Código OK? `dev_git_status` / `dev_run_tests` (disco)',
      key === 'approtina' || key === 'jarvis'
        ? '2. Mudou Jarvis? `npm run sync:host` + commit app-rotina'
        : '2. Diff/PR? `dev_git_status` / `dev_github_pr` (HITL SIM)',
      meta.railwayService
        ? `3. Subir? \`dev_railway_redeploy\` **${key}** (HITL SIM) — ou restart se só env`
        : '3. Sem Railway — publica pelo fluxo do projeto',
      '4. Smoke: health / mensagem curta no canal',
      '',
      '_Jarvis **não** faz deploy sozinho. Manda o comando quando quiser._'
    ];
  } else {
    steps = [
      '1. Código OK? `dev_git_status` (GitHub se mapeado)',
      '2. Testes locais se tiver disco: `dev_run_tests`',
      '3. PR? `dev_github_pr` (HITL SIM) se houver mudança',
      '4. Host/prod: ainda sem Railway neste mapa — sobe manualmente',
      '',
      '_Checklist genérico — mapeia Railway no PROJECT_MAP quando existir._'
    ];
  }

  const lines = [...header, ...steps];
  return {
    tipo: 'dev_deploy_checklist',
    ok: true,
    project: key,
    github: meta.github || null,
    railwayService: meta.railwayService || null,
    texto: lines.join('\n')
  };
}

async function handleRunTests(acao) {
  const key = resolveProjectKey(acao) || 'jarvis';
  const local = localProjectPath(key);
  if (!local || !fs.existsSync(local)) {
    return {
      tipo: 'dev_run_tests',
      ok: false,
      erro: 'Sem pasta local (PROJETOS_ROOT) — testes só no host com disco'
    };
  }

  const pkgPath = path.join(local, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return { tipo: 'dev_run_tests', ok: false, erro: 'sem package.json no projeto' };
  }

  let scripts = {};
  try {
    scripts = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).scripts || {};
  } catch (e) {
    return { tipo: 'dev_run_tests', ok: false, erro: `package.json inválido: ${e.message}` };
  }

  const allowed = Object.keys(scripts).filter((name) =>
    /^(test|smoke|check|lint|ci)([:_-]|$)/i.test(name)
  );
  if (!allowed.length) {
    return {
      tipo: 'dev_run_tests',
      ok: false,
      erro: 'Nenhum script allowlist (test|smoke|check|lint|ci*) no package.json'
    };
  }

  let script = String(acao.script || acao.cmd || acao.command || '').trim();
  if (!script) {
    script = allowed.includes('test')
      ? 'test'
      : allowed.includes('smoke:host')
        ? 'smoke:host'
        : allowed.includes('check')
          ? 'check'
          : allowed[0];
  }
  // aceita "npm test" / "npm run smoke:host"
  script = script.replace(/^npm\s+(run\s+)?/, '').trim();
  if (!allowed.includes(script)) {
    return {
      tipo: 'dev_run_tests',
      ok: false,
      erro: `script "${script}" fora da allowlist`,
      allowed
    };
  }

  const timeoutMs = Math.min(
    Number(acao.timeoutMs || process.env.JARVIS_TEST_TIMEOUT_MS || 90000) || 90000,
    180000
  );

  try {
    const isWin = process.platform === 'win32';
    const { stdout, stderr } = await execFileAsync(
      isWin ? 'cmd.exe' : 'npm',
      isWin ? ['/d', '/s', '/c', `npm run ${script} --silent`] : ['run', script, '--silent'],
      {
        cwd: local,
        timeout: timeoutMs,
        maxBuffer: 512 * 1024,
        env: { ...process.env, FORCE_COLOR: '0', npm_config_progress: 'false' }
      }
    );
    const out = `${stdout || ''}${stderr ? '\n' + stderr : ''}`.trim().slice(0, 3500);
    return {
      tipo: 'dev_run_tests',
      ok: true,
      project: key,
      script,
      exit_code: 0,
      output: out,
      texto: `*Testes OK* \`${key}\` · \`npm run ${script}\`\n\`\`\`\n${out || '(sem output)'}\n\`\`\``
    };
  } catch (e) {
    const out = `${e.stdout || ''}\n${e.stderr || e.message || ''}`.trim().slice(0, 3500);
    return {
      tipo: 'dev_run_tests',
      ok: false,
      project: key,
      script,
      exit_code: e.code || 1,
      output: out,
      erro: `npm run ${script} falhou`,
      texto: `*Testes FALHARAM* \`${key}\` · \`npm run ${script}\`\n\`\`\`\n${out}\n\`\`\``
    };
  }
}

async function resolveRailwayServiceTarget(acao, tipo) {
  const key = resolveProjectKey(acao);
  const meta = key ? PROJECT_MAP[key] : null;
  const serviceName =
    acao.service || acao.servico || meta?.railwayService || null;
  const projectId =
    acao.railwayProjectId || meta?.railwayProjectId || null;

  if (!projectId || !serviceName) {
    return {
      ok: false,
      tipo,
      erro: 'Informe project mapeado com Railway (ex. projeto_milhao, approtina)'
    };
  }

  try {
    const snap = await railwayProjectSnapshot(projectId);
    const project = snap?.project;
    if (!project) {
      return {
        ok: false,
        tipo,
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
        ok: false,
        tipo,
        erro: `Service ${serviceName} não achado`,
        services: services.map((s) => s.name)
      };
    }

    const envs = (project.environments?.edges || []).map((e) => e.node).filter(Boolean);
    const environment =
      envs.find((e) => /prod/i.test(e.name)) || envs[0] || null;
    if (!environment) {
      return { ok: false, tipo, erro: 'Sem environment' };
    }

    return { ok: true, key, project, service, environment };
  } catch (e) {
    return {
      ok: false,
      tipo,
      erro: e.message,
      hint: 'Confere RAILWAY_TOKEN (Account) e se o service está no PROJECT_MAP'
    };
  }
}

async function handleRailwayRedeploy(acao) {
  const target = await resolveRailwayServiceTarget(acao, 'dev_railway_redeploy');
  if (!target.ok) return target;

  const { key, project, service, environment } = target;

  try {
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

async function handleRailwayRestart(acao) {
  const target = await resolveRailwayServiceTarget(acao, 'dev_railway_restart');
  if (!target.ok) return target;

  const { key, project, service, environment } = target;

  try {
    const deployment = await railwayLatestDeployment(service.id, environment.id);
    if (!deployment?.id) {
      return {
        tipo: 'dev_railway_restart',
        ok: false,
        erro: 'Sem deployment pra reiniciar',
        service: service.name,
        environment: environment.name
      };
    }

    await railwayGraphql(
      `mutation ($id: String!) {
        deploymentRestart(id: $id)
      }`,
      { id: deployment.id }
    );

    return {
      tipo: 'dev_railway_restart',
      ok: true,
      project: key,
      railwayProject: project.name,
      service: service.name,
      environment: environment.name,
      mode: 'deploymentRestart',
      deploymentId: deployment.id,
      deploymentStatus: deployment.status || null,
      texto:
        `*Restart*\n• Projeto: **${project.name}**\n• Service: \`${service.name}\`\n` +
        `• Env: ${environment.name}\n• Deployment: \`${String(deployment.id).slice(0, 8)}\` (${deployment.status || '?'})`
    };
  } catch (e) {
    return {
      tipo: 'dev_railway_restart',
      ok: false,
      erro: e.message,
      hint: 'Confere RAILWAY_TOKEN e se há deployment ativo'
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
  if (tipo === 'dev_git_diff') return handleGitDiff(acao);
  if (tipo === 'dev_read_file') return handleReadFile(acao);
  if (tipo === 'dev_propose_patch') return handleProposePatch(acao);
  if (tipo === 'dev_apply_patch_local') return handleApplyPatchLocal(acao);
  if (tipo === 'dev_github_pr') return handleGithubPr(acao);
  if (tipo === 'dev_run_tests') return handleRunTests(acao);
  if (tipo === 'dev_deploy_checklist') return handleDeployChecklist(acao);
  if (tipo === 'dev_railway_logs') return handleRailwayLogs(acao);
  if (tipo === 'dev_railway_redeploy') return handleRailwayRedeploy(acao);
  if (tipo === 'dev_railway_restart') return handleRailwayRestart(acao);
  return null;
}

module.exports = { TYPES, handle, PROJECT_MAP };
