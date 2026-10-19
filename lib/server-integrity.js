/**
 * Integridade do processo. Na subida, tira o hash dos arquivos que decidem
 * segurança. Enquanto o processo vive, compara de novo. Troca de arquivo no
 * disco aparece aqui e no log. Não lê valor de segredo, só se ele existe.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ARQUIVOS = [
  'package.json',
  'server.js',
  'routes/auth.js',
  'routes/audit.js',
  'routes/jarvis-device.js',
  'routes/whatsapp-evolution.js',
  'routes/openfinance.js',
  'lib/audit-log.js',
  'lib/password.js',
  'lib/secret-eq.js',
  'lib/plano-owner.js',
  'lib/server-integrity.js',
  'lib/jarvis/permissions/engine.js',
  'lib/jarvis/devices/gateway.js',
  'lib/jarvis/devices/store.js',
  'lib/jarvis/tools/definitions.js'
];

const INTERVALO_MS = 15 * 60 * 1000;

let boot = null;
let timer = null;
let ultimoAlerta = null;

function sha256Arquivo(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
}

function hashesAgora() {
  const out = {};
  for (const rel of ARQUIVOS) out[rel] = sha256Arquivo(rel);
  return out;
}

function fingerprintDe(hashes, commit) {
  const linhas = Object.keys(hashes).sort().map((k) => `${k}:${hashes[k] || 'ausente'}`);
  linhas.push(`commit:${commit || 'local'}`);
  return crypto.createHash('sha256').update(linhas.join('\n')).digest('hex');
}

function definido(nome) {
  return String(process.env[nome] || '').trim().length > 0;
}

function riscos() {
  const prod = process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT === 'production';
  const lista = [];
  if (String(process.env.SKIP_AUTH || '').toLowerCase() === 'true') lista.push('SKIP_AUTH ligado');
  if (String(process.env.SESSION_SECRET || '').length < 32) lista.push('SESSION_SECRET ausente ou curto');
  if (prod && !definido('WHATSAPP_WEBHOOK_SECRET')) lista.push('webhook do WhatsApp sem segredo');
  if (prod && !definido('PLUGGY_WEBHOOK_SECRET')) lista.push('webhook do Pluggy sem segredo');
  if (prod && !definido('REGISTRATION_CODE') && !definido('CODIGO_CADASTRO')) lista.push('cadastro sem código de convite');
  if (prod && process.env.NODE_ENV !== 'production') lista.push('Railway em production com NODE_ENV diferente');
  return lista;
}

function versao() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || null;
  } catch (_) {
    return null;
  }
}

function capture() {
  const commit = process.env.RAILWAY_GIT_COMMIT_SHA || null;
  const hashes = hashesAgora();
  boot = {
    em: new Date().toISOString(),
    hashes,
    commit,
    fingerprint: fingerprintDe(hashes, commit)
  };
  return boot;
}

function report() {
  if (!boot) capture();
  const agora = hashesAgora();
  const alterados = [];
  const ausentes = [];
  for (const rel of ARQUIVOS) {
    if (!agora[rel]) ausentes.push(rel);
    else if (boot.hashes[rel] && agora[rel] !== boot.hashes[rel]) alterados.push(rel);
    else if (!boot.hashes[rel] && agora[rel]) alterados.push(rel);
  }
  const lista = riscos();
  if (alterados.length) lista.push('arquivo mudou depois da subida');
  if (ausentes.length) lista.push('arquivo de segurança ausente');
  return {
    ok: lista.length === 0,
    bootEm: boot.em,
    agora: new Date().toISOString(),
    uptimeSeg: Math.round(process.uptime()),
    versao: versao(),
    commit: boot.commit,
    deployment: process.env.RAILWAY_DEPLOYMENT_ID || null,
    replica: process.env.RAILWAY_REPLICA_ID || null,
    node: process.version,
    ambiente: process.env.NODE_ENV || null,
    fingerprint: boot.fingerprint,
    fingerprintAgora: fingerprintDe(agora, boot.commit),
    riscos: lista,
    alterados,
    ausentes,
    segredos: {
      sessao: String(process.env.SESSION_SECRET || '').length >= 32,
      whatsapp: definido('WHATSAPP_WEBHOOK_SECRET'),
      pluggy: definido('PLUGGY_WEBHOOK_SECRET'),
      convite: definido('REGISTRATION_CODE') || definido('CODIGO_CADASTRO')
    }
  };
}

function publicar(motivo) {
  const r = report();
  console.log(JSON.stringify({
    tag: 'server.integrity',
    motivo,
    ok: r.ok,
    fingerprint: r.fingerprintAgora,
    commit: r.commit,
    riscos: r.riscos,
    alterados: r.alterados
  }));
  return r;
}

function vigiar() {
  const r = report();
  if (r.ok) {
    ultimoAlerta = null;
    return;
  }
  const chave = JSON.stringify([r.riscos, r.alterados, r.ausentes]);
  if (chave === ultimoAlerta) return;
  ultimoAlerta = chave;
  publicar('deriva');
  try {
    require('./audit-log').record({
      method: 'CHECK',
      path: 'servidor',
      ok: false,
      detalhe: { riscos: r.riscos, alterados: r.alterados, ausentes: r.ausentes }
    }).catch(() => {});
  } catch (_) { /* log ainda não armado */ }
}

function start() {
  capture();
  const r = publicar('subida');
  try {
    require('./audit-log').record({
      method: 'BOOT',
      path: 'servidor',
      ok: r.ok,
      status: r.ok ? 200 : 500,
      detalhe: {
        fingerprint: r.fingerprint,
        commit: r.commit,
        riscos: r.riscos
      }
    }).catch(() => {});
  } catch (_) { /* ignore */ }
  if (timer) clearInterval(timer);
  timer = setInterval(vigiar, INTERVALO_MS);
  timer.unref();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, report, capture, ARQUIVOS };
