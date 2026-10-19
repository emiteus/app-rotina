const crypto = require('crypto');

/** Compara segredo de webhook sem vazar tamanho pelo tempo. Vazio nunca confere. */
function secretEquals(got, expected) {
  const a = Buffer.from(String(got || ''));
  const b = Buffer.from(String(expected || ''));
  if (!b.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { secretEquals };
