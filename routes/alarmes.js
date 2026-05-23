const express = require('express');
const { v4: uuid } = require('uuid');
const { run, get, all } = require('../lib/db');

let wsServer; // Será setado pelo server.js

const router = express.Router();

// Função pra emitir eventos WebSocket
function emitAlarmeUpdate(tipo, dados) {
  if (wsServer) {
    wsServer.broadcast({
      tipo: 'alarme-' + tipo,
      dados
    });
  }
}

// GET todos alarmes
router.get('/', async (req, res) => {
  try {
    const alarmes = await all(`
      SELECT * FROM alarmes
      ORDER BY hora
    `);
    res.json(alarmes);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// POST novo alarme
router.post('/', async (req, res) => {
  const { hora, mensagem } = req.body;

  if (!hora || !mensagem) {
    return res.status(400).json({ erro: 'Hora e mensagem obrigatorios' });
  }

  // Valida formato HH:MM
  if (!/^\d{2}:\d{2}$/.test(hora)) {
    return res.status(400).json({ erro: 'Hora deve estar no formato HH:MM' });
  }

  try {
    const id = uuid();
    await run(
      `INSERT INTO alarmes (id, hora, mensagem) VALUES ($1, $2, $3)`,
      [id, hora, mensagem]
    );

    const alarme = await get(`SELECT * FROM alarmes WHERE id = $1`, [id]);
    emitAlarmeUpdate('criado', alarme);
    res.status(201).json(alarme);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// PATCH atualizar alarme
router.patch('/:id', async (req, res) => {
  const { hora, mensagem, ativo } = req.body;

  try {
    let sql = 'UPDATE alarmes SET ';
    const params = [];
    let paramCount = 1;

    if (hora !== undefined) {
      sql += `hora = $${paramCount}, `;
      params.push(hora);
      paramCount++;
    }
    if (mensagem !== undefined) {
      sql += `mensagem = $${paramCount}, `;
      params.push(mensagem);
      paramCount++;
    }
    if (ativo !== undefined) {
      sql += `ativo = $${paramCount}, `;
      params.push(ativo ? 1 : 0);
      paramCount++;
    }

    sql = sql.replace(/, $/, ''); // Remove ultima virgula
    sql += ` WHERE id = $${paramCount}`;
    params.push(req.params.id);

    await run(sql, params);
    const alarme = await get(`SELECT * FROM alarmes WHERE id = $1`, [req.params.id]);
    emitAlarmeUpdate('atualizado', alarme);
    res.json(alarme);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// DELETE alarme
router.delete('/:id', async (req, res) => {
  try {
    await run(`DELETE FROM alarmes WHERE id = $1`, [req.params.id]);
    emitAlarmeUpdate('deletado', { id: req.params.id });
    res.json({ msg: 'Alarme deletado' });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.setWsServer = function(ws) {
  wsServer = ws;
};

module.exports = router;
