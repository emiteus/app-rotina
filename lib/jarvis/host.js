/**
 * Host bridge — App Rotina (ou outro host) registra roots no boot.
 * Quando o OS roda sincronizado dentro de app-rotina/lib/jarvis, o fallback
 * relativo continua válido mesmo sem setHost.
 */
const path = require('path');
const fs = require('fs');

let host = {
  name: 'approtina',
  libRoot: null,
  routesRoot: null,
  projetosRoot: process.env.PROJETOS_ROOT || path.resolve(__dirname, '..', '..', '..')
};

function setHost(opts = {}) {
  host = { ...host, ...opts };
  return host;
}

function getHost() {
  return { ...host };
}

function requireLib(name) {
  if (host.libRoot) return require(path.join(host.libRoot, name));
  // synced at app-rotina/lib/jarvis → sibling libs in ../
  return require(path.join(__dirname, '..', name));
}

function requireRoutes(name) {
  if (host.routesRoot) return require(path.join(host.routesRoot, name));
  return require(path.join(__dirname, '..', '..', 'routes', name));
}

function requireConnector(name) {
  const base = String(name).replace(/\.js$/, '');
  if (host.libRoot) {
    const p = path.join(host.libRoot, base);
    if (fs.existsSync(p + '.js')) return require(p);
  }
  const fromPackage = path.join(__dirname, '..', 'connectors', base);
  if (fs.existsSync(fromPackage + '.js')) return require(fromPackage);
  return require(path.join(__dirname, '..', base));
}

function projetosRoot() {
  return host.projetosRoot;
}

module.exports = {
  setHost,
  getHost,
  requireLib,
  requireRoutes,
  requireConnector,
  projetosRoot
};
