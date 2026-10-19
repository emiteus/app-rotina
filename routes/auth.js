const express = require('express');
const { v4: uuid } = require('uuid');
const { get, run } = require('../lib/db');
const { hashSenha, verificarSenha } = require('../lib/password');
const { getUserId, SKIP_USER_ID } = require('../lib/tenant');

const router = express.Router();

const LOGIN_MAX = 8;
const LOGIN_JANELA_MS = 15 * 60 * 1000;
const MAX_USUARIOS = Math.max(2, Math.min(Number(process.env.MAX_USERS) || 2, 10));
const CODIGO_CADASTRO = String(process.env.REGISTRATION_CODE || process.env.CODIGO_CADASTRO || '').trim();
const CORES_NOVOS = ['#3b82f6', '#8b5cf6', '#10b981', '#ec4899', '#14b8a6'];
const LOGIN_RE = /^[a-z0-9_]{3,20}$/;

/** Logins sem limite só se LOGIN_ISENTOS estiver definido de propósito. Lista vazia por padrão. */
const LOGIN_ISENTOS = new Set(
  (process.env.LOGIN_ISENTOS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

const tentativasLogin = new Map();

/** req.ip já respeita `trust proxy`. O primeiro X-Forwarded-For é escolhido pelo cliente. */
function ipLogin(req) {
  return req.ip || 'unknown';
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

function validarLogin(login) {
  if (!LOGIN_RE.test(login)) {
    return 'Usuário: 3–20 caracteres, só letras minúsculas, números e _';
  }
  return null;
}

function validarSenha(senha) {
  if (String(senha).length < 6) return 'Senha precisa ter pelo menos 6 caracteres';
  if (String(senha).length > 128) return 'Senha muito longa';
  return null;
}

function gravarSessao(req, res, user) {
  req.session.userId = user.id;
  req.session.userName = user.nome;
  req.session.userLogin = user.login;
  req.session.userCor = user.cor;
  req.session.save((err) => {
    if (err) {
      console.error('[auth] falha ao salvar sessão:', err.message);
      return res.status(500).json({ erro: 'Não consegui abrir a sessão. Tenta de novo.' });
    }
    res.json({ ok: true, user: { id: user.id, nome: user.nome, login: user.login, cor: user.cor } });
  });
}

function abrirSessao(req, res, user) {
  if (typeof req.session?.regenerate !== 'function') return gravarSessao(req, res, user);
  req.session.regenerate((err) => {
    if (err) {
      console.error('[auth] falha ao regenerar sessão:', err.message);
      return res.status(500).json({ erro: 'Não consegui abrir a sessão. Tenta de novo.' });
    }
    gravarSessao(req, res, user);
  });
}

async function statusCadastro() {
  const row = await get(`SELECT COUNT(*)::int AS n FROM usuarios WHERE ativo = true`);
  const total = Number(row?.n) || 0;
  const vagas = Math.max(0, MAX_USUARIOS - total);
  return {
    aberto: vagas > 0,
    vagas,
    maxUsuarios: MAX_USUARIOS,
    precisaCodigo: !!CODIGO_CADASTRO
  };
}

function requireAuth(req, res, next) {
  if (SKIP_USER_ID) {
    req.session = req.session || {};
    if (!req.session.userId) {
      req.session.userId = SKIP_USER_ID;
      req.session.userName = 'Dev';
      req.session.userLogin = 'dev';
    }
    return next();
  }
  if (req.session && req.session.userId) return next();
  return res.status(401).json({ erro: 'Nao autenticado' });
}

router.post('/login', async (req, res) => {
  const ip = ipLogin(req);
  const login = String(req.body?.login || req.body?.usuario || '').trim().toLowerCase();
  const senha = String(req.body?.senha || '').trim();
  const isento = LOGIN_ISENTOS.has(login);

  if (!isento) {
    const limite = checarLimiteLogin(ip);
    if (!limite.ok) {
      return res.status(429).json({ erro: `Muitas tentativas. Espera ${limite.min} min.` });
    }
  }

  if (!login || !senha) {
    if (!isento) registrarFalhaLogin(ip);
    return res.status(401).json({ erro: 'Usuário e senha obrigatórios' });
  }

  try {
    const user = await get(
      `SELECT id, login, nome, senha_hash, cor, ativo FROM usuarios WHERE lower(login) = $1`,
      [login]
    );
    if (!user || !user.ativo || !verificarSenha(senha, user.senha_hash)) {
      if (!isento) registrarFalhaLogin(ip);
      return res.status(401).json({ erro: 'Usuário ou senha incorretos' });
    }

    limparLogin(ip);
    abrirSessao(req, res, user);
  } catch (err) {
    console.error('[auth] login:', err.message);
    res.status(500).json({ erro: 'Falha ao entrar. Tenta de novo.' });
  }
});

router.get('/cadastro', async (_req, res) => {
  try {
    res.json(await statusCadastro());
  } catch (err) {
    console.error('[auth] cadastro status:', err.message);
    res.status(500).json({ erro: 'Falha ao consultar o cadastro.' });
  }
});

router.post('/register', async (req, res) => {
  if (SKIP_USER_ID) {
    return res.status(403).json({ erro: 'Cadastro desativado em modo dev (SKIP_AUTH)' });
  }
  if (process.env.NODE_ENV === 'production' && !CODIGO_CADASTRO) {
    return res.status(403).json({ erro: 'Cadastro desligado' });
  }

  const ip = ipLogin(req);
  const limite = checarLimiteLogin(ip);
  if (!limite.ok) {
    return res.status(429).json({ erro: `Muitas tentativas. Espera ${limite.min} min.` });
  }

  const login = String(req.body?.login || req.body?.usuario || '').trim().toLowerCase();
  const senha = String(req.body?.senha || '').trim();
  const nomeRaw = String(req.body?.nome || '').trim();
  const codigo = String(req.body?.codigo || req.body?.codigoConvite || '').trim();

  const errLogin = validarLogin(login);
  if (errLogin) {
    registrarFalhaLogin(ip);
    return res.status(400).json({ erro: errLogin });
  }
  const errSenha = validarSenha(senha);
  if (errSenha) {
    registrarFalhaLogin(ip);
    return res.status(400).json({ erro: errSenha });
  }

  try {
    const st = await statusCadastro();
    if (!st.aberto) {
      return res.status(403).json({ erro: `Limite de ${MAX_USUARIOS} usuários atingido` });
    }
    if (st.precisaCodigo && codigo !== CODIGO_CADASTRO) {
      registrarFalhaLogin(ip);
      return res.status(403).json({ erro: 'Código de convite inválido' });
    }

    const existe = await get(`SELECT id FROM usuarios WHERE lower(login) = $1`, [login]);
    if (existe) {
      registrarFalhaLogin(ip);
      return res.status(409).json({ erro: 'Esse usuário já existe' });
    }

    const nome = nomeRaw.slice(0, 40) || login.charAt(0).toUpperCase() + login.slice(1);
    const cor = CORES_NOVOS[(await get(`SELECT COUNT(*)::int AS n FROM usuarios`))?.n % CORES_NOVOS.length] || '#3b82f6';
    const id = uuid();

    await run(
      `INSERT INTO usuarios (id, login, nome, senha_hash, cor, ativo)
       VALUES ($1,$2,$3,$4,$5,true)`,
      [id, login, nome, hashSenha(senha), cor]
    );

    limparLogin(ip);
    abrirSessao(req, res, { id, login, nome, cor });
  } catch (err) {
    console.error('[auth] register:', err.message);
    res.status(500).json({ erro: 'Falha ao cadastrar. Tenta de novo.' });
  }
});

router.get('/me', async (req, res) => {
  if (SKIP_USER_ID) {
    return res.json({
      authenticated: true,
      user: { id: SKIP_USER_ID, nome: 'Dev', login: 'dev', cor: '#f97316' }
    });
  }
  if (!req.session?.userId) {
    return res.json({ authenticated: false });
  }
  try {
    const user = await get(
      `SELECT id, login, nome, cor FROM usuarios WHERE id = $1 AND ativo = true`,
      [req.session.userId]
    );
    if (!user) {
      req.session.destroy(() => {});
      return res.json({ authenticated: false, erro: 'sessao_invalida' });
    }
    req.session.userName = user.nome;
    req.session.userLogin = user.login;
    req.session.userCor = user.cor;
    const stats = await get(
      `SELECT
         (SELECT COUNT(*)::int FROM tasks WHERE user_id = $1) AS tasks,
         (SELECT COUNT(*)::int FROM financeiro WHERE user_id = $1) AS financeiro`,
      [user.id]
    );
    res.json({
      authenticated: true,
      user: {
        id: user.id,
        nome: user.nome,
        login: user.login,
        cor: user.cor,
        stats: {
          tasks: Number(stats?.tasks || 0),
          financeiro: Number(stats?.financeiro || 0)
        }
      },
    });
  } catch (err) {
    console.error('[auth] me:', err.message);
    res.status(500).json({ erro: 'Falha ao ler a sessão.' });
  }
});

router.get('/check', (req, res) => {
  const uid = getUserId(req);
  if (uid) {
    return res.json({
      authenticated: true,
      user: {
        id: uid,
        nome: req.session?.userName,
        login: req.session?.userLogin
      }
    });
  }
  res.json({ authenticated: false });
});

router.get('/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

module.exports = { router, requireAuth };
