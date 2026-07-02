const express = require('express');
const { run, all } = require('../lib/db');

const router = express.Router();

// GET visão geral das apostas
router.get('/', async (req, res) => {
  try {
    // Transações de aposta ainda não classificadas
    const pendentes = await all(`
      SELECT f.id, f.descricao, f.data, f.valor, f.tipo,
             COALESCE(i.apelido, a.nome, 'Conta') AS banco
      FROM financeiro f
      LEFT JOIN openfinance_accounts a ON a.account_id = f.account_id
      LEFT JOIN openfinance_items i ON i.item_id = a.item_id
      WHERE f.categoria = 'apostas' AND f.aposta_autor IS NULL AND f.aposta_amigo IS NULL
      ORDER BY f.data DESC
    `);

    // Minha parte (valor - parte do amigo quando 'eu' participei)
    const minhas = await all(`
      SELECT tipo, COALESCE(SUM(valor - COALESCE(aposta_amigo_valor,0)),0) AS total, COUNT(*)::int AS qtd
      FROM financeiro
      WHERE categoria = 'apostas' AND aposta_autor = 'eu'
      GROUP BY tipo
    `);
    const apostado = Number((minhas.find(m => m.tipo === 'saida') || {}).total || 0);
    const ganho = Number((minhas.find(m => m.tipo === 'entrada') || {}).total || 0);

    // Parte dos amigos (aposta_amigo_valor): saída = me deve; entrada = me pagou
    const porAmigoTx = await all(`
      SELECT aposta_amigo AS amigo, tipo, COALESCE(SUM(aposta_amigo_valor),0) AS total
      FROM financeiro
      WHERE categoria = 'apostas' AND aposta_amigo IS NOT NULL AND aposta_amigo_valor IS NOT NULL
      GROUP BY aposta_amigo, tipo
    `);
    const pagamentos = await all(`SELECT amigo, COALESCE(SUM(valor),0) AS total FROM apostas_pagamentos GROUP BY amigo`);

    const mapa = {};
    porAmigoTx.forEach(r => {
      if (!mapa[r.amigo]) mapa[r.amigo] = { amigo: r.amigo, apostado: 0, recebido: 0, pago: 0 };
      if (r.tipo === 'saida') mapa[r.amigo].apostado += Number(r.total);
      else mapa[r.amigo].recebido += Number(r.total);
    });
    pagamentos.forEach(p => {
      if (!mapa[p.amigo]) mapa[p.amigo] = { amigo: p.amigo, apostado: 0, recebido: 0, pago: 0 };
      mapa[p.amigo].pago += Number(p.total);
    });

    const amigos = Object.values(mapa).map(a => {
      const saldo = a.apostado - a.recebido - a.pago;
      return { ...a, saldo, status: saldo <= 0.009 ? 'quitado' : 'pendente' };
    }).sort((a, b) => b.saldo - a.saldo);

    const totalReceber = amigos.reduce((s, a) => s + Math.max(a.saldo, 0), 0);

    res.json({
      pendentes,
      minhas: { apostado, ganho, liquido: ganho - apostado },
      amigos,
      totalReceber
    });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// POST classificar uma aposta: modo 'eu' | 'amigo' | 'conjunto'
router.post('/atribuir', async (req, res) => {
  const { transacaoId, modo, amigo, valorAmigo } = req.body || {};
  if (!transacaoId || !modo) return res.status(400).json({ erro: 'transacaoId e modo obrigatórios' });
  try {
    if (modo === 'eu') {
      await run(`UPDATE financeiro SET aposta_autor='eu', aposta_amigo=NULL, aposta_amigo_valor=NULL WHERE id=$1 AND categoria='apostas'`, [transacaoId]);
    } else if (modo === 'amigo') {
      if (!amigo) return res.status(400).json({ erro: 'amigo obrigatório' });
      // parte do amigo = valor total da transação
      await run(`UPDATE financeiro SET aposta_autor=NULL, aposta_amigo=$1, aposta_amigo_valor=valor WHERE id=$2 AND categoria='apostas'`, [amigo.trim(), transacaoId]);
    } else if (modo === 'conjunto') {
      if (!amigo) return res.status(400).json({ erro: 'amigo obrigatório' });
      const v = parseFloat(valorAmigo);
      if (isNaN(v) || v < 0) return res.status(400).json({ erro: 'valorAmigo inválido' });
      await run(`UPDATE financeiro SET aposta_autor='eu', aposta_amigo=$1, aposta_amigo_valor=LEAST($2, valor) WHERE id=$3 AND categoria='apostas'`, [amigo.trim(), v, transacaoId]);
    } else {
      return res.status(400).json({ erro: 'modo inválido' });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// POST desvincular uma transação de "apostas" e recategorizá-la (também remove a regra aprendida)
router.post('/desvincular', async (req, res) => {
  const { transacaoId, novaCategoria } = req.body || {};
  if (!transacaoId) return res.status(400).json({ erro: 'transacaoId obrigatório' });
  const cat = String(novaCategoria || 'outros').trim();
  try {
    // Descobre a chave de aprendizado da transação
    const tx = await all(`SELECT chave_categoria FROM financeiro WHERE id = $1`, [transacaoId]);
    const chave = tx[0] && tx[0].chave_categoria;

    // Recategoriza (também limpa autor/amigo de aposta) e marca como confirmada
    await run(
      `UPDATE financeiro
         SET categoria = $1, categoria_confirmada = true,
             aposta_autor = NULL, aposta_amigo = NULL, aposta_amigo_valor = NULL
       WHERE id = $2`,
      [cat, transacaoId]
    );

    // Se havia regra aprendida ligada a essa chave → remove (evita erro no futuro)
    let regraRemovida = false;
    if (chave) {
      const reg = await all(`SELECT categoria FROM categoria_regras WHERE chave = $1`, [chave]);
      if (reg[0] && reg[0].categoria === 'apostas') {
        await run(`DELETE FROM categoria_regras WHERE chave = $1`, [chave]);
        regraRemovida = true;
        // Coloca as demais transações da mesma chave de volta na fila (não confirmadas)
        await run(
          `UPDATE financeiro
             SET categoria_confirmada = false
           WHERE chave_categoria = $1 AND id <> $2 AND categoria = 'apostas'`,
          [chave, transacaoId]
        );
      }
    }
    res.json({ ok: true, regraRemovida });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// POST registrar pagamento de um amigo
router.post('/pagamento', async (req, res) => {
  const { amigo, valor, descricao } = req.body || {};
  const v = parseFloat(valor);
  if (!amigo || isNaN(v) || v <= 0) return res.status(400).json({ erro: 'amigo e valor válidos obrigatórios' });
  try {
    await run(`INSERT INTO apostas_pagamentos (amigo, valor, descricao) VALUES ($1,$2,$3)`, [amigo.trim(), v, descricao || null]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;
