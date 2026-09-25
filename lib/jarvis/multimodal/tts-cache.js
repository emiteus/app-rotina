/**
 * Cache das falas do Jarvis (25/09/2026): a mesma frase com a mesma voz sai do banco — na hora e sem
 * pagar de novo ("Tranquilo, senhor. O que você precisa?", "Abri o Spotify no PC."). A chave inclui
 * provedor, voz, modelo e velocidade: trocar a voz não toca áudio velho.
 * Guarda até MAX_CHARS por frase; o que não é usado há 90 dias sai.
 */
const crypto = require('crypto');
const { requireLib } = require('../host');
const { once } = require('../db-once');

const MAX_CHARS = 600;

function db() {
  return requireLib('db');
}

const ensure = once(async () => {
  await db().run(`
    CREATE TABLE IF NOT EXISTS jarvis_tts_cache (
      chave TEXT PRIMARY KEY,
      mime TEXT NOT NULL,
      audio BYTEA NOT NULL,
      chars INT NOT NULL,
      usos INT NOT NULL DEFAULT 1,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      usado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

function cacheKey(text, variant) {
  const norm = String(text || '').trim().replace(/\s+/g, ' ');
  return crypto.createHash('sha256').update(`${variant}\n${norm}`).digest('hex');
}

/** @returns {Promise<{ buf: Buffer, mime: string }|null>} */
async function getCached(text, variant) {
  if (!text || text.length > MAX_CHARS) return null;
  try {
    await ensure();
    const k = cacheKey(text, variant);
    const row = await db().get(`SELECT mime, audio FROM jarvis_tts_cache WHERE chave = $1`, [k]);
    if (!row) return null;
    db()
      .run(`UPDATE jarvis_tts_cache SET usos = usos + 1, usado_em = CURRENT_TIMESTAMP WHERE chave = $1`, [k])
      .catch(() => {});
    return { buf: Buffer.isBuffer(row.audio) ? row.audio : Buffer.from(row.audio), mime: row.mime };
  } catch (_) {
    return null; // cache fora não impede a voz
  }
}

async function putCached(text, variant, buf, mime) {
  if (!text || text.length > MAX_CHARS || !buf || !buf.length) return;
  try {
    await ensure();
    await db().run(
      `INSERT INTO jarvis_tts_cache (chave, mime, audio, chars) VALUES ($1,$2,$3,$4)
       ON CONFLICT (chave) DO UPDATE SET usado_em = CURRENT_TIMESTAMP`,
      [cacheKey(text, variant), mime, buf, text.length]
    );
    // limpeza leve, de vez em quando
    if (Math.random() < 0.02) {
      db().run(`DELETE FROM jarvis_tts_cache WHERE usado_em < NOW() - INTERVAL '90 days'`).catch(() => {});
    }
  } catch (_) {
    /* sem cache, segue */
  }
}

module.exports = { getCached, putCached, cacheKey, MAX_CHARS };
