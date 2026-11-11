/**
 * Pausa de avisos por grupo (11/11/2026). O vigia continua olhando (pra saber quando volta),
 * só não avisa enquanto o grupo estiver pausado. Interruptor no banco (jarvis_ops_flags,
 * projeto "jarvis_alertas"): sobrevive a deploy e dá pra ligar/desligar pela tool ops_alertas.
 */
const PROJETO = 'jarvis_alertas';
const DONO = 'owner'; // pausa vale pro Jarvis inteiro (os crons nem sempre sabem o usuário)

const GRUPOS = {
  hetzner: 'servidor da Hetzner (WhatsApp do Jarvis e cinerush.app fora do ar)',
  cinerush_tv: 'clientes do CineRush TV (assinantes pendentes e créditos do Havok)'
};

// Pausados enquanto ninguém mexeu no interruptor (o Mateus pediu pra pausar os dois em 11/11/2026).
// "voltar" grava enabled=true no banco e passa a valer o banco.
const PADRAO_PAUSADO = new Set(['hetzner', 'cinerush_tv']);

const ALIAS = {
  hetzner: 'hetzner', vps: 'hetzner', servidor: 'hetzner', 'servidor da hetzner': 'hetzner', whatsapp: 'hetzner', 'cinerush.app': 'hetzner',
  cinerush_tv: 'cinerush_tv', 'cinerush tv': 'cinerush_tv', cinerush: 'cinerush_tv', clientes: 'cinerush_tv', 'clientes do cinerush': 'cinerush_tv', havok: 'cinerush_tv', assinantes: 'cinerush_tv'
};

function grupoDe(nome) {
  const k = String(nome || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
  return ALIAS[k] || (GRUPOS[k] ? k : null);
}

const store = () => require('./flags/store');

async function pausados() {
  const rows = await store().listFlags(DONO, PROJETO);
  const out = new Set([...PADRAO_PAUSADO].filter((g) => !rows.some((r) => r && r.key === g)));
  for (const r of rows) if (r && r.enabled === false && GRUPOS[r.key]) out.add(r.key);
  return out;
}

async function definir(grupo, pausar, nota = null) {
  const g = grupoDe(grupo);
  if (!g) throw new Error(`grupo de aviso: ${Object.keys(GRUPOS).join(' | ')}`);
  await store().upsertFlag(DONO, PROJETO, g, { enabled: !pausar, note: nota });
  return g;
}

/** Tira os avisos de grupos pausados. Banco fora do ar: vale o padrão. */
async function filtrar(notes) {
  if (!notes || !notes.length) return notes || [];
  let p;
  try {
    p = await pausados();
  } catch (_) {
    p = PADRAO_PAUSADO;
  }
  return p.size ? notes.filter((n) => !n || !n.grupo || !p.has(n.grupo)) : notes;
}

module.exports = { GRUPOS, grupoDe, pausados, definir, filtrar, PROJETO, DONO };
