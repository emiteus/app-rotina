const express = require('express');
const { run, all, get } = require('../lib/db');
const { requireUserId } = require('../lib/tenant');

const router = express.Router();

// Normaliza label -> chave (lowercase, sem acento, sem espaço)
function normalizar(label) {
  return String(label || '').toLowerCase()
    .normalize('NFD').replace(/[^a-z0-9]/g, '');
}

async function categoriaExiste(chave, uid) {
  const r = await get(
    `SELECT chave FROM categorias WHERE chave = $1 AND (user_id IS NULL OR user_id = $2)`,
    [chave, uid]
  );
  return !!r;
}

// GET lista de categorias (seed global + custom do usuário)
router.get('/lista', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const rows = await all(
      `SELECT chave AS id, label FROM categorias
       WHERE user_id IS NULL OR user_id = $1
       ORDER BY label`,
      [uid]
    );
    res.json({ categorias: rows });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// POST cria nova categoria custom (user_id). Seed global permanece user_id NULL.
router.post('/lista', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const label = String((req.body && req.body.label) || '').trim();
  const forcar = !!(req.body && req.body.forcar);
  if (!label) return res.status(400).json({ erro: 'label obrigatório' });
  const chave = normalizar(label);
  if (!chave) return res.status(400).json({ erro: 'label inválido' });

  try {
    const existente = await get(
      `SELECT chave AS id, label FROM categorias
       WHERE chave = $1 AND (user_id IS NULL OR user_id = $2)`,
      [chave, uid]
    );
    if (existente) return res.json({ ok: true, categoria: existente, existente: true });

    if (!forcar) {
      const cands = await all(
        `SELECT chave AS id, label FROM categorias WHERE user_id IS NULL OR user_id = $1`,
        [uid]
      );
      const similares = cands.filter(c => {
        if (chave.length < 3 || c.id.length < 3) return false;
        return c.id.startsWith(chave.substring(0, 3)) || chave.startsWith(c.id.substring(0, 3));
      });
      if (similares.length) return res.json({ ok: false, similares });
    }

    await run(
      `INSERT INTO categorias (chave, label, criado_por_usuario, user_id) VALUES ($1,$2,true,$3)`,
      [chave, label, uid]
    );
    res.status(201).json({ ok: true, categoria: { id: chave, label }, criada: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// GET fila de pendentes (agrupada por chave/estabelecimento, com transações detalhadas)
router.get('/pendentes', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const rows = await all(`
      SELECT f.id, f.chave_categoria AS chave, f.descricao, f.data, f.valor, f.tipo, f.categoria AS sugestao,
             COALESCE(i.apelido, a.nome, 'Conta') AS banco, i.pessoa
      FROM financeiro f
      LEFT JOIN openfinance_accounts a ON a.account_id = f.account_id
      LEFT JOIN openfinance_items i ON i.item_id = a.item_id
      WHERE f.user_id = $1
        AND COALESCE(f.categoria_confirmada, false) = false
        AND f.chave_categoria IS NOT NULL
      ORDER BY f.data DESC
    `, [uid]);

    const grupos = {};
    for (const r of rows) {
      if (!grupos[r.chave]) {
        grupos[r.chave] = { chave: r.chave, exemplo: r.descricao, qtd: 0, total: 0, sugestao: r.sugestao, tipo: r.tipo, transacoes: [] };
      }
      const g = grupos[r.chave];
      g.qtd++;
      g.total += Number(r.valor) || 0;
      g.transacoes.push({
        data: r.data,
        valor: Number(r.valor) || 0,
        tipo: r.tipo,
        banco: r.banco,
        pessoa: r.pessoa || 'PF'
      });
    }
    const pendentes = Object.values(grupos).sort((a, b) => b.total - a.total);
    res.json({ pendentes, qtd: pendentes.length });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// POST aprender: cria/atualiza a regra e aplica em todas as transações da chave
router.post('/aprender', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const { chave, categoria, exemplo, ids } = req.body || {};
  if (!chave || !categoria) return res.status(400).json({ erro: 'chave e categoria obrigatórios' });
  if (!(await categoriaExiste(categoria, uid))) return res.status(400).json({ erro: 'categoria inválida' });
  try {
    await run(
      `INSERT INTO categoria_regras (chave, categoria, exemplo, user_id)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (chave) DO UPDATE SET categoria = EXCLUDED.categoria, user_id = EXCLUDED.user_id`,
      [chave, categoria, exemplo || null, uid]
    );
    if (Array.isArray(ids) && ids.length) {
      await run(
        `UPDATE financeiro
         SET chave_categoria = COALESCE(NULLIF(chave_categoria,''), $1)
         WHERE user_id = $2 AND id = ANY($3::text[])`,
        [chave, uid, ids]
      );
    }
    const r = await run(
      `UPDATE financeiro SET categoria = $1, categoria_confirmada = true
       WHERE user_id = $2 AND chave_categoria = $3`,
      [categoria, uid, chave]
    );
    let aplicadas = r.rowCount || 0;
    if ((!aplicadas || aplicadas === 0) && Array.isArray(ids) && ids.length) {
      const r2 = await run(
        `UPDATE financeiro
         SET categoria = $1, categoria_confirmada = true, chave_categoria = $2
         WHERE user_id = $3 AND id = ANY($4::text[])`,
        [categoria, chave, uid, ids]
      );
      aplicadas = r2.rowCount || 0;
    }
    res.json({ ok: true, aplicadas });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// GET regras aprendidas
router.get('/regras', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const regras = await all(
      `SELECT chave, categoria, exemplo FROM categoria_regras WHERE user_id = $1 ORDER BY criado_em DESC`,
      [uid]
    );
    res.json({ regras });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// PATCH editar uma regra (corrigir categoria) e re-aplicar
router.patch('/regras/:chave', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const { categoria } = req.body || {};
  if (!(await categoriaExiste(categoria, uid))) return res.status(400).json({ erro: 'categoria inválida' });
  try {
    await run(
      `UPDATE categoria_regras SET categoria = $1 WHERE chave = $2 AND user_id = $3`,
      [categoria, req.params.chave, uid]
    );
    await run(
      `UPDATE financeiro SET categoria = $1, categoria_confirmada = true
       WHERE user_id = $2 AND chave_categoria = $3`,
      [categoria, uid, req.params.chave]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// DELETE remover regra (transações voltam a ficar pendentes)
router.delete('/regras/:chave', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    await run(`DELETE FROM categoria_regras WHERE chave = $1 AND user_id = $2`, [req.params.chave, uid]);
    await run(
      `UPDATE financeiro SET categoria_confirmada = false
       WHERE user_id = $1 AND chave_categoria = $2`,
      [uid, req.params.chave]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;
