const express = require('express');
const { v4: uuid } = require('uuid');
const { run, get, all } = require('../lib/db');

let wsServer;

const router = express.Router();

function emitTaskUpdate(tipo, dados) {
  if (wsServer) {
    wsServer.broadcast({ tipo: 'tarefa-' + tipo, dados });
  }
}

// GET todas as tarefas (hoje + próximos dias)
router.get('/', async (req, res) => {
  try {
    const tasks = await all(`
      SELECT * FROM tasks
      WHERE DATE(data_reset) >= CURRENT_DATE - INTERVAL '1 day'
      OR data_reset IS NULL
      ORDER BY
        DATE(data_reset) ASC,
        CASE prioridade
          WHEN 'alta' THEN 1
          WHEN 'media' THEN 2
          WHEN 'baixa' THEN 3
          ELSE 4
        END,
        concluida,
        data_criacao
    `);
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// GET histórico de tarefas (últimos 30 dias)
router.get('/historico', async (req, res) => {
  try {
    const historico = await all(`
      SELECT data, total, concluidas, por_categoria, por_prioridade
      FROM task_historico
      WHERE data >= CURRENT_DATE - INTERVAL '30 days'
      ORDER BY data ASC
    `);
    res.json(historico);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// GET stats detalhadas (últimos 30 dias)
router.get('/stats', async (req, res) => {
  try {
    // Agregação DIRETA da tabela tasks (últimos 30 dias) — task_historico não é populada mais
    const historico = await all(`
      SELECT
        DATE(data_reset) AS data,
        COUNT(*)::int AS total,
        SUM(CASE WHEN concluida THEN 1 ELSE 0 END)::int AS concluidas
      FROM tasks
      WHERE data_reset IS NOT NULL
        AND DATE(data_reset) >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY DATE(data_reset)
      ORDER BY DATE(data_reset) ASC
    `);

    // Categorias/prioridades (últimos 30 dias)
    const catRows = await all(`
      SELECT COALESCE(categoria,'geral') AS c, COUNT(*)::int AS n
      FROM tasks
      WHERE data_reset IS NOT NULL AND DATE(data_reset) >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY COALESCE(categoria,'geral')
    `);
    const priRows = await all(`
      SELECT COALESCE(prioridade,'media') AS p, COUNT(*)::int AS n
      FROM tasks
      WHERE data_reset IS NOT NULL AND DATE(data_reset) >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY COALESCE(prioridade,'media')
    `);
    const categorias = {};
    catRows.forEach(r => { categorias[r.c] = r.n; });
    const prioridades = { alta: 0, media: 0, baixa: 0 };
    priRows.forEach(r => { prioridades[r.p] = r.n; });

    let totalCriadas = 0;
    let totalConcluidas = 0;
    let melhorDia = { data: null, taxa: 0, total: 0 };
    let piorDia = { data: null, taxa: 100, total: 0 };

    historico.forEach(h => {
      const total = h.total;
      const concluidas = h.concluidas;
      totalCriadas += total;
      totalConcluidas += concluidas;
      const taxa = total > 0 ? (concluidas / total) * 100 : 0;
      if (total >= 3 && taxa > melhorDia.taxa) melhorDia = { data: h.data, taxa, total };
      if (total >= 3 && taxa < piorDia.taxa) piorDia = { data: h.data, taxa, total };
    });

    // Streak: dias seguidos (do mais recente pra trás) com ao menos 1 tarefa concluída.
    // Se hoje ainda tem 0 concluídas (dia em andamento), pula pra não zerar streak indevidamente.
    let streak = 0;
    const historicoDesc = [...historico].reverse();
    const hojeStr = new Date().toISOString().slice(0, 10);
    for (let i = 0; i < historicoDesc.length; i++) {
      const h = historicoDesc[i];
      const hStr = (h.data instanceof Date ? h.data.toISOString().slice(0,10) : String(h.data).slice(0,10));
      if (i === 0 && hStr === hojeStr && h.concluidas === 0) continue;
      if (h.concluidas > 0) streak++;
      else break;
    }

    const diasComTarefas = historico.length;
    const taxaMedia = totalCriadas > 0 ? Math.round((totalConcluidas / totalCriadas) * 100) : 0;
    const mediaPorDia = diasComTarefas > 0 ? (totalConcluidas / diasComTarefas).toFixed(1) : 0;

    res.json({
      historico,
      resumo: {
        totalCriadas,
        totalConcluidas,
        taxaMedia,
        mediaPorDia,
        diasAtivos: diasComTarefas,
        streak,
        melhorDia,
        piorDia
      },
      categorias,
      prioridades
    });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// POST seed historico (uso interno)
router.post('/seed-historico', async (req, res) => {
  const { dados } = req.body;
  try {
    for (const d of dados) {
      await run(
        `INSERT INTO task_historico (data, total, concluidas, por_categoria, por_prioridade)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (data) DO UPDATE SET
           total = $2, concluidas = $3, por_categoria = $4, por_prioridade = $5`,
        [d.data, d.total, d.concluidas, JSON.stringify(d.categorias || {}), JSON.stringify(d.prioridades || {})]
      );
    }
    res.json({ msg: 'Histórico salvo', count: dados.length });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// POST nova tarefa (com suporte a data_reset e hora)
router.post('/', async (req, res) => {
  const { titulo, descricao, prioridade, categoria, data_reset, hora } = req.body;
  if (!titulo) return res.status(400).json({ erro: 'Titulo obrigatorio' });

  try {
    const id = uuid();
    // Se data_reset não for fornecida, usa hoje
    let dataReset;
    if (data_reset) {
      // Se receber YYYY-MM-DD, converte para timestamp válido do PostgreSQL
      if (data_reset.length === 10) {
        dataReset = new Date(data_reset + 'T00:00:00Z').toISOString();
      } else {
        dataReset = data_reset;
      }
    } else {
      dataReset = new Date().toISOString();
    }

    await run(
      `INSERT INTO tasks (id, titulo, descricao, prioridade, categoria, data_reset, hora)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, titulo, descricao || '', prioridade || 'media', categoria || 'geral', dataReset, hora || null]
    );
    const task = await get(`SELECT * FROM tasks WHERE id = $1`, [id]);
    emitTaskUpdate('criada', task);
    res.status(201).json(task);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// PATCH atualizar tarefa (concluida ou outros campos)
router.patch('/:id', async (req, res) => {
  const { concluida, titulo, descricao, prioridade, categoria } = req.body;
  try {
    if (concluida !== undefined) {
      await run(`UPDATE tasks SET concluida = $1 WHERE id = $2`, [!!concluida, req.params.id]);
    }
    if (titulo !== undefined) {
      await run(`UPDATE tasks SET titulo = $1 WHERE id = $2`, [titulo, req.params.id]);
    }
    if (descricao !== undefined) {
      await run(`UPDATE tasks SET descricao = $1 WHERE id = $2`, [descricao, req.params.id]);
    }
    if (prioridade !== undefined) {
      await run(`UPDATE tasks SET prioridade = $1 WHERE id = $2`, [prioridade, req.params.id]);
    }
    if (categoria !== undefined) {
      await run(`UPDATE tasks SET categoria = $1 WHERE id = $2`, [categoria, req.params.id]);
    }
    const task = await get(`SELECT * FROM tasks WHERE id = $1`, [req.params.id]);
    emitTaskUpdate('atualizada', task);
    res.json(task);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// DELETE tarefa
router.delete('/:id', async (req, res) => {
  try {
    await run(`DELETE FROM tasks WHERE id = $1`, [req.params.id]);
    emitTaskUpdate('deletada', { id: req.params.id });
    res.json({ msg: 'Tarefa deletada' });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.setWsServer = function(ws) { wsServer = ws; };

module.exports = router;
