const express = require('express');
const { all, get } = require('../lib/db');

const router = express.Router();

// GET /api/relatorios — lista os últimos 12 meses com movimentação
router.get('/', async (req, res) => {
  try {
    const meses = await all(`
      SELECT TO_CHAR(data, 'YYYY-MM') AS ym,
             COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor END),0) AS entradas,
             COALESCE(SUM(CASE WHEN tipo='saida'   THEN valor END),0) AS saidas
      FROM financeiro
      WHERE data >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '11 months'
      GROUP BY ym
      ORDER BY ym DESC`);
    res.json({
      meses: meses.map(m => ({
        ym: m.ym,
        entradas: Number(m.entradas),
        saidas: Number(m.saidas),
        saldo: Number(m.entradas) - Number(m.saidas)
      }))
    });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// GET /api/relatorios/:ym — resumo detalhado de um mês específico
router.get('/:ym', async (req, res) => {
  const ym = req.params.ym; // formato YYYY-MM
  if (!/^\d{4}-\d{2}$/.test(ym)) return res.status(400).json({ erro: 'ym inválido (use YYYY-MM)' });

  // Mês anterior pra comparação
  const [ano, m] = ym.split('-').map(Number);
  const dPrev = new Date(ano, m - 2, 1);
  const ymPrev = `${dPrev.getFullYear()}-${String(dPrev.getMonth() + 1).padStart(2, '0')}`;

  try {
    // Totais do mês selecionado
    const tot = await get(`
      SELECT COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor END),0) AS entradas,
             COALESCE(SUM(CASE WHEN tipo='saida'   THEN valor END),0) AS saidas,
             COUNT(*)::int AS qtd
      FROM financeiro WHERE TO_CHAR(data, 'YYYY-MM') = $1`, [ym]);

    // Por categoria (entradas + saídas)
    const cat = await all(`
      SELECT categoria, tipo, COALESCE(SUM(valor),0) AS total, COUNT(*)::int AS qtd
      FROM financeiro WHERE TO_CHAR(data, 'YYYY-MM') = $1
      GROUP BY categoria, tipo
      ORDER BY total DESC`, [ym]);

    // PF vs PJ (só considera transações com conta identificada)
    const pfPj = await all(`
      SELECT i.pessoa,
             COALESCE(SUM(CASE WHEN f.tipo='entrada' THEN f.valor END),0) AS entradas,
             COALESCE(SUM(CASE WHEN f.tipo='saida'   THEN f.valor END),0) AS saidas
      FROM financeiro f
      JOIN openfinance_accounts a ON a.account_id = f.account_id
      JOIN openfinance_items i    ON i.item_id    = a.item_id
      WHERE TO_CHAR(f.data, 'YYYY-MM') = $1
      GROUP BY i.pessoa`, [ym]);

    // Comparação com mês anterior (só totais)
    const totPrev = await get(`
      SELECT COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor END),0) AS entradas,
             COALESCE(SUM(CASE WHEN tipo='saida'   THEN valor END),0) AS saidas
      FROM financeiro WHERE TO_CHAR(data, 'YYYY-MM') = $1`, [ymPrev]);

    // Traz labels das categorias
    const cats = await all(`SELECT chave, label FROM categorias`);
    const labelDe = {};
    cats.forEach(c => { labelDe[c.chave] = c.label; });

    // Agrupa categorias mesmo se aparecerem em entrada e saída
    const categoriasMap = {};
    cat.forEach(c => {
      const k = c.categoria || 'outros';
      if (!categoriasMap[k]) categoriasMap[k] = { id: k, label: labelDe[k] || k, entradas: 0, saidas: 0 };
      if (c.tipo === 'entrada') categoriasMap[k].entradas += Number(c.total);
      else categoriasMap[k].saidas += Number(c.total);
    });
    const categorias = Object.values(categoriasMap).sort((a, b) => (b.entradas + b.saidas) - (a.entradas + a.saidas));

    const pf = pfPj.find(r => r.pessoa === 'PF') || { entradas: 0, saidas: 0 };
    const pj = pfPj.find(r => r.pessoa === 'PJ') || { entradas: 0, saidas: 0 };

    res.json({
      ym, ymPrev,
      totais: {
        entradas: Number(tot.entradas),
        saidas: Number(tot.saidas),
        saldo: Number(tot.entradas) - Number(tot.saidas),
        qtd: tot.qtd
      },
      anterior: {
        entradas: Number(totPrev.entradas),
        saidas: Number(totPrev.saidas),
        deltaSaidas: Number(tot.saidas) - Number(totPrev.saidas),
        deltaEntradas: Number(tot.entradas) - Number(totPrev.entradas)
      },
      pf: { entradas: Number(pf.entradas), saidas: Number(pf.saidas) },
      pj: { entradas: Number(pj.entradas), saidas: Number(pj.saidas) },
      categorias
    });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;
