/**
 * Dispara mensagens pro Jarvis via webhook Evolution (como se viesse do WA).
 * Uso:
 *   railway run node scripts/jarvis-wa-probe.js "oi"
 *   railway run node scripts/jarvis-wa-probe.js --smoke
 *   railway run node scripts/jarvis-wa-probe.js --smoke-mission
 *
 * Lê a resposta no Postgres (assist_mensagens) e imprime aqui.
 */
require('dotenv').config({ quiet: true });
const { Pool } = require('pg');

const BASE =
  process.env.JARVIS_PROBE_URL ||
  process.env.APP_URL ||
  'https://app-rotina-production-f84e.up.railway.app';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function firstAllowedPhone() {
  const raw = process.env.WHATSAPP_ALLOWED_PHONES || '';
  const phones = raw
    .split(/[,;\s]+/)
    .map((p) => p.replace(/\D/g, ''))
    .filter((p) => p.length >= 12);
  return phones[0] || null;
}

function buildPayload(phone, text) {
  const jid = `${phone}@s.whatsapp.net`;
  return {
    event: 'messages.upsert',
    instance: process.env.EVOLUTION_INSTANCE || 'approtina',
    data: {
      key: {
        remoteJid: jid,
        fromMe: false,
        id: `PROBE${Date.now()}`
      },
      pushName: 'JarvisProbe',
      message: {
        conversation: text
      },
      messageType: 'conversation'
    }
  };
}

async function sendWebhook(phone, text) {
  const secret = process.env.WHATSAPP_WEBHOOK_SECRET;
  if (!secret) throw new Error('WHATSAPP_WEBHOOK_SECRET ausente (rode com railway run)');
  const url = `${BASE.replace(/\/+$/, '')}/api/whatsapp/evolution?secret=${encodeURIComponent(secret)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(buildPayload(phone, text)),
    signal: AbortSignal.timeout(20000)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`webhook HTTP ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function latestAssistantAfter(pool, conversaId, afterIso) {
  const { rows } = await pool.query(
    `SELECT role, content, criado_em
     FROM assist_mensagens
     WHERE conversa_id = $1
       AND role = 'assistant'
       AND criado_em > $2::timestamptz
     ORDER BY criado_em DESC
     LIMIT 1`,
    [conversaId, afterIso]
  );
  return rows[0] || null;
}

async function getConversaId(pool, phone) {
  const { rows } = await pool.query(
    `SELECT conversa_id FROM whatsapp_sessoes WHERE phone = $1`,
    [phone]
  );
  return rows[0]?.conversa_id || null;
}

async function waitReply(pool, phone, sinceIso, timeoutMs = 60000) {
  const t0 = Date.now();
  let conversaId = await getConversaId(pool, phone);
  while (Date.now() - t0 < timeoutMs) {
    if (!conversaId) conversaId = await getConversaId(pool, phone);
    if (conversaId) {
      // Última assistant da conversa (folga de relógio)
      const { rows } = await pool.query(
        `SELECT role, content, criado_em
         FROM assist_mensagens
         WHERE conversa_id = $1 AND role = 'assistant'
         ORDER BY criado_em DESC, id DESC
         LIMIT 1`,
        [conversaId]
      );
      const msg = rows[0];
      if (msg && new Date(msg.criado_em).getTime() >= new Date(sinceIso).getTime() - 15000) {
        return msg;
      }
    }
    await sleep(1500);
  }
  return null;
}

async function probeOnce(pool, phone, text) {
  // Folga de relógio local vs DB (Neon UTC)
  const since = new Date(Date.now() - 5000).toISOString();
  console.log(`\n>>> SEND [${phone.slice(0, 4)}…${phone.slice(-4)}]: ${text}`);
  const wh = await sendWebhook(phone, text);
  console.log('webhook', wh);
  // debounce (~1s) + LLM
  await sleep(3000);
  const reply = await waitReply(pool, phone, since, 60000);
  if (!reply) {
    console.log('<<< (sem resposta no DB a tempo — olha o WA / Railway logs)');
    return null;
  }
  const preview = String(reply.content || '').replace(/\s+/g, ' ').trim();
  console.log(`<<< [${reply.criado_em.toISOString()}] ${preview.slice(0, 600)}`);
  return reply;
}

async function main() {
  const args = process.argv.slice(2);
  const smoke = args.includes('--smoke');
  const smokeMission = args.includes('--smoke-mission');
  const texts = args.filter((a) => a !== '--smoke' && a !== '--smoke-mission');

  const phone = process.env.JARVIS_PROBE_PHONE || firstAllowedPhone();
  if (!phone) throw new Error('Sem WHATSAPP_ALLOWED_PHONES / JARVIS_PROBE_PHONE');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL ausente');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost')
      ? false
      : { rejectUnauthorized: false }
  });

  console.log('probe →', BASE);
  console.log('phone →', `${phone.slice(0, 4)}…${phone.slice(-4)}`);
  console.log(
    'hitl_wa →',
    process.env.JARVIS_HITL_WHATSAPP === '1' ? 'ON' : 'OFF (default)'
  );

  try {
    if (smokeMission) {
      // Low-risk: criar missão + status + cancelar (sem high-risk tools)
      const create = await probeOnce(
        pool,
        phone,
        'missão: atualiza o cache de snapshots do hub'
      );
      const createOk =
        create && /missão\s+criada|missão\s+\*\*/i.test(String(create.content || ''));
      console.log('assert create →', createOk ? 'PASS' : 'FAIL');
      await sleep(2000);
      const st = await probeOnce(pool, phone, 'status missão');
      const stOk = st && /progresso\s+\*\*\d+\/\d+\*\*/i.test(String(st.content || ''));
      console.log('assert status progresso →', stOk ? 'PASS' : 'FAIL');
      await sleep(1500);
      await probeOnce(pool, phone, 'cancela missão');
      if (!createOk || !stOk) process.exitCode = 2;
    } else if (smoke) {
      await probeOnce(pool, phone, 'oi');
      await sleep(2000);
      await probeOnce(
        pool,
        phone,
        'gerar acesso do cinerush tv pro email teus8599@gmail.com'
      );
    } else if (texts.length) {
      for (const t of texts) {
        await probeOnce(pool, phone, t);
        await sleep(1500);
      }
    } else {
      console.log('Uso: railway run node scripts/jarvis-wa-probe.js --smoke');
      console.log('  ou: railway run node scripts/jarvis-wa-probe.js --smoke-mission');
      console.log('  ou: railway run node scripts/jarvis-wa-probe.js "sua msg"');
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
