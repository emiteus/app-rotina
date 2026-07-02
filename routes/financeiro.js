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

// GET stats mensais (últimos 6 meses)
router.get('/stats', async (req, res) => {
  try {
    const stats = await all(`
      SELECT
        TO_CHAR(data, 'YYYY-MM') as mes,
        COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN valor ELSE 0 END), 0) as entradas,
        COALESCE(SUM(CASE WHEN tipo = 'saida' THEN valor ELSE 0 END), 0) as saidas
      FROM financeiro
      WHERE data >= CURRENT_DATE - INTERVAL '6 months'
      GROUP BY TO_CHAR(data, 'YYYY-MM')
      ORDER BY mes ASC
    `);

    const porCategoria = await all(`
      SELECT categoria, tipo, SUM(valor) as total
      FROM financeiro
      WHERE data >= DATE_TRUNC('month', CURRENT_DATE)
      GROUP BY categoria, tipo
      ORDER BY total DESC
    `);

    res.json({ stats, porCategoria });
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

// GET alertas de gasto incomum (mês atual vs média dos meses anteriores por categoria)
router.get('/alertas', async (req, res) => {
  try {
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
      if (d.anteriores.length === 0 || d.atual <= 0) return;
      const media = d.anteriores.reduce((s, v) => s + v, 0) / d.anteriores.length;
      // Significativo: gastou >50% acima da média e a diferença é relevante (> R$50)
      if (media > 0 && d.atual > media * 1.5 && (d.atual - media) > 50) {
        alertas.push({
          categoria: cat,
          atual: d.atual,
          media: Math.round(media * 100) / 100,
          acima: Math.round(((d.atual / media - 1) * 100)),
          diferenca: Math.round((d.atual - media) * 100) / 100
        });
      }
    });
    alertas.sort((a, b) => b.diferenca - a.diferenca);
    res.json({ alertas });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.setWsServer = function(ws) {
  wsServer = ws;
};

module.exports = router;
