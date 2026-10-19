/**
 * Log único do app. Só acrescenta. Cada linha carrega o hash da anterior,
 * assinado com SESSION_SECRET (ou AUDIT_LOG_KEY). Quem apaga ou edita uma linha
 * quebra a cadeia. Uma cópia curta vai para o stdout (log do Railway), que o
 * app não consegue apagar.
 *
 * Não grava senha, token, código de pareamento, áudio nem conteúdo de arquivo.
 */
const crypto = require('crypto');
const { pool } = require('./db');

const GENESIS = 'genesis';
const LOCK_KEY = 814202614;
const SECRET_KEY = /senha|password|token|secret|authorization|apikey|api_key|cookie|base64|audio|hash|^code$|client_secret|refresh/i;
const VALOR_CURTO = new Set(['login', 'usuario', 'nome', 'tipo', 'para', 'pasta', 'arquivo', 'acao']);

let ready = null;
let armed = false;

function arm() {
  armed = true;
}

function hmacKey() {
  const k = String(process.env.AUDIT_LOG_KEY || process.env.SESSION_SECRET || '');
  if (k.length >= 32) return k;
  if (process.env.NODE_ENV === 'production') return null;
  return 'dev-audit-key-not-for-production!!';
}

function redactText(value) {
  return String(value || '')
    .replace(/\b(jdv_|Bearer\s+)[A-Za-z0-9_\-]+/gi, '$1[redigido]')
    .replace(/\b(sk-|ghp_|xox[baprs]-)[A-Za-z0-9_\-]+/g, '[redigido]')
    .slice(0, 180);
}

function safeBody(body) {
  if (Buffer.isBuffer(body)) return { bytes: body.length };
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  const chaves = [];
  const out = {};
  for (const k of Object.keys(body).slice(0, 30)) {
    if (SECRET_KEY.test(k)) continue;
    chaves.push(k);
    const v = body[k];
    if (VALOR_CURTO.has(k) && typeof v === 'string') out[k] = redactText(v).slice(0, 80);
  }
  if (chaves.length) out.chaves = chaves;
  return out;
}

function sign(prev, fields) {
  const key = hmacKey();
  const payload = `${prev}\n${JSON.stringify(fields)}`;
  if (!key) return { prev, hash: 'sem-chave', signed: false };
  return {
    prev,
    hash: crypto.createHmac('sha256', key).update(payload).digest('hex'),
    signed: true
  };
}

