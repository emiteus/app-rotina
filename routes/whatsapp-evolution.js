/**
 * Webhook Evolution → Jarvis (assistente pessoal via WhatsApp).
 * Instance separada do CineRush.
 * Whitelist: WHATSAPP_ALLOWED_PHONES e/ou mapa WHATSAPP_PHONE_USERS=fone:login
 */
const express = require('express');
const { get, run } = require('../lib/db');
const {
  normalizeWaId,
  sendText,
  sendApprovalButtons,
  sendWhatsAppAudio,
  sendWhatsAppImage,
  evolutionReady,
  textoParaWhatsApp,
  stripToolLeakage,
  startTypingIndicator,
  sendPresence
} = require('../lib/evolution');
const { resolveTurnMedia } = require('../lib/jarvis/multimodal/ingress');
const {
  shouldReplyWithVoice,
  synthesizeSpeech
} = require('../lib/jarvis/multimodal/tts');
const {
  resolveUserIdForPhone,
  isPhoneMappedOrAllowed,
  phoneMapStatus
} = require('../lib/jarvis/whatsapp-users');

const router = express.Router();

/** Debounce: junta bolhas rápidas do mesmo número. */
const pending = new Map(); // phone -> { texts: [], medias: [], timer }
const DEBOUNCE_MS = Number(process.env.WHATSAPP_DEBOUNCE_MS) || 1000;

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
  } else if (row.user_id !== userId) {
    await run(
      `UPDATE whatsapp_sessoes SET user_id = $1, atualizado_em = CURRENT_TIMESTAMP WHERE phone = $2`,
      [userId, phone]
    );
    row.user_id = userId;
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

  // Botões HITL / replies interativos
  const btnId =
    msg.buttonsResponseMessage?.selectedButtonId ||
    msg.templateButtonReplyMessage?.selectedId ||
    msg.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson ||
    null;
  const btnText =
    msg.buttonsResponseMessage?.selectedDisplayText ||
    msg.listResponseMessage?.title ||
    msg.templateButtonReplyMessage?.selectedDisplayText ||
    null;

  if (btnId || btnText) {
    const id = String(btnId || '').toLowerCase();
    const display = String(btnText || '').trim();
    if (/jarvis_sim|^(sim)$/i.test(id) || /^sim$/i.test(display)) {
      const m = id.match(/jarvis_sim_([a-f0-9]{6,12})/i);
      return m ? `SIM ${m[1]}` : 'SIM';
    }
    if (/jarvis_nao|jarvis_n[aã]o|^(nao|não|no)$/i.test(id) || /^n[aã]o$/i.test(display)) {
      const m = id.match(/jarvis_nao_([a-f0-9]{6,12})/i);
      return m ? `NÃO ${m[1]}` : 'NÃO';
    }
    if (display) return display;
  }
  return '';
}

/** Normaliza payload Evolution (v1/v2) → lista de { phone, text, media, fromMe, isGroup }. */
function parseEvolutionPayload(body) {
  const event = String(body?.event || body?.type || '').toLowerCase();
  if (event && !event.includes('messages.upsert') && !event.includes('messages_upsert')) {
    if (!body?.data && !body?.message) return [];
  }

  let items = body?.data;
  if (!items) return [];
  if (!Array.isArray(items)) items = [items];

  const out = [];
  for (const item of items) {
    const key = item.key || item.message?.key || {};
    const remoteJid = String(key.remoteJid || item.remoteJid || '');
    const fromMe = !!(key.fromMe || item.fromMe);
    const isGroup = remoteJid.endsWith('@g.us') || remoteJid.includes('@g.us');
    const phone = normalizeWaId(remoteJid.replace(/@.*/, ''));
    const message = item.message || item;
    const text = extractTextFromMessage(message).trim();
    let media = resolveTurnMedia(message);
    if (media && key) media.raw = { ...(media.raw || message), key };
    if (!phone) continue;
    if (!text && !media) continue;
    out.push({ phone, text, media, fromMe, isGroup, remoteJid });
  }
  return out;
}

function checkSecret(req) {
  const secret = process.env.WHATSAPP_WEBHOOK_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') return false;
    return true;
  }
  const q = req.query?.secret;
  const h = req.get('x-webhook-secret') || req.get('apikey');
  return q === secret || h === secret;
}

