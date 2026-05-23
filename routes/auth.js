const express = require('express');
const router = express.Router();

// Middleware de autenticacao
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  return res.status(401).json({ erro: 'Nao autenticado' });
}

// POST login
router.post('/login', (req, res) => {
  const { senha } = req.body;
  const senhaCorreta = process.env.APP_PASSWORD || 'senha123';

  if (senha === senhaCorreta) {
    req.session.authenticated = true;
    return res.json({ ok: true });
  }

  res.status(401).json({ erro: 'Senha incorreta' });
});

// GET verificar autenticacao
router.get('/check', (req, res) => {
  if (req.session && req.session.authenticated) {
    return res.json({ authenticated: true });
  }
  res.json({ authenticated: false });
});

// GET logout
router.get('/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

module.exports = { router, requireAuth };
