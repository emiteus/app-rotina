const express = require('express');
const { v4: uuid } = require('uuid');
const { run, get, all } = require('../lib/db');
const { requireUserId } = require('../lib/tenant');

let wsServer; // Será setado pelo server.js

const router = express.Router();

// Função pra emitir eventos WebSocket
// Só pro dono do alarme (antes ia pra todos os conectados)
function emitAlarmeUpdate(userId, tipo, dados) {
  if (wsServer) {
    wsServer.broadcastToUser(userId, {
      tipo: 'alarme-' + tipo,
      dados
    });
  }
}

// GET todos alarmes
router.get('/', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const alarmes = await all(`
      SELECT * FROM alarmes
      WHERE user_id = $1
      ORDER BY hora
    `, [uid]);
    res.json(alarmes);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// POST novo alarme
router.post('/', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
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
      `INSERT INTO alarmes (id, hora, mensagem, user_id) VALUES ($1, $2, $3, $4)`,
      [id, hora, mensagem, uid]
    );

    const alarme = await get(`SELECT * FROM alarmes WHERE id = $1 AND user_id = $2`, [id, uid]);
    emitAlarmeUpdate(uid, 'criado', alarme);
    res.status(201).json(alarme);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// PATCH atualizar alarme
router.patch('/:id', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const { hora, mensagem, ativo } = req.body;

  try {
    const existe = await get(`SELECT id FROM alarmes WHERE id = $1 AND user_id = $2`, [req.params.id, uid]);
    if (!existe) return res.status(404).json({ erro: 'Alarme não encontrado' });

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
    sql += ` WHERE id = $${paramCount} AND user_id = $${paramCount + 1}`;
    params.push(req.params.id, uid);

    await run(sql, params);
    const alarme = await get(`SELECT * FROM alarmes WHERE id = $1 AND user_id = $2`, [req.params.id, uid]);
    emitAlarmeUpdate(uid, 'atualizado', alarme);
    res.json(alarme);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// DELETE alarme
router.delete('/:id', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const r = await run(`DELETE FROM alarmes WHERE id = $1 AND user_id = $2`, [req.params.id, uid]);
    if (!r.rowCount) return res.status(404).json({ erro: 'Alarme não encontrado' });
    emitAlarmeUpdate(uid, 'deletado', { id: req.params.id });
    res.json({ msg: 'Alarme deletado' });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.setWsServer = function(ws) {
  wsServer = ws;
};

module.exports = router;
