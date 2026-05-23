const express = require('express');
const { v4: uuid } = require('uuid');
const { run, get, all } = require('../lib/db');

const router = express.Router();

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
      `INSERT INTO alarmes (id, hora, mensagem) VALUES (?, ?, ?)`,
      [id, hora, mensagem]
    );

    const alarme = await get(`SELECT * FROM alarmes WHERE id = ?`, [id]);
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

    if (hora !== undefined) {
      sql += 'hora = ?, ';
      params.push(hora);
    }
    if (mensagem !== undefined) {
      sql += 'mensagem = ?, ';
      params.push(mensagem);
    }
    if (ativo !== undefined) {
      sql += 'ativo = ?, ';
      params.push(ativo ? 1 : 0);
    }

    sql = sql.replace(/, $/, ''); // Remove ultima virgula
    sql += ' WHERE id = ?';
    params.push(req.params.id);

    await run(sql, params);
    const alarme = await get(`SELECT * FROM alarmes WHERE id = ?`, [req.params.id]);
    res.json(alarme);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// DELETE alarme
router.delete('/:id', async (req, res) => {
  try {
    await run(`DELETE FROM alarmes WHERE id = ?`, [req.params.id]);
    res.json({ msg: 'Alarme deletado' });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;
