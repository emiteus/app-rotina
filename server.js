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

// Confia no proxy do Railway/etc — necessário pra cookies HTTPS
app.set('trust proxy', 1);

// Inicializa WebSocket
const wsServer = new WebSocketServer(httpServer);

// Middleware
app.use(express.json());

// Health check (Railway usa pra saber se o container tá vivo)
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));


app.use(session({
  secret: process.env.SESSION_SECRET || 'seu-secret-aqui-mudar-em-producao',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 dias
  }
}));

// Rotas publicas
app.use('/api/auth', authRouter);

// Rotas privadas (requerem autenticacao)
const tasksRouter = require('./routes/tasks');
const financeiroRouter = require('./routes/financeiro');
const alarmesRouter = require('./routes/alarmes');
const recorrentesRouter = require('./routes/recorrentes');
const eventosRouter = require('./routes/eventos');
const openfinanceRouter = require('./routes/openfinance');
const categoriasRouter = require('./routes/categorias');
const estadoRouter = require('./routes/estado');
const apostasRouter = require('./routes/apostas');
const metasRouter = require('./routes/metas');
const pjRouter = require('./routes/pj');
const relatoriosRouter = require('./routes/relatorios');
const pushRouter = require('./routes/push');
const { enviarPush } = require('./lib/push');

// Passar wsServer para as rotas
tasksRouter.setWsServer(wsServer);
financeiroRouter.setWsServer(wsServer);
alarmesRouter.setWsServer(wsServer);
recorrentesRouter.setWsServer(wsServer);
eventosRouter.setWsServer(wsServer);
openfinanceRouter.setWsServer(wsServer);

// Todas as APIs abaixo exigem login (/api/auth é público pra permitir fazer o próprio login)
app.use('/api/tasks', requireAuth, tasksRouter);
app.use('/api/financeiro', requireAuth, financeiroRouter);
app.use('/api/alarmes', requireAuth, alarmesRouter);
app.use('/api/recorrentes', requireAuth, recorrentesRouter);
app.use('/api/eventos', requireAuth, eventosRouter);
app.use('/api/openfinance', requireAuth, openfinanceRouter);
app.use('/api/categorias', requireAuth, categoriasRouter);
app.use('/api/estado', requireAuth, estadoRouter);
app.use('/api/apostas', requireAuth, apostasRouter);
app.use('/api/metas', requireAuth, metasRouter);
app.use('/api/pj', requireAuth, pjRouter);
app.use('/api/relatorios', requireAuth, relatoriosRouter);
app.use('/api/push', requireAuth, pushRouter);

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

// Nota: removido o job que arrastava tarefas antigas pra "hoje" (bug).
// Cada tarefa fica na data em que foi criada; não concluídas ficam registradas
// como não concluídas naquele dia — não migram pro próximo.

