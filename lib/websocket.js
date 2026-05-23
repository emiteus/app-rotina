const WebSocket = require('ws');

class WebSocketServer {
  constructor(httpServer) {
    this.wss = new WebSocket.Server({ server: httpServer });
    this.clients = new Map(); // Map de sessionId -> WebSocket

    this.wss.on('connection', (ws, req) => {
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
        // Remove cliente ao desconectar
        for (const [sessionId, client] of this.clients) {
          if (client === ws) {
            this.clients.delete(sessionId);
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
      // Registra cliente autenticado
      this.clients.set(sessionId, ws);
      ws.send(JSON.stringify({ tipo: 'auth-ok' }));
      console.log('[WS] Cliente autenticado:', sessionId);
      return;
    }

    // Broadcast para o cliente (sincronização)
    if (tipo === 'tarefa-atualizada' || tipo === 'transacao-adicionada' || tipo === 'alarme-disparado') {
      this.broadcast(msg);
    }
  }

  // Envia para todos os clientes conectados
  broadcast(msg) {
    const payload = JSON.stringify(msg);
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  }

  // Envia para um cliente específico
  sendToSession(sessionId, msg) {
    const client = this.clients.get(sessionId);
    if (client && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(msg));
    }
  }
}

module.exports = WebSocketServer;
