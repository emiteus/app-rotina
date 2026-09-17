#!/usr/bin/env node
/**
 * Cria/conecta a instance Evolution do App Rotina e configura o webhook.
 *
 * Uso:
 *   node scripts/setup-evolution-approtina.js
 *
 * Env necessárias:
 *   EVOLUTION_URL, EVOLUTION_API_KEY
 *   EVOLUTION_INSTANCE=approtina (default)
 *   APP_PUBLIC_URL=https://seu-app.up.railway.app
 *   WHATSAPP_WEBHOOK_SECRET=opcional
 */
require('dotenv').config({ quiet: true });

const base = String(process.env.EVOLUTION_URL || '').replace(/\/+$/, '');
const key = process.env.EVOLUTION_API_KEY || '';
const instance = process.env.EVOLUTION_INSTANCE || 'approtina';
const appUrl = String(process.env.APP_PUBLIC_URL || process.env.RAILWAY_PUBLIC_DOMAIN || '')
  .replace(/\/+$/, '');
const secret = process.env.WHATSAPP_WEBHOOK_SECRET || '';

if (!base || !key) {
  console.error('Defina EVOLUTION_URL e EVOLUTION_API_KEY');
  process.exit(1);
}

async function evo(path, opts = {}) {
  const res = await fetch(`${base}${path}`, {
    ...opts,
    headers: {
      apikey: key,
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} ${path}`);
    err.data = data;
    throw err;
  }
  return data;
}

async function main() {
  console.log('Evolution:', base);
  console.log('Instance:', instance);

  // 1) Cria instance se não existir
  try {
    await evo(`/instance/create`, {
      method: 'POST',
      body: JSON.stringify({
        instanceName: instance,
        integration: 'WHATSAPP-BAILEYS',
        qrcode: true
      })
    });
    console.log('Instance criada.');
  } catch (e) {
    console.log('create:', e.message, e.data?.message || e.data || '');
  }

  // 2) Webhook
  const webhookUrl = appUrl
    ? `${appUrl.startsWith('http') ? appUrl : `https://${appUrl}`}/api/whatsapp/evolution${secret ? `?secret=${encodeURIComponent(secret)}` : ''}`
    : null;

  if (webhookUrl) {
    try {
      await evo(`/webhook/set/${instance}`, {
        method: 'POST',
        body: JSON.stringify({
          webhook: {
            enabled: true,
            url: webhookUrl,
            webhookByEvents: false,
            webhookBase64: false,
            events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE']
          }
        })
      });
      console.log('Webhook OK →', webhookUrl);
    } catch (e) {
      // formato alternativo (algumas versões)
      try {
        await evo(`/webhook/set/${instance}`, {
          method: 'POST',
          body: JSON.stringify({
            enabled: true,
            url: webhookUrl,
            events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE']
          })
        });
        console.log('Webhook OK (formato alt) →', webhookUrl);
      } catch (e2) {
        console.error('Webhook falhou:', e2.message, e2.data);
      }
    }
  } else {
    console.log('Defina APP_PUBLIC_URL pra configurar o webhook automaticamente.');
  }

  // 3) QR / status
  try {
    const conn = await evo(`/instance/connect/${instance}`, { method: 'GET' });
    const qr = conn?.base64 || conn?.qrcode?.base64 || conn?.code;
    if (qr) {
      console.log('\n=== Escaneie o QR no WhatsApp do eSIM (número do BOT) ===');
      console.log('(base64 QR disponível na resposta da API — abra o Manager da Evolution)');
    } else {
      console.log('connect:', JSON.stringify(conn).slice(0, 300));
    }
  } catch (e) {
    console.log('connect:', e.message);
  }

  try {
    const st = await evo(`/instance/connectionState/${instance}`, { method: 'GET' });
    console.log('Estado:', st?.instance?.state || st?.state || st);
  } catch (e) {
    console.log('state:', e.message);
  }

  console.log(`
Próximos passos:
1. Abra o Evolution Manager e escaneie o QR com o WhatsApp do eSIM TIM (bot).
2. No .env do App Rotina:
   EVOLUTION_INSTANCE=${instance}
   WHATSAPP_ALLOWED_PHONES=55SEU_NUMERO_PESSOAL
3. Mande msg DO seu número pessoal PARA o número do eSIM.
`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
