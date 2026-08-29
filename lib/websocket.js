const WebSocket = require('ws');

class WebSocketServer {
  constructor(httpServer) {
    this.wss = new WebSocket.Server({ server: httpServer });
    this.clients = new Map();
    this.clientUsers = new Map();

    this.wss.on('connection', (ws) => {
      console.log('[WS] Novo cliente conectado');

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data);
          this.handleMessage(ws, msg);
        } catch (err) {
          console.error('[WS] Erro ao parse mensagem:', err);
        }
      });

      ws.on('close', () => {
        for (const [sessionId, client] of this.clients) {
          if (client === ws) {
            this.clients.delete(sessionId);
            this.clientUsers.delete(sessionId);
            console.log('[WS] Cliente desconectado:', sessionId);
          }
        }
      });

      ws.on('error', (err) => {
        console.error('[WS] Erro WebSocket:', err);
      });
    });
  }

  handleMessage(ws, msg) {
    const { tipo, sessionId, dados } = msg;

    if (tipo === 'auth') {
      this.clients.set(sessionId, ws);
      if (dados && dados.userId) this.clientUsers.set(sessionId, String(dados.userId));
      ws.send(JSON.stringify({ tipo: 'auth-ok' }));
      console.log('[WS] Cliente autenticado:', sessionId, dados?.userId || '');
      return;
    }

    if (tipo === 'tarefa-atualizada' || tipo === 'transacao-adicionada' || tipo === 'alarme-disparado') {
      this.broadcast(msg);
    }
  }

  broadcast(msg) {
    const payload = JSON.stringify(msg);
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    });
  }

  broadcastToUser(userId, msg) {
    if (!userId) return;
    const payload = JSON.stringify(msg);
    for (const [sessionId, client] of this.clients) {
      if (this.clientUsers.get(sessionId) === userId && client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

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
