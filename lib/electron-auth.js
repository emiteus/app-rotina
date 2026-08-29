/**
 * Credenciais locais do app desktop (Electron).
 * Senha criptografada com safeStorage (DPAPI no Windows / Keychain no macOS).
 */
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const AUTH_FILE = 'desktop-auth.json';

function authPath() {
  return path.join(app.getPath('userData'), AUTH_FILE);
}

function readAuth() {
  try {
    return JSON.parse(fs.readFileSync(authPath(), 'utf8'));
  } catch {
    return null;
  }
}

function writeAuth(data) {
  fs.mkdirSync(path.dirname(authPath()), { recursive: true });
  fs.writeFileSync(authPath(), JSON.stringify(data), 'utf8');
}

function partitionForLogin(login) {
  const safe = String(login || 'default')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .slice(0, 40);
  return `persist:rotina-${safe || 'default'}`;
}

function getSavedLogin() {
  return readAuth()?.login || null;
}

function hasStoredPassword() {
  const auth = readAuth();
  return !!(auth?.passwordEnc && safeStorage.isEncryptionAvailable());
}

function getStoredPassword() {
  const auth = readAuth();
  if (!auth?.passwordEnc || !safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(auth.passwordEnc, 'base64'));
  } catch {
    return null;
  }
}

function saveCredentials(login, password) {
  const l = String(login || '').trim().toLowerCase();
  if (!l || !password) throw new Error('Login e senha obrigatórios');
  const data = { login: l, savedAt: Date.now() };
  if (safeStorage.isEncryptionAvailable()) {
    data.passwordEnc = safeStorage.encryptString(String(password)).toString('base64');
  }
  writeAuth(data);
  return { login: l, hasPassword: !!data.passwordEnc };
}

function clearCredentials() {
  try {
    fs.unlinkSync(authPath());
  } catch {
    /* ok */
  }
}

module.exports = {
  partitionForLogin,
  getSavedLogin,
  hasStoredPassword,
  getStoredPassword,
  saveCredentials,
  clearCredentials
};
