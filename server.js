require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { initDB } = require('./lib/db');
const schedule = require('node-schedule');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Cria pasta data se nao existir
if (!fs.existsSync('./data')) fs.mkdirSync('./data');

// Inicializa BD
initDB();

// Rotas
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/financeiro', require('./routes/financeiro'));
app.use('/api/alarmes', require('./routes/alarmes'));

// HTML principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Agendador de alarmes (verifica a cada minuto)
schedule.scheduleJob('*/1 * * * *', async () => {
  const { all } = require('./lib/db');
  const now = new Date();
  const horaAtual = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const alarmes = await all(`SELECT * FROM alarmes WHERE ativo = 1 AND hora = ?`, [horaAtual]);

  alarmes.forEach(alarme => {
    enviarTelegram(alarme.mensagem);
  });
});

// Resetar tarefas todos os dias a 00:01
schedule.scheduleJob('1 0 * * *', async () => {
  const { run } = require('./lib/db');
  const hoje = new Date().toISOString().split('T')[0];
  await run(
    `UPDATE tasks SET concluida = 0, data_reset = ? WHERE data_reset IS NULL OR DATE(data_reset) < DATE('now')`,
    [`${hoje} 00:00:00`]
  );
  console.log('Tarefas resetadas para novo dia');
});

// Enviar mensagem Telegram
function enviarTelegram(mensagem) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.log('Telegram nao configurado. Mensagem:', mensagem);
    return;
  }

  const axios = require('axios');
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  axios.post(url, {
    chat_id: chatId,
    text: mensagem
  }).catch(err => console.error('Erro Telegram:', err.message));
}

// Inicia servidor
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando em http://0.0.0.0:${PORT}`);
});

module.exports = { app, enviarTelegram };
