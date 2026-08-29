const express = require('express');
const { requireUserId } = require('../lib/tenant');
const { rankingDoDia } = require('../lib/ranking');

const router = express.Router();

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

module.exports = router;
