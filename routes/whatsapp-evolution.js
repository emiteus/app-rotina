/**
 * Webhook Evolution → Jarvis (assistente pessoal via WhatsApp).
 * Instance separada do CineRush. Whitelist em WHATSAPP_ALLOWED_PHONES.
 */
const express = require('express');
const { get, run, all } = require('../lib/db');
const { OWNER_LOGIN } = require('../lib/plano-owner');
const {
  normalizeWaId,
  isPhoneAllowed,
  sendText,
  evolutionReady,
  textoParaWhatsApp
} = require('../lib/evolution');

const router = express.Router();

/** Debounce: junta bolhas rápidas do mesmo número. */
const pending = new Map(); // phone -> { texts: [], timer, conversaId }
const DEBOUNCE_MS = 2500;

async function ensureWhatsappTables() {
  await run(`
    CREATE TABLE IF NOT EXISTS whatsapp_sessoes (
      phone TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      conversa_id TEXT,
      atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

let tablesReady = false;
async function readyTables() {
  if (tablesReady) return;
  await ensureWhatsappTables();
  tablesReady = true;
}

async function ownerUserId() {
  const row = await get(
    `SELECT id FROM usuarios WHERE lower(login) = $1 AND ativo = true`,
    [OWNER_LOGIN]
  );
  return row?.id || null;
}

async function getOrCreateSessao(phone, userId) {
  await readyTables();
  let row = await get(`SELECT * FROM whatsapp_sessoes WHERE phone = $1`, [phone]);
  if (!row) {
    await run(
      `INSERT INTO whatsapp_sessoes (phone, user_id, conversa_id) VALUES ($1,$2,NULL)
       ON CONFLICT (phone) DO NOTHING`,
      [phone, userId]
    );
    row = await get(`SELECT * FROM whatsapp_sessoes WHERE phone = $1`, [phone]);
  }
  return row;
}

async function saveSessaoConversa(phone, conversaId) {
  await run(
    `UPDATE whatsapp_sessoes SET conversa_id = $1, atualizado_em = CURRENT_TIMESTAMP WHERE phone = $2`,
    [conversaId, phone]
  );
}

function extractTextFromMessage(msg) {
  if (!msg || typeof msg !== 'object') return '';
  if (msg.conversation) return String(msg.conversation);
  if (msg.extendedTextMessage?.text) return String(msg.extendedTextMessage.text);
  if (msg.imageMessage?.caption) return String(msg.imageMessage.caption);
  if (msg.videoMessage?.caption) return String(msg.videoMessage.caption);
  if (msg.buttonsResponseMessage?.selectedDisplayText) {
    return String(msg.buttonsResponseMessage.selectedDisplayText);
  }
  if (msg.listResponseMessage?.title) return String(msg.listResponseMessage.title);
  return '';
}

/** Normaliza payload Evolution (v1/v2) → lista de { phone, text, fromMe, isGroup }. */
function parseEvolutionPayload(body) {
  const event = String(body?.event || body?.type || '').toLowerCase();
  if (event && !event.includes('messages.upsert') && !event.includes('messages_upsert')) {
    // Alguns envios vêm sem event — ainda tenta parsear data
    if (!body?.data && !body?.message) return [];
  }

  let items = body?.data;
  if (!items) return [];
  if (!Array.isArray(items)) items = [items];

  const out = [];
  for (const item of items) {
    // Formato com key no root do item
    const key = item.key || item.message?.key || {};
    const remoteJid = String(key.remoteJid || item.remoteJid || '');
    const fromMe = !!(key.fromMe || item.fromMe);
    const isGroup = remoteJid.endsWith('@g.us') || remoteJid.includes('@g.us');
    const phone = normalizeWaId(remoteJid.replace(/@.*/, ''));
    const message = item.message || item;
    const text = extractTextFromMessage(message).trim();
    if (!phone || !text) continue;
    out.push({ phone, text, fromMe, isGroup, remoteJid });
  }
  return out;
}

function checkSecret(req) {
  const secret = process.env.WHATSAPP_WEBHOOK_SECRET;
  if (!secret) return true;
  const q = req.query?.secret;
  const h = req.get('x-webhook-secret') || req.get('apikey');
  return q === secret || h === secret;
}

async function processPhoneQueue(phone) {
  const slot = pending.get(phone);
  if (!slot) return;
  pending.delete(phone);

  const mensagem = slot.texts.join('\n').trim();
  if (!mensagem) return;

  const uid = await ownerUserId();
  if (!uid) {
    console.error('[whatsapp] owner user não encontrado:', OWNER_LOGIN);
    return;
  }

  const sessao = await getOrCreateSessao(phone, uid);
  const { processarChat } = require('./ia');

  try {
    // typing opcional — ignore errors
    const out = await processarChat({
      userId: uid,
      mensagem,
      conversaId: sessao?.conversa_id || null,
      historico: []
    });
    if (out.conversa_id) await saveSessaoConversa(phone, out.conversa_id);
    await sendText(phone, out.resposta || 'Beleza. Em que posso ajudar?');
  } catch (err) {
    console.error('[whatsapp] processarChat:', err.message);
    try {
      await sendText(phone, 'Tive um problema aqui. Tenta de novo em instantes.');
    } catch (e2) {
      console.error('[whatsapp] send error reply:', e2.message);
    }
  }
}

function enqueueMessage(phone, text) {
  let slot = pending.get(phone);
  if (!slot) {
    slot = { texts: [], timer: null };
    pending.set(phone, slot);
  }
  slot.texts.push(text);
  if (slot.timer) clearTimeout(slot.timer);
  slot.timer = setTimeout(() => {
    processPhoneQueue(phone).catch((e) => console.error('[whatsapp] queue', e.message));
  }, DEBOUNCE_MS);
}

router.get('/status', (_req, res) => {
  res.json({
    ok: true,
    evolution: evolutionReady(),
    instance: process.env.EVOLUTION_INSTANCE || null,
    allowed: (process.env.WHATSAPP_ALLOWED_PHONES || '').split(/[,;\s]+/).filter(Boolean).length
  });
});

router.post('/evolution', async (req, res) => {
  // Responde rápido pra Evolution não retentar
  if (!checkSecret(req)) {
    return res.status(401).json({ erro: 'secret inválido' });
  }
  res.status(200).json({ ok: true });

  try {
    if (!evolutionReady()) return;
    const msgs = parseEvolutionPayload(req.body || {});
    for (const m of msgs) {
      if (m.fromMe || m.isGroup) continue;
      if (!isPhoneAllowed(m.phone)) {
        console.log('[whatsapp] ignorado (fora da whitelist):', m.phone);
        continue;
      }
      enqueueMessage(m.phone, m.text);
    }
  } catch (err) {
    console.error('[whatsapp] webhook:', err.message);
  }
});

module.exports = router;
module.exports.ensureWhatsappTables = ensureWhatsappTables;
module.exports.textoParaWhatsApp = textoParaWhatsApp;
