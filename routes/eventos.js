const express = require('express');
const { v4: uuid } = require('uuid');
const { run, get, all } = require('../lib/db');
const { requireUserId } = require('../lib/tenant');

let wsServer;
const router = express.Router();

function emit(tipo, dados) {
  if (wsServer) wsServer.broadcast({ tipo: 'evento-' + tipo, dados });
}

// GET eventos (com filtro de mês opcional)
router.get('/', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const { mes } = req.query;
  try {
    let eventos;
    if (mes) {
      eventos = await all(
        `SELECT * FROM eventos WHERE user_id = $1 AND TO_CHAR(data, 'YYYY-MM') = $2 ORDER BY data, hora`,
        [uid, mes]
      );
    } else {
      eventos = await all(`SELECT * FROM eventos WHERE user_id = $1 ORDER BY data DESC, hora`, [uid]);
    }
    res.json(eventos);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// POST novo evento
router.post('/', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const { titulo, descricao, data, hora, tipo, cor } = req.body;
  if (!titulo || !data) return res.status(400).json({ erro: 'Titulo e data obrigatorios' });
  try {
    const id = uuid();
    await run(
      `INSERT INTO eventos (id, titulo, descricao, data, hora, tipo, cor, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, titulo, descricao || '', data, hora || null, tipo || 'evento', cor || 'blue', uid]
    );
    const evento = await get(`SELECT * FROM eventos WHERE id = $1 AND user_id = $2`, [id, uid]);
    emit('criado', evento);
    res.status(201).json(evento);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// PATCH atualizar evento
router.patch('/:id', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const { titulo, descricao, data, hora, tipo, cor } = req.body;
  try {
    const existe = await get(`SELECT id FROM eventos WHERE id = $1 AND user_id = $2`, [req.params.id, uid]);
    if (!existe) return res.status(404).json({ erro: 'Evento não encontrado' });

    if (titulo !== undefined) await run(`UPDATE eventos SET titulo = $1 WHERE id = $2 AND user_id = $3`, [titulo, req.params.id, uid]);
    if (descricao !== undefined) await run(`UPDATE eventos SET descricao = $1 WHERE id = $2 AND user_id = $3`, [descricao, req.params.id, uid]);
    if (data !== undefined) await run(`UPDATE eventos SET data = $1 WHERE id = $2 AND user_id = $3`, [data, req.params.id, uid]);
    if (hora !== undefined) await run(`UPDATE eventos SET hora = $1 WHERE id = $2 AND user_id = $3`, [hora, req.params.id, uid]);
    if (tipo !== undefined) await run(`UPDATE eventos SET tipo = $1 WHERE id = $2 AND user_id = $3`, [tipo, req.params.id, uid]);
    if (cor !== undefined) await run(`UPDATE eventos SET cor = $1 WHERE id = $2 AND user_id = $3`, [cor, req.params.id, uid]);
    const evento = await get(`SELECT * FROM eventos WHERE id = $1 AND user_id = $2`, [req.params.id, uid]);
    emit('atualizado', evento);
    res.json(evento);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// DELETE
router.delete('/:id', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const r = await run(`DELETE FROM eventos WHERE id = $1 AND user_id = $2`, [req.params.id, uid]);
    if (!r.rowCount) return res.status(404).json({ erro: 'Evento não encontrado' });
    emit('deletado', { id: req.params.id });
    res.json({ msg: 'Evento deletado' });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.setWsServer = function(ws) { wsServer = ws; };
module.exports = router;
