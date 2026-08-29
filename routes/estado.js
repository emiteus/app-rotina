const express = require('express');
const { run, all, get } = require('../lib/db');
const { requireUserId } = require('../lib/tenant');

const router = express.Router();

// GET todo o estado do app (chave -> valor)
router.get('/', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const rows = await all(`SELECT chave, valor FROM app_estado WHERE user_id = $1`, [uid]);
    const estado = {};
    rows.forEach(r => { estado[r.chave] = r.valor; });
    res.json({ estado });
  } catch (err) {
    res.status(500).json({ erro: err.message, estado: {} });
  }
});

// PUT salva/atualiza uma chave
router.put('/:chave', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const valor = req.body && req.body.valor;
    const chave = req.params.chave;
    const valStr = valor == null ? null : String(valor);
    const existe = await get(`SELECT chave FROM app_estado WHERE chave = $1 AND user_id = $2`, [chave, uid]);
    if (existe) {
      await run(
        `UPDATE app_estado SET valor = $1, atualizado_em = CURRENT_TIMESTAMP WHERE chave = $2 AND user_id = $3`,
        [valStr, chave, uid]
      );
    } else {
      await run(
        `INSERT INTO app_estado (chave, valor, user_id, atualizado_em) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
        [chave, valStr, uid]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;
