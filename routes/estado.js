const express = require('express');
const { run, all } = require('../lib/db');

const router = express.Router();

// GET todo o estado do app (chave -> valor)
router.get('/', async (req, res) => {
  try {
    const rows = await all(`SELECT chave, valor FROM app_estado`);
    const estado = {};
    rows.forEach(r => { estado[r.chave] = r.valor; });
    res.json({ estado });
  } catch (err) {
    res.status(500).json({ erro: err.message, estado: {} });
  }
});

// PUT salva/atualiza uma chave
router.put('/:chave', async (req, res) => {
  try {
    const valor = req.body && req.body.valor;
    await run(
      `INSERT INTO app_estado (chave, valor, atualizado_em)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = CURRENT_TIMESTAMP`,
      [req.params.chave, valor == null ? null : String(valor)]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;
