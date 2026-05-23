const express = require('express');
const { v4: uuid } = require('uuid');
const { run, get, all } = require('../lib/db');

let wsServer; // Será setado pelo server.js

const router = express.Router();

// Função pra emitir eventos WebSocket
function emitFinanceiroUpdate(tipo, dados) {
  if (wsServer) {
    wsServer.broadcast({
      tipo: 'financeiro-' + tipo,
      dados
    });
  }
}

// GET todas transacoes + saldo
router.get('/', async (req, res) => {
  try {
    const transacoes = await all(`
      SELECT * FROM financeiro
      ORDER BY data DESC, criado_em DESC
    `);

    const saldoRow = await get(`
      SELECT
        COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN valor ELSE 0 END), 0) as entradas,
        COALESCE(SUM(CASE WHEN tipo = 'saida' THEN valor ELSE 0 END), 0) as saidas
      FROM financeiro
    `);

    const saldo = (saldoRow.entradas || 0) - (saldoRow.saidas || 0);

    res.json({
      transacoes,
      saldo,
      entradas: saldoRow.entradas || 0,
      saidas: saldoRow.saidas || 0
    });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// GET saldo atual
router.get('/saldo', async (req, res) => {
  try {
    const row = await get(`
      SELECT
        COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN valor ELSE 0 END), 0) as entradas,
        COALESCE(SUM(CASE WHEN tipo = 'saida' THEN valor ELSE 0 END), 0) as saidas
      FROM financeiro
    `);
    const saldo = (row.entradas || 0) - (row.saidas || 0);
    res.json({ saldo, entradas: row.entradas || 0, saidas: row.saidas || 0 });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// POST nova transacao
router.post('/', async (req, res) => {
  const { tipo, valor, descricao, data, categoria } = req.body;

  if (!tipo || !valor) {
    return res.status(400).json({ erro: 'Tipo e valor obrigatorios' });
  }
  if (!['entrada', 'saida'].includes(tipo)) {
    return res.status(400).json({ erro: 'Tipo deve ser entrada ou saida' });
  }

  try {
    const id = uuid();
    const dataUso = data || new Date().toISOString().split('T')[0];

    await run(
      `INSERT INTO financeiro (id, tipo, valor, descricao, data, categoria)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, tipo, valor, descricao || '', dataUso, categoria || '']
    );

    const transacao = await get(`SELECT * FROM financeiro WHERE id = $1`, [id]);
    emitFinanceiroUpdate('adicionada', transacao);
    res.status(201).json(transacao);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// DELETE transacao
router.delete('/:id', async (req, res) => {
  try {
    await run(`DELETE FROM financeiro WHERE id = $1`, [req.params.id]);
    emitFinanceiroUpdate('deletada', { id: req.params.id });
    res.json({ msg: 'Transacao deletada' });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.setWsServer = function(ws) {
  wsServer = ws;
};

module.exports = router;
