const express = require('express');
const router = express.Router();

// Middleware de autenticacao
// SKIP_AUTH=true no .env local bypassa (uso pessoal no Electron/localhost);
// Railway NÃO tem SKIP_AUTH → produção continua protegida por senha.
function requireAuth(req, res, next) {
  if (process.env.SKIP_AUTH === 'true') return next();
  if (req.session && req.session.authenticated) return next();
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
  if (process.env.SKIP_AUTH === 'true') return res.json({ authenticated: true });
  if (req.session && req.session.authenticated) return res.json({ authenticated: true });
  res.json({ authenticated: false });
});

// GET logout
router.get('/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

module.exports = { router, requireAuth };
