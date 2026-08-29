const crypto = require('crypto');

const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };

function hashSenha(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(senha), salt, 64, SCRYPT_OPTS).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

function verificarSenha(senha, armazenada) {
  if (!armazenada || !String(armazenada).startsWith('scrypt:')) return false;
  const parts = String(armazenada).split(':');
  if (parts.length !== 3) return false;
  const salt = parts[1];
  const esperado = parts[2];
  const hash = crypto.scryptSync(String(senha), salt, 64, SCRYPT_OPTS).toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(esperado, 'hex'));
  } catch (e) {
    return false;
  }
}

module.exports = { hashSenha, verificarSenha };
