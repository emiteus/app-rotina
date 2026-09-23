/**
 * Gateway WebSocket do Jarvis Desktop (Fase 2 MCU) — path /jarvis-device.
 * O PC conecta DE DENTRO PRA FORA (sem abrir porta) com o token do pareamento.
 *
 * Protocolo (JSON):
 *  PC → nuvem: { type:'chat', id, text } · { type:'ping' }
 *  nuvem → PC: { type:'hello', deviceId, name } · { type:'reply', id, text, approval?, images? }
 *              { type:'error', id?, message } · { type:'pong' } · { type:'notify', text }
 */
const store = require('./store');

const PATH = '/jarvis-device';
const MAX_TEXT = 4000;
const RATE_PER_MIN = 20;
const HEARTBEAT_MS = 30 * 1000;
const MAX_IMAGE_B64 = 4 * 1024 * 1024;

/** deviceId -> ws (uma conexão ativa por aparelho) */
const connections = new Map();

function bearer(req) {
  const h = String((req.headers && req.headers.authorization) || '');
  const m = h.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

/** Resposta do turno → payload enxuto pro PC. */
function replyPayload(id, out) {
  const acoes = (out && out.acoes) || [];
  const pending = acoes.find((a) => a && a.pending_approval);
  const images = acoes
    .filter((a) => a && a.ok && a.image_base64 && String(a.image_base64).length <= MAX_IMAGE_B64)
    .slice(0, 2)
    .map((a) => ({ mime: a.mime || 'image/png', base64: a.image_base64, caption: a.caption || null }));
  return {
    type: 'reply',
    id,
    text: String((out && out.resposta) || ''),
    approval: pending
      ? { id: pending.approval_id, tipos: [...new Set(acoes.filter((a) => a.pending_approval).map((a) => a.tipo))] }
      : null,
    images: images.length ? images : undefined
  };
}

/**
 * @param {{ runTurn?: Function }} [deps] — injetável pra teste; padrão = core.runJarvisTurn
 */
function createGateway(deps = {}) {
  const runTurn = deps.runTurn || ((opts) => require('../core').runJarvisTurn(opts));

  async function authenticate(req) {
    const token = bearer(req);
    if (!token) return null;
    try {
      return await store.authenticateToken(token);
    } catch (e) {
      console.error('[jarvis.device] auth:', e.message);
      return null;
    }
  }

  function onConnection(ws, device) {
    const prev = connections.get(device.id);
    if (prev && prev !== ws) {
      try {
        prev.close(4000, 'nova conexão do mesmo aparelho');
      } catch (_) {
        /* ignore */
      }
    }
    connections.set(device.id, ws);
    ws.jarvisDevice = device;

    let conversaId = device.conversaId;
    let chain = Promise.resolve();
    const hits = [];
    let alive = true;

    const beat = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      try {
        ws.ping();
      } catch (_) {
        /* ignore */
      }
    }, HEARTBEAT_MS);
    ws.on('pong', () => {
      alive = true;
    });

    send(ws, { type: 'hello', deviceId: device.id, name: device.name });
    console.log(JSON.stringify({ tag: 'jarvis.device', event: 'online', deviceId: device.id, userId: device.userId }));

    ws.on('message', (raw) => {
      alive = true;
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        send(ws, { type: 'error', message: 'JSON inválido' });
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'ping') {
        send(ws, { type: 'pong' });
        return;
      }
      if (msg.type !== 'chat') {
        send(ws, { type: 'error', id: msg.id, message: `tipo não suportado: ${String(msg.type).slice(0, 30)}` });
        return;
      }
      const id = String(msg.id || '').slice(0, 64) || null;
      const text = String(msg.text || '').trim();
      if (!text) return send(ws, { type: 'error', id, message: 'mensagem vazia' });
      if (text.length > MAX_TEXT) return send(ws, { type: 'error', id, message: 'mensagem longa demais' });

      const now = Date.now();
      while (hits.length && now - hits[0] > 60000) hits.shift();
      if (hits.length >= RATE_PER_MIN) {
        return send(ws, { type: 'error', id, message: 'muitas mensagens em 1 minuto — espera um pouco' });
      }
      hits.push(now);

      // Um turno por vez por aparelho (mesma regra do WhatsApp)
      chain = chain
        .then(async () => {
          const out = await runTurn({
            userId: device.userId,
            message: text,
            conversaId,
            historico: [],
            channel: 'desktop'
          });
          if (out && out.conversa_id && out.conversa_id !== conversaId) {
            conversaId = out.conversa_id;
            store.setDeviceConversa(device.id, conversaId).catch(() => {});
          }
          send(ws, replyPayload(id, out));
        })
        .catch((err) => {
          console.error('[jarvis.device] turn:', err.message);
          send(ws, {
            type: 'error',
            id,
            message:
              err.status === 429 ? String(err.message) : 'Tive um problema aqui. Tenta de novo em instantes.'
          });
        });
    });

    ws.on('close', () => {
      clearInterval(beat);
      if (connections.get(device.id) === ws) connections.delete(device.id);
      console.log(JSON.stringify({ tag: 'jarvis.device', event: 'offline', deviceId: device.id }));
    });
    ws.on('error', (e) => console.error('[jarvis.device] ws:', e.message));
  }

  return { path: PATH, authenticate, onConnection };
}

/** Revogou → derruba a conexão na hora. */
function disconnectDevice(deviceId, reason = 'aparelho revogado') {
  const ws = connections.get(deviceId);
  if (!ws) return false;
  try {
    ws.close(4001, reason);
  } catch (_) {
    /* ignore */
  }
  connections.delete(deviceId);
  return true;
}

/** Aviso proativo pros PCs online do usuário (Fase 5 usa). */
function notifyUserDevices(userId, text) {
  let n = 0;
  for (const ws of connections.values()) {
    if (ws.jarvisDevice && ws.jarvisDevice.userId === String(userId)) {
      send(ws, { type: 'notify', text: String(text || '') });
      n += 1;
    }
  }
  return n;
}

function onlineDeviceIds(userId = null) {
  return [...connections.values()]
    .filter((ws) => ws.jarvisDevice && (!userId || ws.jarvisDevice.userId === String(userId)))
    .map((ws) => ws.jarvisDevice.id);
}

module.exports = {
  PATH,
  createGateway,
  replyPayload,
  disconnectDevice,
  notifyUserDevices,
  onlineDeviceIds
};
