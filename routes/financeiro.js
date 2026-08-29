const express = require('express');
const { v4: uuid } = require('uuid');
const { run, get, all } = require('../lib/db');
const { hojeStr, ymAtual, ymdDe } = require('../lib/datas');
const { nomeBancoDisplay, labelContaExtrato } = require('../lib/banco-nome');

let wsServer; // Será setado pelo server.js

const router = express.Router();

// Pagamento de fatura / rotativo = quitação do cartão, não gasto novo
// (o gasto já entra nas compras/assinaturas individuais do cartão)
const SQL_EXCLUI_FATURA = `
  NOT (
    lower(COALESCE(categoria,'')) = 'faturas'
    OR lower(COALESCE(categoria,'')) LIKE 'fatura%'
    OR lower(COALESCE(categoria,'')) LIKE '%cartaointer%'
    OR lower(COALESCE(categoria,'')) LIKE '%rotativo%'
  )
`;

// Função pra emitir eventos WebSocket
function emitFinanceiroUpdate(tipo, dados) {
  if (wsServer) {
    wsServer.broadcast({
      tipo: 'financeiro-' + tipo,
      dados
    });
  }
}

// GET todas transacoes + totais (entradas/saídas = últimos 30 dias)
router.get('/', async (req, res) => {
  try {
    const dias = Math.min(Math.max(Number(req.query.dias) || 30, 1), 365);
    const transacoes = await all(`
      SELECT * FROM financeiro
      ORDER BY data DESC, criado_em DESC
    `);

    const periodo = await get(`
      SELECT
        COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN valor ELSE 0 END), 0) as entradas,
        COALESCE(SUM(CASE WHEN tipo = 'saida' AND ${SQL_EXCLUI_FATURA} THEN valor ELSE 0 END), 0) as saidas
      FROM financeiro
      WHERE data >= CURRENT_DATE - ($1::int * INTERVAL '1 day')
    `, [dias]);

    const entradas = Number(periodo?.entradas || 0);
    const saidas = Number(periodo?.saidas || 0);

    res.json({
      transacoes,
      dias,
      entradas,
      saidas,
      saldo: entradas - saidas,
      sobra: entradas - saidas
    });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// GET /api/financeiro/extrato — movimentações com filtros de período e conta
router.get('/extrato', async (req, res) => {
  try {
    const hoje = hojeStr();
    let from = String(req.query.from || '').slice(0, 10);
    let to = String(req.query.to || '').slice(0, 10);
    const dias = Math.min(Math.max(Number(req.query.dias) || 0, 0), 365);
    const accountId = String(req.query.account_id || '').trim();
    const itemId = String(req.query.item_id || '').trim();
    const tipo = String(req.query.tipo || '').trim(); // entrada|saida|''
    const q = String(req.query.q || '').trim();
    const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 5000);

    if (!from && !to && dias > 0) {
      const d = new Date();
      d.setDate(d.getDate() - dias);
      from = d.toISOString().slice(0, 10);
      to = hoje;
    }
    if (!from) {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      from = d.toISOString().slice(0, 10);
    }
    if (!to) to = hoje;

    const where = ['COALESCE(f.data::date, f.criado_em::date) >= $1::date', 'COALESCE(f.data::date, f.criado_em::date) <= $2::date'];
    const vals = [from, to];
    let i = 3;

    if (accountId === 'manual') {
      where.push('f.account_id IS NULL');
    } else if (accountId) {
      where.push(`f.account_id = $${i++}`);
      vals.push(accountId);
    } else if (itemId) {
      where.push(`a.item_id = $${i++}`);
      vals.push(itemId);
    }

    if (tipo === 'entrada' || tipo === 'saida') {
      where.push(`f.tipo = $${i++}`);
      vals.push(tipo);
    }

    if (q) {
      where.push(`f.descricao ILIKE $${i++}`);
      vals.push(`%${q}%`);
    }

    vals.push(limit);
    const limitIdx = i;

    const movimentacoes = await all(
      `SELECT f.id, f.tipo, f.valor, f.descricao, TO_CHAR(COALESCE(f.data::date, f.criado_em::date), 'YYYY-MM-DD') AS data,
              f.categoria, f.fonte, f.account_id, f.pago_terceiro, f.terceiro_nome, f.terceiro_notas,
              a.nome AS conta_nome, a.tipo AS conta_tipo, a.item_id,
              i.apelido, i.connector_nome, i.pessoa,
              COALESCE(i.apelido, i.connector_nome, 'Manual') AS banco
       FROM financeiro f
       LEFT JOIN openfinance_accounts a ON a.account_id = f.account_id
       LEFT JOIN openfinance_items i ON i.item_id = a.item_id
       WHERE ${where.join(' AND ')}
       ORDER BY f.data DESC, f.criado_em DESC
       LIMIT $${limitIdx}`,
      vals
    );

    const resumoVals = vals.slice(0, -1); // sem limit
    const resumo = await get(
      `SELECT
         COUNT(*)::int AS qtd,
         COALESCE(SUM(CASE WHEN f.tipo = 'entrada' THEN f.valor ELSE 0 END), 0) AS entradas,
         COALESCE(SUM(CASE WHEN f.tipo = 'saida' THEN f.valor ELSE 0 END), 0) AS saidas
       FROM financeiro f
       LEFT JOIN openfinance_accounts a ON a.account_id = f.account_id
       WHERE ${where.join(' AND ')}`,
      resumoVals
    );

    const contas = await all(
      `SELECT a.account_id, a.tipo, a.nome, a.item_id,
              i.apelido, i.connector_nome, i.pessoa,
              COALESCE(i.apelido, i.connector_nome, 'Banco') AS banco
       FROM openfinance_accounts a
       JOIN openfinance_items i ON i.item_id = a.item_id
       ORDER BY
         CASE WHEN a.tipo = 'CREDIT' THEN 1 ELSE 0 END,
         CASE WHEN i.pessoa = 'PJ' THEN 1 ELSE 0 END,
         COALESCE(i.apelido, i.connector_nome, a.nome),
         a.nome`
    );

    const entradas = Number(resumo?.entradas || 0);
    const saidas = Number(resumo?.saidas || 0);
    res.json({
      from,
      to,
      movimentacoes: (movimentacoes || []).map((m) => {
        const banco = m.account_id
          ? nomeBancoDisplay({
              apelido: m.apelido,
              connector_nome: m.connector_nome,
              pessoa: m.pessoa,
              contasNomes: m.conta_nome
            })
          : 'Manual';
        return {
          ...m,
          banco,
          valor: Number(m.valor),
          data: m.data || null
        };
      }),
      resumo: {
        qtd: Number(resumo?.qtd || 0),
        entradas,
        saidas,
        saldo: Math.round((entradas - saidas) * 100) / 100
      },
      contas: (contas || []).map((c) => {
        const banco = nomeBancoDisplay({
          apelido: c.apelido,
          connector_nome: c.connector_nome,
          pessoa: c.pessoa,
          contasNomes: c.nome
        });
        return {
          account_id: c.account_id,
          item_id: c.item_id,
          tipo: c.tipo,
          nome: c.nome,
          banco,
          pessoa: c.pessoa,
          label: labelContaExtrato({ ...c, banco, tipo: c.tipo, pessoa: c.pessoa })
        };
      })
    });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// GET stats mensais (últimos 18 meses)
router.get('/stats', async (req, res) => {
  try {
    const ymFiltro = /^\d{4}-\d{2}$/.test(String(req.query.ym || '')) ? String(req.query.ym) : null;
    const stats = await all(`
      SELECT
        TO_CHAR(data, 'YYYY-MM') as mes,
        COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN valor ELSE 0 END), 0) as entradas,
        COALESCE(SUM(CASE WHEN tipo = 'saida' THEN valor ELSE 0 END), 0) as saidas
      FROM financeiro
      WHERE data >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '18 months'
      GROUP BY TO_CHAR(data, 'YYYY-MM')
      ORDER BY mes ASC
    `);

    const porCategoria = await all(
      `
      SELECT categoria, tipo, SUM(valor) as total
      FROM financeiro
      WHERE TO_CHAR(data, 'YYYY-MM') = $1
        AND ${SQL_EXCLUI_FATURA}
      GROUP BY categoria, tipo
      ORDER BY total DESC
    `,
      [ymFiltro || ymAtual()]
    );

    res.json({ ym: ymFiltro || ymAtual(), stats, porCategoria });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// GET saldo do período (padrão: 30 dias)
router.get('/saldo', async (req, res) => {
  try {
    const dias = Math.min(Math.max(Number(req.query.dias) || 30, 1), 365);
    const row = await get(`
      SELECT
        COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN valor ELSE 0 END), 0) as entradas,
        COALESCE(SUM(CASE WHEN tipo = 'saida' THEN valor ELSE 0 END), 0) as saidas
      FROM financeiro
      WHERE data >= CURRENT_DATE - ($1::int * INTERVAL '1 day')
    `, [dias]);
    const entradas = Number(row?.entradas || 0);
    const saidas = Number(row?.saidas || 0);
    res.json({ saldo: entradas - saidas, entradas, saidas, dias });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// POST nova transacao
router.post('/', async (req, res) => {
  const { tipo, valor, descricao, data, categoria } = req.body;

  if (!tipo || !valor) {
    return res.status(400).json({ erro: 'Tipo e valor obrigatorios' });
  }
  if (!['entrada', 'saida'].includes(tipo)) {
    return res.status(400).json({ erro: 'Tipo deve ser entrada ou saida' });
  }

  try {
    const id = uuid();
    const dataUso = data || hojeStr();

    await run(
      `INSERT INTO financeiro (id, tipo, valor, descricao, data, categoria)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, tipo, valor, descricao || '', dataUso, categoria || '']
    );

    const transacao = await get(`SELECT * FROM financeiro WHERE id = $1`, [id]);
    emitFinanceiroUpdate('adicionada', transacao);
    res.status(201).json(transacao);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// PATCH — edita SÓ a categoria desta transação (não vira regra pras futuras)
router.patch('/:id/categoria', async (req, res) => {
  const cat = String((req.body && req.body.categoria) || '').trim();
  if (!cat) return res.status(400).json({ erro: 'categoria obrigatória' });
  try {
    const existe = await get(`SELECT chave FROM categorias WHERE chave = $1`, [cat]);
    if (!existe) return res.status(400).json({ erro: 'categoria inválida' });
    const r = await run(
      `UPDATE financeiro SET categoria = $1, categoria_confirmada = true WHERE id = $2`,
      [cat, req.params.id]
    );
    if (!r.rowCount) return res.status(404).json({ erro: 'transação não encontrada' });
    emitFinanceiroUpdate('atualizada', { id: req.params.id, categoria: cat });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// PATCH /api/financeiro/:id/terceiro — pagamento por terceiro / reembolso
router.patch('/:id/terceiro', async (req, res) => {
  try {
    const body = req.body || {};
    const pago = body.pago_terceiro != null ? !!body.pago_terceiro : undefined;
    const nome = body.terceiro_nome != null ? String(body.terceiro_nome).trim() || null : undefined;
    const notas = body.terceiro_notas != null ? String(body.terceiro_notas).trim() || null : undefined;
    const row = await get(`SELECT id FROM financeiro WHERE id = $1`, [req.params.id]);
    if (!row) return res.status(404).json({ erro: 'transação não encontrada' });
    const sets = [];
    const vals = [];
    let p = 1;
    if (pago !== undefined) { sets.push(`pago_terceiro = $${p++}`); vals.push(pago); }
    if (nome !== undefined) { sets.push(`terceiro_nome = $${p++}`); vals.push(nome); }
    if (notas !== undefined) { sets.push(`terceiro_notas = $${p++}`); vals.push(notas); }
    if (!sets.length) return res.status(400).json({ erro: 'nada para atualizar' });
    vals.push(req.params.id);
    await run(`UPDATE financeiro SET ${sets.join(', ')} WHERE id = $${p}`, vals);
    emitFinanceiroUpdate('atualizada', { id: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// DELETE transacao
router.delete('/:id', async (req, res) => {
  try {
    await run(`DELETE FROM financeiro WHERE id = $1`, [req.params.id]);
    emitFinanceiroUpdate('deletada', { id: req.params.id });
    res.json({ msg: 'Transacao deletada' });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// GET /api/financeiro/categoria/:cat — gastos do mês numa categoria (pra revisar "outros" etc.)
router.get('/categoria/:cat', async (req, res) => {
  try {
    const cat = String(req.params.cat || 'outros').trim().toLowerCase() || 'outros';
    const ym = /^\d{4}-\d{2}$/.test(String(req.query.ym || '')) ? String(req.query.ym) : ymAtual();
    const rows = await all(
      `SELECT f.id, f.descricao, f.valor, f.data, f.categoria, f.chave_categoria, f.fonte,
              f.categoria_confirmada, a.tipo AS conta_tipo,
              COALESCE(i.apelido, a.nome, 'Manual') AS banco
       FROM financeiro f
       LEFT JOIN openfinance_accounts a ON a.account_id = f.account_id
       LEFT JOIN openfinance_items i ON i.item_id = a.item_id
       WHERE f.tipo = 'saida'
         AND TO_CHAR(f.data, 'YYYY-MM') = $1
         AND (
           ($2 = 'outros' AND (f.categoria IS NULL OR f.categoria = '' OR lower(f.categoria) IN ('outros','outro')))
           OR lower(COALESCE(f.categoria,'')) = $2
         )
       ORDER BY f.valor DESC, f.data DESC
       LIMIT 200`,
      [ym, cat]
    );

    const gruposMap = {};
    for (const r of rows || []) {
      let chave = r.chave_categoria;
      if (!chave) {
        chave = String(r.descricao || '')
          .toLowerCase()
          .normalize('NFD')
          .replace(/[^a-z0-9]/g, '')
          .slice(0, 40) || 'semchave';
      }
      if (!gruposMap[chave]) {
        gruposMap[chave] = {
          chave,
          exemplo: r.descricao,
          qtd: 0,
          total: 0,
          transacoes: []
        };
      }
      const g = gruposMap[chave];
      g.qtd += 1;
      g.total += Number(r.valor) || 0;
      g.transacoes.push({
        id: r.id,
        data: ymdDe(r.data) || null,
        valor: Number(r.valor) || 0,
        descricao: r.descricao,
        banco: r.banco,
        conta_tipo: r.conta_tipo
      });
    }

    const grupos = Object.values(gruposMap).sort((a, b) => b.total - a.total);
    const total = grupos.reduce((s, g) => s + g.total, 0);
    res.json({
      ym,
      categoria: cat,
      total: Math.round(total * 100) / 100,
      qtd: (rows || []).length,
      grupos
    });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// GET alertas de gasto incomum (mês atual vs média dos meses anteriores por categoria)
router.get('/alertas', async (req, res) => {
  try {
    const rows = await all(`
      SELECT TO_CHAR(data, 'YYYY-MM') AS mes, categoria, SUM(valor) AS total
      FROM financeiro
      WHERE tipo = 'saida' AND data >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '4 months'
      GROUP BY mes, categoria
    `);
    const mesAtual = ymAtual();
    const porCat = {};
    rows.forEach(r => {
      if (!porCat[r.categoria]) porCat[r.categoria] = { atual: 0, anteriores: [] };
      if (r.mes === mesAtual) porCat[r.categoria].atual = Number(r.total);
      else porCat[r.categoria].anteriores.push(Number(r.total));
    });

    const alertas = [];
    Object.entries(porCat).forEach(([cat, d]) => {
      if (d.anteriores.length === 0 || d.atual <= 0) return;
      const media = d.anteriores.reduce((s, v) => s + v, 0) / d.anteriores.length;
      // Significativo: gastou >50% acima da média e a diferença é relevante (> R$50)
      if (media > 0 && d.atual > media * 1.5 && (d.atual - media) > 50) {
        alertas.push({
          categoria: cat,
          atual: d.atual,
          media: Math.round(media * 100) / 100,
          acima: Math.round(((d.atual / media - 1) * 100)),
          diferenca: Math.round((d.atual - media) * 100) / 100
        });
      }
    });
    alertas.sort((a, b) => b.diferenca - a.diferenca);
    res.json({ alertas });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.setWsServer = function(ws) {
  wsServer = ws;
};

module.exports = router;