async function ensure() {
  if (!ready) {
    ready = pool.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id BIGSERIAL PRIMARY KEY,
        ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        actor_id TEXT,
        actor_login TEXT,
        ip TEXT,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        status INTEGER,
        ok BOOLEAN NOT NULL,
        detalhe TEXT,
        prev_hash TEXT,
        row_hash TEXT NOT NULL
      )
    `).catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

/**
 * @param {{ actorId?: string|null, actorLogin?: string|null, ip?: string|null,
 *   method: string, path: string, status?: number|null, ok: boolean, detalhe?: object }} ev
 */
async function record(ev) {
  if (!armed) return;
  const fields = {
    actorId: ev.actorId ? String(ev.actorId).slice(0, 64) : null,
    actorLogin: ev.actorLogin ? String(ev.actorLogin).slice(0, 40) : null,
    ip: ev.ip ? String(ev.ip).slice(0, 64) : null,
    method: String(ev.method || '?').slice(0, 8),
    path: String(ev.path || '/').slice(0, 200),
    status: Number.isFinite(ev.status) ? ev.status : null,
    ok: !!ev.ok,
    detalhe: JSON.stringify(ev.detalhe || {}).slice(0, 600)
  };

  let id = null;
  let hash = 'sem-chave';
  const client = await pool.connect();
  try {
    await ensure();
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);
    const prevRow = await client.query('SELECT row_hash FROM audit_log ORDER BY id DESC LIMIT 1');
    const prev = prevRow.rows[0]?.row_hash || GENESIS;
    const signed = sign(prev, fields);
    hash = signed.hash;
    const ins = await client.query(
      `INSERT INTO audit_log
        (actor_id, actor_login, ip, method, path, status, ok, detalhe, prev_hash, row_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id`,
      [
        fields.actorId,
        fields.actorLogin,
        fields.ip,
        fields.method,
        fields.path,
        fields.status,
        fields.ok,
        fields.detalhe,
        signed.prev,
        hash
      ]
    );
    id = ins.rows[0]?.id || null;
    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    console.error('[audit] não gravei:', e.message);
  } finally {
    client.release();
  }

  console.log(JSON.stringify({
    tag: 'audit',
    id,
    hash,
    actor: fields.actorLogin || fields.actorId || 'anon',
    ip: fields.ip,
    method: fields.method,
    path: fields.path,
    status: fields.status,
    ok: fields.ok
  }));
}

function recordHttp(req, status) {
  const loginTentado = req.path.startsWith('/api/auth') && typeof req.body?.login === 'string'
    ? redactText(req.body.login).slice(0, 40)
    : null;
  return record({
    actorId: req.session?.userId || null,
    actorLogin: req.session?.userLogin || loginTentado,
    ip: req.ip || null,
    method: req.method,
    path: req.path,
    status,
    ok: status < 400,
    detalhe: safeBody(req.body)
  });
}

function recordTool({ userId, login, tipo, ok, channel, erro, pending }) {
  return record({
    actorId: userId || null,
    actorLogin: login || null,
    ip: null,
    method: 'TOOL',
    path: `jarvis/${String(tipo || '?').slice(0, 80)}`,
    status: ok ? 200 : 400,
    ok: !!ok,
    detalhe: {
      canal: channel ? String(channel).slice(0, 24) : null,
      pendente: !!pending,
      erro: erro ? redactText(erro) : null
    }
  });
}

async function list({ limit = 100, before = null } = {}) {
  await ensure();
  const n = Math.max(1, Math.min(Number(limit) || 100, 200));
  const params = [n];
  let where = '';
  if (before) {
    params.push(Number(before));
    where = 'WHERE id < $2';
  }
  const rows = await pool.query(
    `SELECT id, ts, actor_id, actor_login, ip, method, path, status, ok, detalhe, row_hash
     FROM audit_log ${where}
     ORDER BY id DESC
     LIMIT $1`,
    params
  );
  return rows.rows.map((r) => ({
    id: Number(r.id),
    ts: r.ts,
    actorId: r.actor_id,
    actorLogin: r.actor_login,
    ip: r.ip,
    method: r.method,
    path: r.path,
    status: r.status,
    ok: r.ok,
    detalhe: r.detalhe,
    hash: String(r.row_hash || '').slice(0, 12)
  }));
}

/** Confere a cadeia do mais antigo ao mais novo. Apagar a última linha não aparece aqui; o hash dela fica no log do Railway. */
async function verify({ limit = 2000 } = {}) {
  await ensure();
  const n = Math.max(1, Math.min(Number(limit) || 2000, 5000));
  const rows = await pool.query(
    `SELECT id, actor_id, actor_login, ip, method, path, status, ok, detalhe, prev_hash, row_hash
     FROM (
       SELECT * FROM audit_log ORDER BY id DESC LIMIT $1
     ) recent
     ORDER BY id ASC`,
    [n]
  );
  let prev = null;
  for (const r of rows.rows) {
    if (prev != null && r.prev_hash !== prev) {
      return { ok: false, motivo: 'cadeia quebrada', id: Number(r.id), checadas: rows.rows.length };
    }
    if (r.row_hash === 'sem-chave') {
      return { ok: false, motivo: 'linha sem assinatura', id: Number(r.id), checadas: rows.rows.length };
    }
    const fields = {
      actorId: r.actor_id,
      actorLogin: r.actor_login,
      ip: r.ip,
      method: r.method,
      path: r.path,
      status: r.status,
      ok: r.ok,
      detalhe: r.detalhe
    };
    const expectedPrev = r.prev_hash || GENESIS;
    const again = sign(expectedPrev, fields);
    if (again.hash !== r.row_hash) {
      return { ok: false, motivo: 'linha alterada', id: Number(r.id), checadas: rows.rows.length };
    }
    prev = r.row_hash;
  }
  const ultima = rows.rows[rows.rows.length - 1];
  return {
    ok: true,
    checadas: rows.rows.length,
    ultimoId: ultima ? Number(ultima.id) : null,
    ultimoHash: ultima ? ultima.row_hash : null
  };
}

function shouldLogHttp(req, status) {
  if (req.path === '/health' || !req.path.startsWith('/api/')) return false;
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return status >= 400;
  return true;
}

module.exports = {
  arm,
  record,
  recordHttp,
  recordTool,
  list,
  verify,
  shouldLogHttp,
  safeBody,
  redactText
};
