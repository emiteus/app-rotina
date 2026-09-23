const WebSocket = require('ws');

/**
 * WebSocket do App Rotina.
 *
 * Segurança (auditoria 2026-09-22): antes qualquer um conectava sem login, o userId vinha
 * do próprio cliente e alarmes/eventos/recorrentes iam pra TODOS os conectados.
 * Agora:
 *  - identidade = sessão do cookie (express-session), lida no upgrade; userId do cliente é ignorado
 *  - todo evento vai só pro dono (broadcastToUser); conexão sem login não recebe nada
 *  - gateways extras por path (ex.: /jarvis-device) com autenticação própria
 */
class WebSocketServer {
  constructor(httpServer) {
    this.wss = new WebSocket.Server({ noServer: true });
    this.clients = new Map(); // sessionId -> ws
    this.sessionMiddleware = null;
    this.gateways = []; // { path, authenticate(req) -> Promise<ctx|null>, onConnection(ws, ctx) }

    httpServer.on('upgrade', (req, socket, head) => {
      this.onUpgrade(req, socket, head).catch((err) => {
        console.error('[WS] upgrade:', err.message);
        socket.destroy();
      });
    });
  }

  setSessionMiddleware(mw) {
    this.sessionMiddleware = mw;
  }

  /** Canal extra com auth própria (token de dispositivo etc.). */
  addGateway(gateway) {
    this.gateways.push(gateway);
  }

  async onUpgrade(req, socket, head) {
    const pathname = new URL(req.url || '/', 'http://x').pathname;
    const gw = this.gateways.find((g) => pathname === g.path);
    if (gw) {
      const ctx = await gw.authenticate(req);
      if (!ctx) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => gw.onConnection(ws, ctx));
      return;
    }
    const userId = await this.sessionUserId(req);
    this.wss.handleUpgrade(req, socket, head, (ws) => this.onAppConnection(ws, userId));
  }

  /** userId da sessão do cookie (null se não logado / sem middleware). */
  sessionUserId(req) {
    // Dev local com SKIP_AUTH (nunca em produção — ver lib/tenant)
    const { SKIP_USER_ID } = require('./tenant');
    if (SKIP_USER_ID) return Promise.resolve(String(SKIP_USER_ID));
    const mw = this.sessionMiddleware;
    if (!mw) return Promise.resolve(null);
    return new Promise((resolve) => {
      try {
        mw(req, {}, () => resolve(req.session && req.session.userId ? String(req.session.userId) : null));
      } catch (_) {
        resolve(null);
      }
    });
  }

  onAppConnection(ws, userId) {
    ws.userId = userId;
    ws.sessionId = null;

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        this.handleMessage(ws, msg);
      } catch (err) {
        console.error('[WS] Erro ao parse mensagem:', err.message);
      }
    });

    ws.on('close', () => {
      if (ws.sessionId && this.clients.get(ws.sessionId) === ws) {
        this.clients.delete(ws.sessionId);
      }
    });

    ws.on('error', (err) => {
      console.error('[WS] Erro WebSocket:', err.message);
    });
  }

  handleMessage(ws, msg) {
    const { tipo, sessionId } = msg || {};

    if (tipo === 'auth') {
      if (!ws.userId) {
        // Conectou antes do login: o cliente reconecta pra levar o cookie novo
        ws.send(JSON.stringify({ tipo: 'auth-required' }));
        return;
      }
      if (sessionId) {
        ws.sessionId = String(sessionId).slice(0, 64);
        this.clients.set(ws.sessionId, ws);
      }
      ws.send(JSON.stringify({ tipo: 'auth-ok' }));
      return;
    }

    // Eco entre abas do MESMO usuário (antes ia pra todos os conectados)
    if (
      ws.userId &&
      (tipo === 'tarefa-atualizada' || tipo === 'transacao-adicionada' || tipo === 'alarme-disparado')
    ) {
      this.broadcastToUser(ws.userId, msg);
    }
  }

  /** Só entrega a conexões autenticadas. Pra dado de usuário, use broadcastToUser. */
  broadcast(msg) {
    const payload = JSON.stringify(msg);
    this.wss.clients.forEach((client) => {
      if (client.userId && client.readyState === WebSocket.OPEN) client.send(payload);
    });
  }

  broadcastToUser(userId, msg) {
    if (!userId) return;
    const payload = JSON.stringify(msg);
    const uid = String(userId);
    this.wss.clients.forEach((client) => {
      if (client.userId === uid && client.readyState === WebSocket.OPEN) client.send(payload);
    });
  }

  /** Ranking é agregado entre usuários (placar) — vai pra quem está logado. */
  broadcastRanking() {
    this.broadcast({ tipo: 'ranking-dia', dados: { refresh: true } });
  }

  sendToSession(sessionId, msg) {
    const client = this.clients.get(sessionId);
    if (client && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(msg));
    }
  }
}

module.exports = WebSocketServer;
