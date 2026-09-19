/**
 * Episodic memory v1 (Phase 4) — short notes in jarvis_prefs.extras.notas
 */
const MAX_NOTAS = 20;

function normalizeNota(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/**
 * Infer memory writes from user message.
 * "lembra que X" / "não esquece que X" / "anota que X"
 */
function inferirMemoriaDaMensagem(mensagem) {
  const msg = String(mensagem || '').trim();
  const out = {};

  const mLembra = msg.match(
    /(?:lembra(?:\s+que)?|n[aã]o\s+esque[cç]a(?:\s+que)?|anota(?:\s+que)?|anota\s*:|nota\s*:|guarda(?:\s+que)?|prefiro\s+que)\s*[:\-]?\s*(.+)$/i
  );
  if (mLembra) {
    const raw = mLembra[1];
    if (!/me\s+chamar|chame\s+de|tratamento/i.test(raw)) {
      const nota = normalizeNota(raw);
      if (nota.length >= 4) out.nota = nota;
    }
  }

  if (/\btom\s+(mais\s+)?direto\b/i.test(msg)) out.tom = 'direto';
  if (/\btom\s+(mais\s+)?detalhado\b/i.test(msg) || /\bmais\s+detalhe/i.test(msg)) {
    out.tom = 'detalhado';
  }

  if (
    /\besquece\s+(o\s+que|isso|essa\s+nota|minhas\s+notas|tudo)\b/i.test(msg) ||
    /\blimpa\s+(as\s+)?notas\b/i.test(msg)
  ) {
    out.limparNotas = true;
  }

  return Object.keys(out).length ? out : null;
}

function aplicarMemoriaEmExtras(extras, memoria) {
  const next = { ...(extras || {}) };
  if (!memoria) return next;

  if (memoria.limparNotas) {
    next.notas = [];
  }
  if (memoria.nota) {
    const list = Array.isArray(next.notas) ? [...next.notas] : [];
    const entry = { t: new Date().toISOString(), text: memoria.nota };
    const low = memoria.nota.toLowerCase();
    const filtered = list.filter((n) => {
      const text = typeof n === 'string' ? n : n && n.text;
      return String(text || '').toLowerCase() !== low;
    });
    filtered.unshift(entry);
    next.notas = filtered.slice(0, MAX_NOTAS);
  }
  if (memoria.tom) next.tom = memoria.tom;
  return next;
}

function patchPrefsFromMemoria(memoria) {
  if (!memoria) return null;
  const extras = aplicarMemoriaEmExtras({}, memoria);
  // Only return extras keys we set
  const patch = { extras: {} };
  if (memoria.limparNotas || memoria.nota) patch.extras.notas = extras.notas || [];
  if (memoria.tom) patch.extras.tom = memoria.tom;
  return Object.keys(patch.extras).length ? patch : null;
}

module.exports = {
  inferirMemoriaDaMensagem,
  aplicarMemoriaEmExtras,
  patchPrefsFromMemoria,
  normalizeNota,
  MAX_NOTAS
};
