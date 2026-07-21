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
const iaRouter = require('./routes/ia');
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
app.use('/api/ia', requireAuth, iaRouter);

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

// Wrapper de crons — captura throw e avisa por Telegram (se configurado)
// e por push (sempre disponível), pra você não descobrir falha de madrugada.
function runCron(nome, fn) {
  return async function () {
    try {
      await fn();
    } catch (err) {
      console.error(`[cron:${nome}] falhou:`, err && err.stack || err);
      const msg = `⚠️ Cron "${nome}" falhou: ${(err && err.message) || err}`;
      try { enviarTelegram(msg); } catch (e) {}
      try { await enviarPush('⚠️ Falha em cron', `${nome}: ${(err && err.message) || err}`.slice(0, 120), '/'); } catch (e) {}
    }
  };
}

// Gate global de crons — set CRONS_ENABLED=false no Railway pra pausar TUDO
// (usado quando o Neon Postgres estoura quota mensal e queries são recusadas)
const CRONS_ENABLED = process.env.CRONS_ENABLED !== 'false';
if (!CRONS_ENABLED) console.log('[cron] CRONS_ENABLED=false — todos os jobs desligados');
function sched(cron, fn) {
  if (!CRONS_ENABLED) return;
  return schedule.scheduleJob(cron, fn);
}

// Agendador de alarmes (verifica a cada minuto)
sched('*/1 * * * *', runCron('alarmes', async () => {
  const { all } = require('./lib/db');
  const now = new Date();
  const horaAtual = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const alarmes = await all(`SELECT * FROM alarmes WHERE ativo = true AND hora = $1`, [horaAtual]);

  alarmes.forEach(alarme => {
    enviarTelegram(alarme.mensagem);
  });
}));

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
sched('5 0 * * *', runCron('recorrentes', gerarRecorrentesHoje));
if (CRONS_ENABLED) setTimeout(gerarRecorrentesHoje, 3000); // Executa 3s apos servidor iniciar

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
// 3x/dia: 6h, 14h30 (pós-refresh do Pluggy), 20h — pra pegar Nubank cedo
// (Inter PF/PJ só sincronizam manualmente no meu.pluggy.ai enquanto Meu Pluggy)
sched('0 6 * * *', runCron('of-sync-6h', syncOpenFinanceDiario));
sched('30 14 * * *', runCron('of-sync-14h30', syncOpenFinanceDiario));
sched('0 20 * * *', runCron('of-sync-20h', syncOpenFinanceDiario));

// 9h30 — alerta pra reconectar itens sem sync há > 48h (Meu Pluggy só)
sched('30 9 * * *', runCron('reconectar-alerta', async () => {
  try {
    const { all } = require('./lib/db');
    const stales = await all(`
      SELECT COALESCE(apelido, connector_nome, 'Banco') AS nome, ultima_sync
      FROM openfinance_items
      WHERE status = 'ativo'
        AND next_auto_sync IS NULL
        AND (ultima_sync IS NULL OR ultima_sync < NOW() - INTERVAL '48 hours')
      ORDER BY ultima_sync ASC NULLS FIRST
    `);
    if (!stales.length) return;
    const top = stales[0];
    const horas = top.ultima_sync ? Math.round((Date.now() - new Date(top.ultima_sync).getTime()) / 36e5) : null;
    const dias = horas ? Math.floor(horas / 24) : null;
    const quando = dias ? `${dias} dia(s)` : (horas ? `${horas}h` : 'muito tempo');
    const extra = stales.length > 1 ? ` (+${stales.length - 1})` : '';
    await enviarPush(
      '🔄 Reconectar banco',
      `${top.nome} sem sincronizar há ${quando}${extra} — abre em meu.pluggy.ai`,
      '/#financeiro'
    );
  } catch (e) {
    console.error('[Reconectar] Erro:', e.message);
  }
}));

// Alertas diários de gasto incomum (10h) — só dispara push se tiver alerta relevante
sched('0 10 * * *', runCron('alertas-gasto', async () => {
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
}));

// Orçamento estourado — 21h, checa cada limite do app_estado.orcamentos
sched('0 21 * * *', runCron('orcamento-estourado', async () => {
  try {
    const { get, all } = require('./lib/db');
    const row = await get(`SELECT valor FROM app_estado WHERE chave = 'orcamentos'`);
    if (!row || !row.valor) return;
    let limites;
    try { limites = JSON.parse(row.valor); } catch { return; }
    const cats = Object.keys(limites || {}).filter(k => Number(limites[k]) > 0);
    if (!cats.length) return;
    const ym = new Date().toISOString().slice(0, 7);
    const gastos = await all(
      `SELECT categoria, COALESCE(SUM(valor),0) AS total
       FROM financeiro
       WHERE tipo = 'saida' AND TO_CHAR(data, 'YYYY-MM') = $1
       GROUP BY categoria`,
      [ym]
    );
    const gastoDe = {};
    gastos.forEach(g => { gastoDe[g.categoria] = Number(g.total); });
    const estouradas = cats
      .filter(c => (gastoDe[c] || 0) > Number(limites[c]))
      .map(c => ({ cat: c, gasto: gastoDe[c] || 0, limite: Number(limites[c]) }));
    if (!estouradas.length) return;
    const top = estouradas.sort((a, b) => (b.gasto - b.limite) - (a.gasto - a.limite))[0];
    const pct = Math.round((top.gasto / top.limite - 1) * 100);
    const brl = top.gasto.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const extra = estouradas.length > 1 ? ` (+${estouradas.length - 1})` : '';
    await enviarPush('💸 Orçamento estourado', `${top.cat}: R$ ${brl} — ${pct}% acima do limite${extra}`, '/#financeiro');
  } catch (e) {
    console.error('[Orçamento] Erro:', e.message);
  }
}));

// Resumo diário 20h — tarefas do dia + saldo movimentado
sched('0 20 * * *', runCron('resumo-diario', async () => {
  try {
    const { get } = require('./lib/db');
    const hoje = new Date().toISOString().slice(0, 10);
    const tarefas = await get(
      `SELECT COUNT(*)::int AS total,
              SUM(CASE WHEN concluida THEN 1 ELSE 0 END)::int AS concluidas
       FROM tasks WHERE TO_CHAR(data_reset, 'YYYY-MM-DD') = $1`,
      [hoje]
    );
    const mov = await get(
      `SELECT COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor END),0) AS entradas,
              COALESCE(SUM(CASE WHEN tipo='saida'   THEN valor END),0) AS saidas
       FROM financeiro WHERE data = $1`,
      [hoje]
    );
    const t = tarefas || { total: 0, concluidas: 0 };
    const m = mov || { entradas: 0, saidas: 0 };
    const partes = [];
    if (t.total > 0) partes.push(`${t.concluidas}/${t.total} tarefas`);
    if (Number(m.saidas) > 0) partes.push(`gastou R$ ${Number(m.saidas).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    if (Number(m.entradas) > 0) partes.push(`entrou R$ ${Number(m.entradas).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    if (!partes.length) return; // dia vazio, não incomoda
    await enviarPush('📊 Resumo do dia', partes.join(' · '), '/');
  } catch (e) {
    console.error('[Resumo] Erro:', e.message);
  }
}));

// DAS do MEI — se estiver entre dia 17 e 19 e não pago, lembra às 9h
sched('0 9 * * *', runCron('das-reminder', async () => {
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
}));

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
