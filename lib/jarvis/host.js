/**
 * Host bridge — resolves App Rotina libs/routes whether:
 * 1) synced at app-rotina/lib/jarvis (sibling ../db.js), or
 * 2) running from R:\Projetos\Jarvis\src (points at Approtina/app-rotina).
 */
const path = require('path');
const fs = require('fs');

function detectLayout() {
  const syncedDb = path.join(__dirname, '..', 'db.js');
  if (fs.existsSync(syncedDb)) {
    // lib/jarvis → ../../.. = Approtina, ../../../.. = R:\Projetos
    return {
      name: 'approtina',
      layout: 'synced',
      libRoot: path.join(__dirname, '..'),
      routesRoot: path.join(__dirname, '..', '..', 'routes'),
      projetosRoot:
        process.env.PROJETOS_ROOT ||
        path.resolve(__dirname, '..', '..', '..', '..')
    };
  }

  const projetos =
    process.env.PROJETOS_ROOT || path.resolve(__dirname, '..', '..');
  const appRotina = path.join(projetos, 'Approtina', 'app-rotina');
  return {
    name: 'approtina',
    layout: 'package',
    libRoot: path.join(appRotina, 'lib'),
    routesRoot: path.join(appRotina, 'routes'),
    projetosRoot: projetos
  };
}

let host = detectLayout();

function setHost(opts = {}) {
  host = { ...host, ...opts };
  return host;
}

function getHost() {
  return { ...host };
}

function requireLib(name) {
  const base = String(name).replace(/\.js$/, '');
  if (host.libRoot) {
    const p = path.join(host.libRoot, base);
    if (fs.existsSync(p + '.js') || fs.existsSync(p)) {
      return require(p);
    }
  }
  // last resort: sibling of jarvis (synced layout without setHost)
  return require(path.join(__dirname, '..', base));
}

function requireRoutes(name) {
  const base = String(name).replace(/\.js$/, '');
  if (host.routesRoot) {
    const p = path.join(host.routesRoot, base);
    if (fs.existsSync(p + '.js') || fs.existsSync(p)) {
      return require(p);
    }
  }
  return require(path.join(__dirname, '..', '..', 'routes', base));
}

function requireConnector(name) {
  const base = String(name).replace(/\.js$/, '');
  // Package source of truth first (Jarvis/connectors)
  const fromPackage = path.join(__dirname, '..', 'connectors', base);
  if (fs.existsSync(fromPackage + '.js')) return require(fromPackage);
  if (host.libRoot) {
    const p = path.join(host.libRoot, base);
    if (fs.existsSync(p + '.js')) return require(p);
  }
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
  projetosRoot,
  detectLayout
};
