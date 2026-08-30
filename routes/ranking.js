const express = require('express');
const { requireUserId } = require('../lib/tenant');
const { rankingDoDia, rankingHistorico } = require('../lib/ranking');

const router = express.Router();

const PERIODOS = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '180d': 180
};

router.get('/dia', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const data = await rankingDoDia(uid);
    res.json(data);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.get('/historico', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const periodo = String(req.query.periodo || '30d').toLowerCase();
    const dias = PERIODOS[periodo] || Math.max(1, Math.min(Number(req.query.dias) || 30, 365));
    const data = await rankingHistorico(uid, {
      dias,
      de: req.query.de,
      ate: req.query.ate
    });
    res.json({ ...data, periodoKey: PERIODOS[periodo] ? periodo : `${dias}d` });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;