// Gerar tarefas recorrentes do dia (00:05 e na inicializacao)
async function gerarRecorrentesHoje() {
  try {
    const { run, get, all } = require('./lib/db');
    const { v4: uuid } = require('uuid');
    const hoje = new Date();
    const diaSemana = hoje.getDay().toString();
    const hojeStr = hoje.toISOString().split('T')[0];
    const recorrentes = await all(`SELECT * FROM tarefas_recorrentes WHERE ativa = true`);
    let criadas = 0;
    for (const r of recorrentes) {
      const dias = (r.dias_semana || '0,1,2,3,4,5,6').split(',');
      if (!dias.includes(diaSemana)) continue;
      if (r.ultima_criacao) {
        const ultima = new Date(r.ultima_criacao).toISOString().split('T')[0];
        if (ultima === hojeStr) continue;
      }
      const taskId = uuid();
      await run(
        `INSERT INTO tasks (id, titulo, descricao, prioridade, categoria, data_reset)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [taskId, r.titulo, r.descricao || '', r.prioridade, r.categoria, `${hojeStr} 00:00:00`]
      );
      await run(`UPDATE tarefas_recorrentes SET ultima_criacao = $1 WHERE id = $2`, [hojeStr, r.id]);
      criadas++;
    }
    if (criadas > 0) console.log(`[Recorrentes] ${criadas} tarefa(s) gerada(s) hoje`);
  } catch (err) {
    console.error('[Recorrentes] Erro:', err.message);
  }
}
schedule.scheduleJob('5 0 * * *', gerarRecorrentesHoje);
setTimeout(gerarRecorrentesHoje, 3000); // Executa 3s apos servidor iniciar

// Sync automático diário do Open Finance (após o auto-refresh do Pluggy ~14h)
async function syncOpenFinanceDiario() {
  try {
    if (!openfinanceRouter.temCredenciais || !openfinanceRouter.temCredenciais()) return;
    const r = await openfinanceRouter.syncAll();
    if (r && r.erro) { console.error('[OpenFinance] Erro no sync automático:', r.erro); return; }
    if (!r || r.semItems) return;
    console.log(`[OpenFinance] Sync automático: ${r.importadas} nova(s) transação(ões)`);
    if (r.importadas > 0) {
      const { all } = require('./lib/db');
      const hoje = new Date().toISOString().slice(0, 10);
      const apostas = await all(
        `SELECT COALESCE(SUM(valor),0) AS total, COUNT(*)::int AS qtd
         FROM financeiro WHERE data = $1 AND categoria = 'apostas' AND tipo = 'saida'`,
        [hoje]
      );
      const linha = apostas && apostas[0];
      if (linha && linha.qtd > 0) {
        const brl = Number(linha.total).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        await enviarPush('Apostas de hoje', `Você registrou ${linha.qtd} aposta(s) — R$ ${brl}`, '/#financeiro');
      } else {
        await enviarPush('Sync do dia', `${r.importadas} nova(s) transação(ões) sincronizadas`, '/#financeiro');
      }
    }
  } catch (e) {
    console.error('[OpenFinance] Erro no sync automático:', e.message);
  }
}
schedule.scheduleJob('30 14 * * *', syncOpenFinanceDiario);

// Alertas diários de gasto incomum (10h) — só dispara push se tiver alerta relevante
schedule.scheduleJob('0 10 * * *', async () => {
  try {
    const { all } = require('./lib/db');
    const rows = await all(`
      SELECT TO_CHAR(data, 'YYYY-MM') AS mes, categoria, SUM(valor) AS total
      FROM financeiro
      WHERE tipo = 'saida' AND data >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '4 months'
      GROUP BY mes, categoria
    `);
    const mesAtual = new Date().toISOString().substring(0, 7);
    const porCat = {};
    rows.forEach(r => {
      if (!porCat[r.categoria]) porCat[r.categoria] = { atual: 0, anteriores: [] };
      if (r.mes === mesAtual) porCat[r.categoria].atual = Number(r.total);
      else porCat[r.categoria].anteriores.push(Number(r.total));
    });
    const alertas = [];
    Object.entries(porCat).forEach(([cat, d]) => {
      if (!d.anteriores.length || d.atual <= 0) return;
      const media = d.anteriores.reduce((s, v) => s + v, 0) / d.anteriores.length;
      if (media > 0 && d.atual > media * 1.5 && (d.atual - media) > 50) {
        alertas.push({ categoria: cat, atual: d.atual, media, diferenca: d.atual - media });
      }
    });
    if (alertas.length) {
      alertas.sort((a, b) => b.diferenca - a.diferenca);
      const top = alertas[0];
      const acima = Math.round((top.atual / top.media - 1) * 100);
      const brl = Number(top.atual).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const extra = alertas.length > 1 ? ` (+${alertas.length - 1} categoria(s))` : '';
      await enviarPush(
        'Gasto acima da média',
        `${top.categoria}: R$ ${brl} — ${acima}% acima da média${extra}`,
        '/#financeiro'
      );
    }
  } catch (e) {
    console.error('[Alertas] Erro:', e.message);
  }
});

// DAS do MEI — se estiver entre dia 17 e 19 e não pago, lembra às 9h
schedule.scheduleJob('0 9 * * *', async () => {
  try {
    const hoje = new Date();
    const dia = hoje.getDate();
    if (dia < 17 || dia > 19) return;
    const { get } = require('./lib/db');
    const ym = hoje.toISOString().slice(0, 7);
    const das = await get(`SELECT pago FROM mei_das WHERE ym = $1`, [ym]);
    if (das && das.pago) return;
    const faltam = 20 - dia;
    const msg = faltam === 0 ? 'DAS vence hoje!' : `DAS vence em ${faltam} dia(s) (dia 20)`;
    await enviarPush('Lembrete DAS', msg, '/#pj');
  } catch (e) {
    console.error('[DAS Reminder] Erro:', e.message);
  }
});

// Enviar mensagem Telegram
function enviarTelegram(mensagem) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId || token === 'dummy' || chatId === 'dummy') {
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
