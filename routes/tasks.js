const express = require('express');
const { v4: uuid } = require('uuid');
const { run, get, all } = require('../lib/db');

let wsServer; // Será setado pelo server.js

const router = express.Router();

// Função pra emitir eventos WebSocket
function emitTaskUpdate(tipo, dados) {
  if (wsServer) {
    wsServer.broadcast({
      tipo: 'tarefa-' + tipo,
      dados
    });
  }
}

// GET todas as tarefas do dia
router.get('/', async (req, res) => {
  try {
    const tasks = await all(`
      SELECT * FROM tasks
      WHERE DATE(data_reset) = DATE('now')
      OR data_reset IS NULL
      ORDER BY ordem, data_criacao
    `);
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// POST nova tarefa
router.post('/', async (req, res) => {
  const { titulo } = req.body;
  if (!titulo) return res.status(400).json({ erro: 'Titulo obrigatorio' });

  try {
    const id = uuid();
    const hoje = new Date().toISOString().split('T')[0];
    await run(
      `INSERT INTO tasks (id, titulo, data_reset) VALUES ($1, $2, $3)`,
      [id, titulo, `${hoje} 00:00:00`]
    );
    const task = await get(`SELECT * FROM tasks WHERE id = $1`, [id]);
    emitTaskUpdate('criada', task);
    res.status(201).json(task);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// PATCH marcar como concluida
router.patch('/:id', async (req, res) => {
  const { concluida } = req.body;
  try {
    await run(
      `UPDATE tasks SET concluida = $1 WHERE id = $2`,
      [concluida ? true : false, req.params.id]
    );
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

router.setWsServer = function(ws) {
  wsServer = ws;
};

module.exports = router;
