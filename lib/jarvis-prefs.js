/**
 * Preferências persistentes do Jarvis (por user).
 */
const { get, run } = require('./db');

async function ensureJarvisPrefsTable() {
  await run(`
    CREATE TABLE IF NOT EXISTS jarvis_prefs (
      user_id TEXT PRIMARY KEY,
      tratamento TEXT,
      cumprimento_curto BOOLEAN DEFAULT true,
      extras JSONB DEFAULT '{}'::jsonb,
      atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function getJarvisPrefs(userId) {
  if (!userId) return defaultPrefs();
  await ensureJarvisPrefsTable();
  const row = await get(`SELECT * FROM jarvis_prefs WHERE user_id = $1`, [userId]);
  if (!row) return defaultPrefs();
  return {
    tratamento: row.tratamento || 'chefe',
    cumprimento_curto: row.cumprimento_curto !== false,
    extras: row.extras && typeof row.extras === 'object' ? row.extras : {}
  };
}

function defaultPrefs() {
  return {
    tratamento: 'chefe',
    cumprimento_curto: true,
    extras: {}
  };
}

async function saveJarvisPrefs(userId, patch) {
  if (!userId || !patch) return null;
  await ensureJarvisPrefsTable();
  const cur = await getJarvisPrefs(userId);
  const next = {
    tratamento: patch.tratamento != null ? String(patch.tratamento).slice(0, 40) : cur.tratamento,
    cumprimento_curto:
      patch.cumprimento_curto != null ? !!patch.cumprimento_curto : cur.cumprimento_curto,
    extras: { ...cur.extras, ...(patch.extras || {}) }
  };
  await run(
    `INSERT INTO jarvis_prefs (user_id, tratamento, cumprimento_curto, extras, atualizado_em)
     VALUES ($1,$2,$3,$4::jsonb,CURRENT_TIMESTAMP)
     ON CONFLICT (user_id) DO UPDATE SET
       tratamento = EXCLUDED.tratamento,
       cumprimento_curto = EXCLUDED.cumprimento_curto,
       extras = EXCLUDED.extras,
       atualizado_em = CURRENT_TIMESTAMP`,
    [userId, next.tratamento, next.cumprimento_curto, JSON.stringify(next.extras)]
  );
  return next;
}

/** Extrai preferências explícitas da mensagem do usuário. */
function inferirPrefsDaMensagem(mensagem) {
  const msg = String(mensagem || '');
  const out = {};

  const mTrat = msg.match(
    /(?:me\s+chame|chamar?\s+(?:de|eu)|tratamento)\s+(?:de\s+|como\s+)?["']?([A-Za-zÀ-ÿ]{2,20})["']?/i
  );
  if (mTrat) out.tratamento = mTrat[1].toLowerCase() === 'teus' ? 'Teus' : mTrat[1];

  if (/n[aã]o\s+se\s+esque[cç]a\s+de\s+me\s+chamar\s+de\s+chefe/i.test(msg) || /chame\s+de\s+chefe/i.test(msg)) {
    out.tratamento = 'chefe';
  }
  if (/\bou\s+(?:de\s+)?Teus\b/i.test(msg) && /cham/i.test(msg)) {
    out.extras = { ...(out.extras || {}), tratamento_alt: 'Teus' };
  }

  if (
    /al[oô]|cumpriment|bom\s+dia|boa\s+noite|fala\s+jarvis/i.test(msg) &&
    /n[aã]o\s+(precisa|quero|mand)|sem\s+(relat[oó]rio|resumo|tarefas|conta|saldo)/i.test(msg)
  ) {
    out.cumprimento_curto = true;
  }
  if (/sempre\s+q(?:ue)?\s+eu\s+der\s+um\s+al[oô]/i.test(msg) && /n[aã]o\s+precisa/i.test(msg)) {
    out.cumprimento_curto = true;
  }

  // Memória episódica / tom (Phase 4)
  try {
    const { inferirMemoriaDaMensagem, patchPrefsFromMemoria } = require('./jarvis/memory/episodic');
    const mem = inferirMemoriaDaMensagem(msg);
    const memPatch = patchPrefsFromMemoria(mem);
    if (memPatch && memPatch.extras) {
      out.extras = { ...(out.extras || {}), ...memPatch.extras };
    }
  } catch (_) { /* ignore */ }

  return Object.keys(out).length ? out : null;
}

module.exports = {
  ensureJarvisPrefsTable,
  getJarvisPrefs,
  saveJarvisPrefs,
  inferirPrefsDaMensagem,
  defaultPrefs
};
