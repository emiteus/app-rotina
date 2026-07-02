const express = require('express');
const { v4: uuid } = require('uuid');
const { run, get, all } = require('../lib/db');

let wsServer;
const router = express.Router();

function emit(tipo, dados) {
  if (wsServer) wsServer.broadcast({ tipo: 'evento-' + tipo, dados });
}

// GET eventos (com filtro de mês opcional)
router.get('/', async (req, res) => {
  const { mes } = req.query;
  try {
    let eventos;
    if (mes) {
      eventos = await all(
        `SELECT * FROM eventos WHERE TO_CHAR(data, 'YYYY-MM') = $1 ORDER BY data, hora`,
        [mes]
      );
    } else {
      eventos = await all(`SELECT * FROM eventos ORDER BY data DESC, hora`);
    }
    res.json(eventos);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// POST novo evento
router.post('/', async (req, res) => {
  const { titulo, descricao, data, hora, tipo, cor } = req.body;
  if (!titulo || !data) return res.status(400).json({ erro: 'Titulo e data obrigatorios' });
  try {
    const id = uuid();
    await run(
      `INSERT INTO eventos (id, titulo, descricao, data, hora, tipo, cor)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, titulo, descricao || '', data, hora || null, tipo || 'evento', cor || 'blue']
    );
    const evento = await get(`SELECT * FROM eventos WHERE id = $1`, [id]);
    emit('criado', evento);
    res.status(201).json(evento);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// PATCH atualizar evento
router.patch('/:id', async (req, res) => {
  const { titulo, descricao, data, hora, tipo, cor } = req.body;
  try {
    if (titulo !== undefined) await run(`UPDATE eventos SET titulo = $1 WHERE id = $2`, [titulo, req.params.id]);
    if (descricao !== undefined) await run(`UPDATE eventos SET descricao = $1 WHERE id = $2`, [descricao, req.params.id]);
    if (data !== undefined) await run(`UPDATE eventos SET data = $1 WHERE id = $2`, [data, req.params.id]);
    if (hora !== undefined) await run(`UPDATE eventos SET hora = $1 WHERE id = $2`, [hora, req.params.id]);
    if (tipo !== undefined) await run(`UPDATE eventos SET tipo = $1 WHERE id = $2`, [tipo, req.params.id]);
    if (cor !== undefined) await run(`UPDATE eventos SET cor = $1 WHERE id = $2`, [cor, req.params.id]);
    const evento = await get(`SELECT * FROM eventos WHERE id = $1`, [req.params.id]);
    emit('atualizado', evento);
    res.json(evento);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// DELETE
router.delete('/:id', async (req, res) => {
  try {
    await run(`DELETE FROM eventos WHERE id = $1`, [req.params.id]);
    emit('deletado', { id: req.params.id });
    res.json({ msg: 'Evento deletado' });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.setWsServer = function(ws) { wsServer = ws; };
module.exports = router;
