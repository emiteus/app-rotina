/** Cliente Evolution API (sendText) — mesma stack do CineRush. */
function evolutionBase() {
  return String(process.env.EVOLUTION_URL || '').replace(/\/+$/, '');
}

function evolutionReady() {
  return !!(
    process.env.EVOLUTION_URL &&
    process.env.EVOLUTION_API_KEY &&
    process.env.EVOLUTION_INSTANCE
  );
}

/** Normaliza telefone BR → dígitos com país (55…). */
function normalizeWaId(input) {
  if (!input) return null;
  let d = String(input).replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('55') && d.length >= 12) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

function phonesAllowed() {
  const raw = process.env.WHATSAPP_ALLOWED_PHONES || '';
  return raw
    .split(/[,;\s]+/)
    .map((p) => normalizeWaId(p))
    .filter(Boolean);
}

function isPhoneAllowed(phone) {
  const n = normalizeWaId(phone);
  if (!n) return false;
  const list = phonesAllowed();
  if (!list.length) return false;
  return list.some((a) => a === n || a.endsWith(n) || n.endsWith(a));
}

/** Markdown leve → texto WhatsApp. */
function textoParaWhatsApp(md) {
  return String(md || '')
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/__(.+?)__/g, '*$1*')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .trim()
    .slice(0, 4000);
}

async function sendText(to, text) {
  if (!evolutionReady()) {
    throw new Error('Evolution não configurada (EVOLUTION_URL/API_KEY/INSTANCE)');
  }
  const number = normalizeWaId(to);
  if (!number) throw new Error('número inválido');
  const body = textoParaWhatsApp(text);
  if (!body) return { skipped: true };

  const url = `${evolutionBase()}/message/sendText/${process.env.EVOLUTION_INSTANCE}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: process.env.EVOLUTION_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ number, text: body, linkPreview: false }),
    signal: AbortSignal.timeout(20000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.message || data?.error || `Evolution HTTP ${res.status}`);
  }
  return data;
}

module.exports = {
  evolutionReady,
  normalizeWaId,
  phonesAllowed,
  isPhoneAllowed,
  textoParaWhatsApp,
  sendText
};
