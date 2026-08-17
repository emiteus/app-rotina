const express = require('express');
const router = express.Router();

const LOGIN_MAX = 8;
const LOGIN_JANELA_MS = 15 * 60 * 1000;
const tentativasLogin = new Map();

function ipLogin(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

function checarLimiteLogin(ip) {
  const agora = Date.now();
  const rec = tentativasLogin.get(ip);
  if (!rec || agora > rec.resetAt) {
    tentativasLogin.set(ip, { count: 0, resetAt: agora + LOGIN_JANELA_MS });
    return { ok: true };
  }
  if (rec.count >= LOGIN_MAX) {
    const min = Math.max(1, Math.ceil((rec.resetAt - agora) / 60000));
    return { ok: false, min };
  }
  return { ok: true };
}

function registrarFalhaLogin(ip) {
  const agora = Date.now();
  const rec = tentativasLogin.get(ip) || { count: 0, resetAt: agora + LOGIN_JANELA_MS };
  rec.count += 1;
  tentativasLogin.set(ip, rec);
}

function limparLogin(ip) {
  tentativasLogin.delete(ip);
}

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
  const ip = ipLogin(req);
  const limite = checarLimiteLogin(ip);
  if (!limite.ok) {
    return res.status(429).json({
      erro: `Muitas tentativas. Espera ${limite.min} min.`
    });
  }

  const senha = String(req.body?.senha || '').trim();
  const senhaCorreta = String(process.env.APP_PASSWORD || 'senha123').trim();

  if (senha && senha === senhaCorreta) {
    limparLogin(ip);
    req.session.authenticated = true;
    return req.session.save((err) => {
      if (err) {
        console.error('[auth] falha ao salvar sessão:', err.message);
        return res.status(500).json({ erro: 'Não consegui abrir a sessão. Tenta de novo.' });
      }
      res.json({ ok: true });
    });
  }

  registrarFalhaLogin(ip);
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
