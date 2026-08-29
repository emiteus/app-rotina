const express = require('express');
const { all, get } = require('../lib/db');
const { requireUserId } = require('../lib/tenant');

const router = express.Router();

router.get('/', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const meses = await all(`
      SELECT TO_CHAR(data, 'YYYY-MM') AS ym,
             COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor END),0) AS entradas,
             COALESCE(SUM(CASE WHEN tipo='saida'   THEN valor END),0) AS saidas
      FROM financeiro
      WHERE user_id = $1
        AND data >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '11 months'
        AND data < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'
      GROUP BY ym
      ORDER BY ym DESC`, [uid]);
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

router.get('/range', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(from) || !dateRe.test(to)) return res.status(400).json({ erro: 'use ?from=YYYY-MM-DD&to=YYYY-MM-DD' });
  if (from > to) return res.status(400).json({ erro: 'from não pode ser maior que to' });

  try {
    const tot = await get(`
      SELECT COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor END),0) AS entradas,
             COALESCE(SUM(CASE WHEN tipo='saida'   THEN valor END),0) AS saidas,
             COUNT(*)::int AS qtd
      FROM financeiro WHERE user_id = $1 AND data BETWEEN $2 AND $3`, [uid, from, to]);

    const cat = await all(`
      SELECT categoria, tipo, COALESCE(SUM(valor),0) AS total, COUNT(*)::int AS qtd
      FROM financeiro WHERE user_id = $1 AND data BETWEEN $2 AND $3
      GROUP BY categoria, tipo
      ORDER BY total DESC`, [uid, from, to]);

    const pfPj = await all(`
      SELECT i.pessoa,
             COALESCE(SUM(CASE WHEN f.tipo='entrada' THEN f.valor END),0) AS entradas,
             COALESCE(SUM(CASE WHEN f.tipo='saida'   THEN f.valor END),0) AS saidas
      FROM financeiro f
      JOIN openfinance_accounts a ON a.account_id = f.account_id
      JOIN openfinance_items i    ON i.item_id    = a.item_id AND i.user_id = $1
      WHERE f.user_id = $1 AND f.data BETWEEN $2 AND $3
      GROUP BY i.pessoa`, [uid, from, to]);

    const cats = await all(`SELECT chave, label FROM categorias WHERE user_id IS NULL OR user_id = $1`, [uid]);
    const labelDe = {};
    cats.forEach(c => { labelDe[c.chave] = c.label; });
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
      range: { from, to },
      totais: {
        entradas: Number(tot.entradas),
        saidas: Number(tot.saidas),
        saldo: Number(tot.entradas) - Number(tot.saidas),
        qtd: tot.qtd
      },
      pf: { entradas: Number(pf.entradas), saidas: Number(pf.saidas) },
      pj: { entradas: Number(pj.entradas), saidas: Number(pj.saidas) },
      categorias
    });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.get('/:ym', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const ym = req.params.ym;
  if (!/^\d{4}-\d{2}$/.test(ym)) return res.status(400).json({ erro: 'ym inválido (use YYYY-MM)' });

  const [ano, m] = ym.split('-').map(Number);
  const dPrev = new Date(ano, m - 2, 1);
  const ymPrev = `${dPrev.getFullYear()}-${String(dPrev.getMonth() + 1).padStart(2, '0')}`;

  try {
    const tot = await get(`
      SELECT COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor END),0) AS entradas,
             COALESCE(SUM(CASE WHEN tipo='saida'   THEN valor END),0) AS saidas,
             COUNT(*)::int AS qtd
      FROM financeiro WHERE user_id = $1 AND TO_CHAR(data, 'YYYY-MM') = $2`, [uid, ym]);

    const cat = await all(`
      SELECT categoria, tipo, COALESCE(SUM(valor),0) AS total, COUNT(*)::int AS qtd
      FROM financeiro WHERE user_id = $1 AND TO_CHAR(data, 'YYYY-MM') = $2
      GROUP BY categoria, tipo
      ORDER BY total DESC`, [uid, ym]);

    const pfPj = await all(`
      SELECT i.pessoa,
             COALESCE(SUM(CASE WHEN f.tipo='entrada' THEN f.valor END),0) AS entradas,
             COALESCE(SUM(CASE WHEN f.tipo='saida'   THEN f.valor END),0) AS saidas
      FROM financeiro f
      JOIN openfinance_accounts a ON a.account_id = f.account_id
      JOIN openfinance_items i    ON i.item_id    = a.item_id AND i.user_id = $1
      WHERE f.user_id = $1 AND TO_CHAR(f.data, 'YYYY-MM') = $2
      GROUP BY i.pessoa`, [uid, ym]);

    const totPrev = await get(`
      SELECT COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor END),0) AS entradas,
             COALESCE(SUM(CASE WHEN tipo='saida'   THEN valor END),0) AS saidas
      FROM financeiro WHERE user_id = $1 AND TO_CHAR(data, 'YYYY-MM') = $2`, [uid, ymPrev]);

    const cats = await all(`SELECT chave, label FROM categorias WHERE user_id IS NULL OR user_id = $1`, [uid]);
    const labelDe = {};
    cats.forEach(c => { labelDe[c.chave] = c.label; });

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