async function processPhoneQueue(phone) {
  const slot = pending.get(phone);
  if (!slot) return;
  pending.delete(phone);

  const mensagem = slot.texts.join('\n').trim();
  const media = slot.medias && slot.medias.length ? slot.medias[slot.medias.length - 1] : null;
  if (!mensagem && !media) return;

  const resolved = await resolveUserIdForPhone(phone);
  if (!resolved?.userId) {
    console.error('[whatsapp] sem user para phone:', phone);
    try {
      await sendText(
        phone,
        'Chefe, teu número ainda não está mapeado no Jarvis (`WHATSAPP_PHONE_USERS`). Me avisa no PC pra eu plugar.'
      );
    } catch (e) {
      console.error('[whatsapp] send unmapped reply:', e.message);
    }
    return;
  }
  const uid = resolved.userId;

  const sessao = await getOrCreateSessao(phone, uid);

  const stopTyping = startTypingIndicator(phone);
  try {
    const { runJarvisTurn } = require('../lib/jarvis');
    const out = await runJarvisTurn({
      userId: uid,
      message: mensagem || '',
      conversaId: sessao?.conversa_id || null,
      historico: [],
      channel: 'whatsapp',
      media: media || null,
      onProgress:
        process.env.JARVIS_MISSION_PROGRESS === '0'
          ? null
          : async (msg) => {
              try {
                await sendPresence(phone, 'composing', 8000);
                const clean = stripToolLeakage(String(msg || ''));
                if (!clean || clean.length < 8) return;
                await sendText(phone, `⏳ ${clean.slice(0, 800)}`);
              } catch (e) {
                console.error('[whatsapp] progress ping:', e.message);
              }
            }
    });
    if (out.conversa_id) await saveSessaoConversa(phone, out.conversa_id);
    const resposta = stripToolLeakage(out.resposta || 'Beleza. Em que posso ajudar?');
    stopTyping();
    const pendingHitl = (out.acoes || []).find((a) => a && a.pending_approval);
    const imgOk = (out.acoes || []).find(
      (a) => a && a.ok && a.tipo === 'creative_generate_image' && a.image_base64
    );

    const wantVoice = shouldReplyWithVoice({
      userText: mensagem,
      mediaKind: media?.kind || null,
      resposta,
      pendingHitl: !!pendingHitl,
      userId: uid
    });
    if (wantVoice) {
      try {
        require('../lib/jarvis/multimodal/voice-session').touchVoiceSession(uid);
      } catch {
        /* ignore */
      }
    }

    // Creative: imagem carrega a legenda — texto curto só se não for HITL
    if (imgOk && !pendingHitl) {
      const cap = String(imgOk.caption || imgOk.prompt || 'Jarvis').slice(0, 200);
      try {
        await sendWhatsAppImage(phone, imgOk.image_base64, {
          mime: imgOk.mime || 'image/png',
          caption: cap
        });
      } catch (imgErr) {
        console.error('[whatsapp] image:', imgErr.message);
        await sendText(phone, 'Gerei a imagem mas falhei no envio pelo WhatsApp — tenta de novo.');
      }
    } else {
      await sendText(phone, resposta);
      if (imgOk) {
        try {
          await sendWhatsAppImage(phone, imgOk.image_base64, {
            mime: imgOk.mime || 'image/png',
            caption: String(imgOk.caption || imgOk.prompt || 'Jarvis').slice(0, 200)
          });
        } catch (imgErr) {
          console.error('[whatsapp] image:', imgErr.message);
          try {
            await sendText(phone, 'Gerei a imagem mas falhei no envio pelo WhatsApp — tenta de novo.');
          } catch (_) {
            /* ignore */
          }
        }
      }
    }

    if (wantVoice && !imgOk) {
      try {
        const audio = await synthesizeSpeech(resposta);
        if (audio?.base64) {
          await sendWhatsAppAudio(phone, audio.base64, { delay: 800 });
        }
      } catch (ttsErr) {
        console.error('[whatsapp] tts:', ttsErr.message);
      }
    }

    // Opt-in: só manda botão se JARVIS_HITL_BUTTONS=1 (default off)
    if (pendingHitl && process.env.JARVIS_HITL_BUTTONS === '1') {
      try {
        await sendApprovalButtons(phone, resposta, pendingHitl.approval_id);
      } catch (btnErr) {
        console.error('[whatsapp] buttons:', btnErr.message);
      }
    }
  } catch (err) {
    stopTyping();
    console.error('[whatsapp] jarvis:', err.message);
    try {
      const budgetMsg =
        err.status === 429 || /or[cç]amento di[aá]rio/i.test(String(err.message || ''))
          ? `Orçamento diário do Jarvis esgotou: ${err.message}`
          : 'Tive um problema aqui. Tenta de novo em instantes.';
      await sendText(phone, budgetMsg);
    } catch (e2) {
      console.error('[whatsapp] send error reply:', e2.message);
    }
  }
}

function enqueueMessage(phone, text, media = null) {
  let slot = pending.get(phone);
  if (!slot) {
    slot = { texts: [], medias: [], timer: null };
    pending.set(phone, slot);
  }
  if (text) slot.texts.push(text);
  if (media) slot.medias.push(media);
  if (slot.timer) clearTimeout(slot.timer);
  slot.timer = setTimeout(() => {
    processPhoneQueue(phone).catch((e) => console.error('[whatsapp] queue', e.message));
  }, DEBOUNCE_MS);
}

router.get('/status', (_req, res) => {
  const map = phoneMapStatus();
  res.json({
    ok: true,
    evolution: evolutionReady(),
    instance: process.env.EVOLUTION_INSTANCE || null,
    allowed: (process.env.WHATSAPP_ALLOWED_PHONES || '').split(/[,;\s]+/).filter(Boolean).length,
    phoneUsers: map
  });
});

router.post('/evolution', async (req, res) => {
  if (!checkSecret(req)) {
    return res.status(401).json({ erro: 'secret inválido' });
  }
  res.status(200).json({ ok: true });

  try {
    if (!evolutionReady()) {
      console.error('[whatsapp] evolution off — webhook ignorado');
      return;
    }
    const msgs = parseEvolutionPayload(req.body || {});
    for (const m of msgs) {
      if (m.fromMe || m.isGroup) continue;
      if (!isPhoneMappedOrAllowed(m.phone)) {
        console.log('[whatsapp] ignorado (fora da whitelist/mapa):', m.phone);
        try {
          await sendText(
            m.phone,
            'Esse número ainda não está na whitelist do Jarvis. Me avisa no PC pra liberar.'
          );
        } catch (e) {
          console.error('[whatsapp] reply whitelist:', e.message);
        }
        continue;
      }
      enqueueMessage(m.phone, m.text, m.media || null);
    }
  } catch (err) {
    console.error('[whatsapp] webhook:', err.message);
  }
});

module.exports = router;
module.exports.ensureWhatsappTables = ensureWhatsappTables;
module.exports.textoParaWhatsApp = textoParaWhatsApp;
