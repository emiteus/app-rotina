/**
 * Leitura do log. Só o dono (OWNER_LOGIN). Não há rota de apagar ou editar.
 */
const express = require('express');
const { isPlanoOwnerUserId } = require('../lib/plano-owner');
const { getUserId } = require('../lib/tenant');
const audit = require('../lib/audit-log');

const router = express.Router();

async function soDono(req, res) {
  const uid = getUserId(req);
  if (!uid) {
    res.status(401).json({ erro: 'Nao autenticado' });
    return null;
  }
  if (!(await isPlanoOwnerUserId(uid))) {
    res.status(403).json({ erro: 'só o dono vê o log' });
    return null;
  }
  return uid;
}

router.get('/', async (req, res) => {
  if (!(await soDono(req, res))) return;
  try {
    const linhas = await audit.list({ limit: req.query.limit, before: req.query.before });
    res.set('Cache-Control', 'no-store');
    res.json({ linhas });
  } catch (e) {
    console.error('[audit] list:', e.message);
    res.status(500).json({ erro: 'não consegui ler o log' });
  }
});

router.get('/servidor', async (req, res) => {
  if (!(await soDono(req, res))) return;
  try {
    const corpo = require('../lib/server-integrity').report();
    try {
      corpo.cadeia = await audit.verify();
      if (corpo.cadeia && corpo.cadeia.ok === false) corpo.ok = false;
    } catch (e) {
      corpo.cadeia = { ok: false, motivo: 'não li o log' };
      corpo.ok = false;
    }
    res.set('Cache-Control', 'no-store');
    res.json(corpo);
  } catch (e) {
    console.error('[audit] servidor:', e.message);
    res.status(500).json({ erro: 'não consegui ler a integridade do servidor' });
  }
});

router.get('/verificar', async (req, res) => {
  if (!(await soDono(req, res))) return;
  try {
    const out = await audit.verify();
    res.set('Cache-Control', 'no-store');
    res.json(out);
  } catch (e) {
    console.error('[audit] verificar:', e.message);
    res.status(500).json({ erro: 'não consegui verificar o log' });
  }
});

module.exports = router;
