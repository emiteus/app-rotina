const express = require('express');
const { v4: uuid } = require('uuid');
const { run, get, all } = require('../lib/db');
const { checkinHabito, resumoHabito, listarHabitos, analisarConsistencia } = require('../lib/habitos');
const { persistirHistoricoDia } = require('../lib/historico');
const { hojeStr, dataResetSql, ymdDe } = require('../lib/datas');
const { requireUserId } = require('../lib/tenant');

let wsServer;
const router = express.Router();

function emitTaskUpdate(tipo, dados, userId) {
  if (!wsServer) return;
  if (userId) wsServer.broadcastToUser(userId, { tipo: 'tarefa-' + tipo, dados });
  wsServer.broadcastRanking();
}

router.get('/', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const tasks = await all(`
      SELECT * FROM tasks
      WHERE user_id = $1
        AND (DATE(data_reset) >= CURRENT_DATE - INTERVAL '1 day' OR data_reset IS NULL)
      ORDER BY
        DATE(data_reset) ASC,
        CASE prioridade WHEN 'alta' THEN 1 WHEN 'media' THEN 2 WHEN 'baixa' THEN 3 ELSE 4 END,
        concluida, data_criacao
    `, [uid]);
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.get('/habitos', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    res.json(await listarHabitos(uid));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.get('/habito', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const titulo = String(req.query.titulo || 'Academia').trim() || 'Academia';
    res.json(await resumoHabito(titulo, uid));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.get('/historico', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    let historico = await all(`
      SELECT data, total, concluidas, por_categoria, por_prioridade
      FROM task_historico
      WHERE user_id = $1 AND data >= CURRENT_DATE - INTERVAL '30 days'
      ORDER BY data ASC
    `, [uid]);
    if (!historico.length) {
      historico = await all(`
        SELECT DATE(data_reset) AS data,
          COUNT(*)::int AS total,
          SUM(CASE WHEN concluida THEN 1 ELSE 0 END)::int AS concluidas,
          '{}'::jsonb AS por_categoria, '{}'::jsonb AS por_prioridade
        FROM tasks
        WHERE user_id = $1 AND data_reset IS NOT NULL
          AND DATE(data_reset) >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY DATE(data_reset) ORDER BY DATE(data_reset) ASC
      `, [uid]);
    }
    res.json(historico);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.get('/stats', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const completo = req.query.completo === '1' || req.query.dias === '0';
    const dias = completo
      ? null
      : Math.min(Math.max(Number(req.query.dias) || 90, 7), 365);
    const histRows = completo
      ? await all(`
      SELECT data, total, concluidas
      FROM task_historico
      WHERE user_id = $1 AND total > 0
      ORDER BY data ASC
    `, [uid])
      : await all(`
      SELECT data, total, concluidas
      FROM task_historico
      WHERE user_id = $1 AND data >= CURRENT_DATE - ($2::int * INTERVAL '1 day')
      ORDER BY data ASC
    `, [uid, dias]);
    const liveRows = completo
      ? await all(`
      SELECT DATE(data_reset) AS data,
        COUNT(*)::int AS total,
        SUM(CASE WHEN concluida THEN 1 ELSE 0 END)::int AS concluidas
      FROM tasks
      WHERE user_id = $1 AND data_reset IS NOT NULL
      GROUP BY DATE(data_reset) ORDER BY DATE(data_reset) ASC
    `, [uid])
      : await all(`
      SELECT DATE(data_reset) AS data,
        COUNT(*)::int AS total,
        SUM(CASE WHEN concluida THEN 1 ELSE 0 END)::int AS concluidas
      FROM tasks
      WHERE user_id = $1 AND data_reset IS NOT NULL
        AND DATE(data_reset) >= CURRENT_DATE - ($2::int * INTERVAL '1 day')
      GROUP BY DATE(data_reset) ORDER BY DATE(data_reset) ASC
    `, [uid, dias]);

    const byDay = new Map();
    histRows.forEach((h) => {
      const d = ymdDe(h.data);
      if (!d) return;
      byDay.set(d, {
        data: d,
        total: Number(h.total) || 0,
        concluidas: Number(h.concluidas) || 0
      });
    });
    liveRows.forEach((h) => {
      const d = ymdDe(h.data);
      if (!d) return;
      byDay.set(d, {
        data: d,
        total: Number(h.total) || 0,
        concluidas: Number(h.concluidas) || 0
      });
    });
    const historico = [...byDay.values()].sort((a, b) => a.data.localeCompare(b.data));

    const catRows = completo
      ? await all(`
      SELECT COALESCE(categoria,'geral') AS c, COUNT(*)::int AS n FROM tasks
      WHERE user_id = $1 AND data_reset IS NOT NULL
      GROUP BY COALESCE(categoria,'geral')
    `, [uid])
      : await all(`
      SELECT COALESCE(categoria,'geral') AS c, COUNT(*)::int AS n FROM tasks
      WHERE user_id = $1 AND data_reset IS NOT NULL
        AND DATE(data_reset) >= CURRENT_DATE - ($2::int * INTERVAL '1 day')
      GROUP BY COALESCE(categoria,'geral')
    `, [uid, dias]);
    const priRows = completo
      ? await all(`
      SELECT COALESCE(prioridade,'media') AS p, COUNT(*)::int AS n FROM tasks
      WHERE user_id = $1 AND data_reset IS NOT NULL
      GROUP BY COALESCE(prioridade,'media')
    `, [uid])
      : await all(`
      SELECT COALESCE(prioridade,'media') AS p, COUNT(*)::int AS n FROM tasks
      WHERE user_id = $1 AND data_reset IS NOT NULL
        AND DATE(data_reset) >= CURRENT_DATE - ($2::int * INTERVAL '1 day')
      GROUP BY COALESCE(prioridade,'media')
    `, [uid, dias]);

    const categorias = {};
    catRows.forEach(r => { categorias[r.c] = r.n; });
    const prioridades = { alta: 0, media: 0, baixa: 0 };
    priRows.forEach(r => { prioridades[r.p] = r.n; });

    let totalCriadas = 0, totalConcluidas = 0;
    let melhorDia = { data: null, taxa: 0, total: 0 };
    let piorDia = { data: null, taxa: 100, total: 0 };
    historico.forEach(h => {
      totalCriadas += h.total;
      totalConcluidas += h.concluidas;
      const taxa = h.total > 0 ? (h.concluidas / h.total) * 100 : 0;
      if (h.total >= 3 && taxa > melhorDia.taxa) melhorDia = { data: h.data, taxa, total: h.total };
      if (h.total >= 3 && taxa < piorDia.taxa) piorDia = { data: h.data, taxa, total: h.total };
    });

    let streak = 0;
    const historicoDesc = [...historico].reverse();
    const hoje = hojeStr();
    for (let i = 0; i < historicoDesc.length; i++) {
      const h = historicoDesc[i];
      const hStr = ymdDe(h.data);
      if (i === 0 && hStr === hoje && h.concluidas === 0) continue;
      if (h.concluidas > 0) streak++;
      else break;
    }

    const diasComTarefas = historico.length;
    const taxaMedia = totalCriadas > 0 ? Math.round((totalConcluidas / totalCriadas) * 100) : 0;
    const mediaPorDia = diasComTarefas > 0 ? (totalConcluidas / diasComTarefas).toFixed(1) : 0;
    const consistencia = await analisarConsistencia(completo ? 90 : dias, uid).catch(() => null);

    res.json({
      historico,
      dias: completo ? historico.length : dias,
      completo,
      resumo: { totalCriadas, totalConcluidas, taxaMedia, mediaPorDia, diasAtivos: diasComTarefas, streak, melhorDia, piorDia },
      categorias, prioridades, consistencia
    });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.get('/consistencia', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    res.json(await analisarConsistencia(Number(req.query.dias) || 30, uid));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.post('/checkin', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const titulo = String(req.body?.titulo || 'Academia').trim() || 'Academia';
    const result = await checkinHabito(titulo, uid);
    if (result.task) emitTaskUpdate(result.criada ? 'criada' : 'atualizada', result.task, uid);
    persistirHistoricoDia(hojeStr(), uid).catch(() => {});
    res.json(result);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.post('/', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const { titulo, descricao, prioridade, categoria, data_reset, hora } = req.body;
  if (!titulo) return res.status(400).json({ erro: 'Titulo obrigatorio' });
  try {
    const id = uuid();
    const dataReset = data_reset && String(data_reset).length >= 10
      ? dataResetSql(String(data_reset).slice(0, 10))
      : dataResetSql(hojeStr());
    await run(
      `INSERT INTO tasks (id, titulo, descricao, prioridade, categoria, data_reset, hora, user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, titulo, descricao || '', prioridade || 'media', categoria || 'geral', dataReset, hora || null, uid]
    );
    const task = await get(`SELECT * FROM tasks WHERE id = $1 AND user_id = $2`, [id, uid]);
    emitTaskUpdate('criada', task, uid);
    persistirHistoricoDia(ymdDe(task.data_reset) || hojeStr(), uid).catch(() => {});
    res.status(201).json(task);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const { concluida, titulo, descricao, prioridade, categoria } = req.body;
  try {
    const existe = await get(`SELECT id FROM tasks WHERE id = $1 AND user_id = $2`, [req.params.id, uid]);
    if (!existe) return res.status(404).json({ erro: 'Tarefa não encontrada' });

    if (concluida !== undefined) {
      if (concluida) {
        await run(`UPDATE tasks SET concluida = true, concluida_em = COALESCE(concluida_em, CURRENT_TIMESTAMP) WHERE id = $1 AND user_id = $2`, [req.params.id, uid]);
      } else {
        await run(`UPDATE tasks SET concluida = false, concluida_em = NULL WHERE id = $1 AND user_id = $2`, [req.params.id, uid]);
      }
    }
    if (titulo !== undefined) await run(`UPDATE tasks SET titulo = $1 WHERE id = $2 AND user_id = $3`, [titulo, req.params.id, uid]);
    if (descricao !== undefined) await run(`UPDATE tasks SET descricao = $1 WHERE id = $2 AND user_id = $3`, [descricao, req.params.id, uid]);
    if (prioridade !== undefined) await run(`UPDATE tasks SET prioridade = $1 WHERE id = $2 AND user_id = $3`, [prioridade, req.params.id, uid]);
    if (categoria !== undefined) await run(`UPDATE tasks SET categoria = $1 WHERE id = $2 AND user_id = $3`, [categoria, req.params.id, uid]);

    const task = await get(`SELECT * FROM tasks WHERE id = $1 AND user_id = $2`, [req.params.id, uid]);
    emitTaskUpdate('atualizada', task, uid);
    if (concluida !== undefined) persistirHistoricoDia(ymdDe(task && task.data_reset) || hojeStr(), uid).catch(() => {});
    res.json(task);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const r = await run(`DELETE FROM tasks WHERE id = $1 AND user_id = $2`, [req.params.id, uid]);
    if (!r.rowCount) return res.status(404).json({ erro: 'Tarefa não encontrada' });
    emitTaskUpdate('deletada', { id: req.params.id }, uid);
    res.json({ msg: 'Tarefa deletada' });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.setWsServer = function(ws) { wsServer = ws; };

module.exports = router;
