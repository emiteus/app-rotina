/**
 * Trava contra loop de ferramenta (ideia do OpenJarvis, 06/10/2026).
 * Se a mesma ação (tipo + args) rodar com sucesso e o modelo pedir de novo
 * na mesma janela, bloqueia — a menos que a mensagem diga "de novo/repete".
 */
const crypto = require('crypto');

const WINDOW_MS = Number(process.env.JARVIS_LOOP_GUARD_MS) || 10 * 60 * 1000;
const MAX_HITS = Number(process.env.JARVIS_LOOP_GUARD_MAX) || 1; // 1 sucesso recente = bloqueia a 2ª

/** userId -> Map<sig, { at, count }> */
const recent = new Map();

const VOLATEIS = new Set(['pergunta', 'question', 'motivo', 'reason', 'explicacao', 'porque']);

function signature(acao) {
  const norm = (v) => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') {
      return Object.keys(v)
        .sort()
        .reduce((o, k) => {
          if (!VOLATEIS.has(k) && v[k] !== undefined && v[k] !== null && v[k] !== '') o[k] = norm(v[k]);
          return o;
        }, {});
    }
    return typeof v === 'string' ? v.trim().toLowerCase() : v;
  };
  const body = JSON.stringify({ tipo: acao && acao.tipo, args: norm(acao || {}) });
  return crypto.createHash('sha256').update(body).digest('hex').slice(0, 24);
}

function prune(userId, now) {
  const m = recent.get(userId);
  if (!m) return;
  for (const [k, v] of m) {
    if (now - v.at > WINDOW_MS) m.delete(k);
  }
  if (!m.size) recent.delete(userId);
}

/** Marca ações que rodaram com sucesso (chame depois do batch com as acoes originais). */
function recordSuccesses(userId, acoesRodadas, results) {
  if (!userId || !Array.isArray(results)) return;
  const now = Date.now();
  prune(userId, now);
  let m = recent.get(userId);
  if (!m) {
    m = new Map();
    recent.set(userId, m);
  }
  const fila = new Map();
  for (const a of acoesRodadas || []) {
    if (!a || !a.tipo) continue;
    const list = fila.get(a.tipo) || [];
    list.push(a);
    fila.set(a.tipo, list);
  }
  for (const r of results) {
    if (!r || !r.ok || !r.tipo) continue;
    const list = fila.get(r.tipo);
    const a = (list && list.shift()) || r;
    const sig = signature(a);
    const cur = m.get(sig) || { at: 0, count: 0 };
    m.set(sig, { at: now, count: cur.count + 1 });
  }
}

/**
 * Filtra ações que já rodaram iguais há pouco.
 * @returns {{ allowed: object[], blocked: object[] }}
 */
function filterRepeats(userId, acoes, { allowRepeat = false } = {}) {
  if (allowRepeat || !userId || !Array.isArray(acoes) || !acoes.length) {
    return { allowed: acoes || [], blocked: [] };
  }
  const now = Date.now();
  prune(userId, now);
  const m = recent.get(userId);
  if (!m || !m.size) return { allowed: acoes, blocked: [] };

  const allowed = [];
  const blocked = [];
  for (const a of acoes) {
    const sig = signature(a);
    const hit = m.get(sig);
    if (hit && now - hit.at <= WINDOW_MS && hit.count >= MAX_HITS) {
      const min = Math.max(1, Math.round((now - hit.at) / 60000));
      blocked.push({
        tipo: a.tipo,
        ok: false,
        loop_guard: true,
        erro: `já fiz isso há ${min} min — não repeti pra não entrar em loop. Se quiser de novo, diz "repete"`
      });
    } else {
      allowed.push(a);
    }
  }
  if (blocked.length) {
    console.log(
      JSON.stringify({
        tag: 'jarvis.tool',
        event: 'loop_guard',
        userId,
        tipos: blocked.map((b) => b.tipo)
      })
    );
  }
  return { allowed, blocked };
}

/** Só testes. */
function _reset() {
  recent.clear();
}

module.exports = { signature, recordSuccesses, filterRepeats, _reset, WINDOW_MS, MAX_HITS };
