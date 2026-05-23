require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const session = require('express-session');
const { initDB } = require('./lib/db');
const { router: authRouter, requireAuth } = require('./routes/auth');
const WebSocketServer = require('./lib/websocket');
const schedule = require('node-schedule');

const app = express();
const PORT = process.env.PORT || 3000;
const httpServer = http.createServer(app);

// Inicializa WebSocket
const wsServer = new WebSocketServer(httpServer);

// Middleware
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'seu-secret-aqui-mudar-em-producao',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 dias
  }
}));

// Rotas publicas
app.use('/api/auth', authRouter);

// Rotas privadas (requerem autenticacao)
const tasksRouter = require('./routes/tasks');
const financeiroRouter = require('./routes/financeiro');
const alarmesRouter = require('./routes/alarmes');

// Passar wsServer para as rotas
tasksRouter.setWsServer(wsServer);
financeiroRouter.setWsServer(wsServer);
alarmesRouter.setWsServer(wsServer);

app.use('/api/tasks', requireAuth, tasksRouter);
app.use('/api/financeiro', requireAuth, financeiroRouter);
app.use('/api/alarmes', requireAuth, alarmesRouter);

// Arquivos estaticos (index.html nao requer auth, auth.js vai verificar)
app.use(express.static('public'));

// Cria pasta data se nao existir
if (!fs.existsSync('./data')) fs.mkdirSync('./data');

// Inicializa BD
initDB();

// HTML principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Agendador de alarmes (verifica a cada minuto)
schedule.scheduleJob('*/1 * * * *', async () => {
  const { all } = require('./lib/db');
  const now = new Date();
  const horaAtual = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const alarmes = await all(`SELECT * FROM alarmes WHERE ativo = true AND hora = $1`, [horaAtual]);

  alarmes.forEach(alarme => {
    enviarTelegram(alarme.mensagem);
  });
});

// Resetar tarefas todos os dias a 00:01
schedule.scheduleJob('1 0 * * *', async () => {
  const { run } = require('./lib/db');
  const hoje = new Date().toISOString().split('T')[0];
  await run(
    `UPDATE tasks SET concluida = false, data_reset = $1 WHERE data_reset IS NULL OR DATE(data_reset) < DATE('now')`,
    [`${hoje} 00:00:00`]
  );
  console.log('Tarefas resetadas para novo dia');
});

// Enviar mensagem Telegram
function enviarTelegram(mensagem) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId || token === 'dummy' || chatId === 'dummy') {
    console.log('[INFO] Telegram nao configurado. Mensagem nao enviada:', mensagem);
    return;
  }

  const axios = require('axios');
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  axios.post(url, {
    chat_id: chatId,
    text: mensagem
  }).catch(err => console.error('Erro Telegram:', err.message));
}

// Inicia servidor HTTP + WebSocket
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando em http://0.0.0.0:${PORT}`);
  console.log(`WebSocket disponível em ws://0.0.0.0:${PORT}`);
});

module.exports = { app, httpServer, wsServer, enviarTelegram };
