const express = require('express');
const { v4: uuid } = require('uuid');
const { run, get, all } = require('../lib/db');

const router = express.Router();

// Espelho do plano usado no frontend (seed de despesas do mês)
const PLANO_FINANCEIRO = {
  boletos: [
    { nome: 'Academia', valor: 85.0, dia: 5, categoria: 'saude' },
    { nome: 'Água (média)', valor: 80.0, dia: 8, categoria: 'contas_fixas' },
    { nome: 'Internet', valor: 70.0, dia: 11, categoria: 'contas_fixas' },
    { nome: 'Consórcio', valor: 410.04, dia: 10, categoria: 'contas_fixas' }
  ],
  emprestimo: { nome: 'Empréstimo', valor: 1188.65, dia: 23, categoria: 'contas_fixas' },
  assinaturas: { nome: 'Assinaturas', valor: 175.08, dia: 1, categoria: 'assinaturas' },
  projetos: { nome: 'Projetos (hospedagem)', valor: 38.99, dia: 5, categoria: 'assinaturas' }
};

function ymValido(ym) {
  return typeof ym === 'string' && /^\d{4}-\d{2}$/.test(ym);
}

function ymAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function diasNoMes(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

function diaHoje() {
  return new Date().getDate();
}

function normalizaTexto(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function similaridade(a, b) {
  const ta = new Set(normalizaTexto(a).split(' ').filter(Boolean));
  const tb = new Set(normalizaTexto(b).split(' ').filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.max(ta.size, tb.size);
}

function valorCasa(esperado, real) {
  const e = Math.abs(Number(esperado));
  const r = Math.abs(Number(real));
  const tol = Math.max(2, e * 0.02);
  return Math.abs(e - r) <= tol;
}

function dataDentroJanela(dataStr, ym, diaVenc, janela = 3) {
  if (!dataStr) return false;
  const d = new Date(dataStr);
  if (Number.isNaN(d.getTime())) return false;
  const txYm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  if (txYm !== ym) return false;
  if (!diaVenc) return true;
  return Math.abs(d.getDate() - Number(diaVenc)) <= janela;
}

async function seedMesSeVazio(ym) {
  const count = await get(`SELECT COUNT(*)::int AS n FROM despesas_mes WHERE ym = $1`, [ym]);
  if (count && count.n > 0) return { seeded: false, count: count.n };

  const itens = [
    ...PLANO_FINANCEIRO.boletos.map((b) => ({
      titulo: b.nome,
      valor: b.valor,
      dia: b.dia,
      categoria: b.categoria,
      origem: 'plano'
    })),
    {
      titulo: PLANO_FINANCEIRO.emprestimo.nome,
      valor: PLANO_FINANCEIRO.emprestimo.valor,
      dia: PLANO_FINANCEIRO.emprestimo.dia,
      categoria: PLANO_FINANCEIRO.emprestimo.categoria,
      origem: 'plano'
    },
    {
      titulo: PLANO_FINANCEIRO.assinaturas.nome,
      valor: PLANO_FINANCEIRO.assinaturas.valor,
      dia: PLANO_FINANCEIRO.assinaturas.dia,
      categoria: PLANO_FINANCEIRO.assinaturas.categoria,
      origem: 'plano'
    },
    {
      titulo: PLANO_FINANCEIRO.projetos.nome,
      valor: PLANO_FINANCEIRO.projetos.valor,
      dia: PLANO_FINANCEIRO.projetos.dia,
      categoria: PLANO_FINANCEIRO.projetos.categoria,
      origem: 'plano'
    }
  ];

  const maxDia = diasNoMes(ym);
  const hojeYm = ymAtual();
  const hojeDia = diaHoje();

  for (const item of itens) {
    const dia = Math.min(item.dia || 1, maxDia);
    let status = 'pendente';
    if (ym < hojeYm) status = 'atrasado';
    else if (ym === hojeYm && dia < hojeDia) status = 'atrasado';

    await run(
      `INSERT INTO despesas_mes (id, ym, titulo, valor_esperado, dia_vencimento, categoria, status, origem)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [uuid(), ym, item.titulo, item.valor, dia, item.categoria || 'outros', status, item.origem]
    );
  }
  return { seeded: true, count: itens.length };
}

function enriquecerStatus(row, ym) {
  const hojeYm = ymAtual();
  const hojeDia = diaHoje();
  let status = row.status;
  if (status === 'pendente') {
    if (ym < hojeYm) status = 'atrasado';
    else if (ym === hojeYm && row.dia_vencimento && Number(row.dia_vencimento) < hojeDia) status = 'atrasado';
  }
  return { ...row, status, valor_esperado: Number(row.valor_esperado) };
}

function resumo(lista) {
  const r = { esperado: 0, pago: 0, pendente: 0, atrasado: 0, ignorado: 0, qtd: lista.length };
  for (const d of lista) {
    const v = Number(d.valor_esperado) || 0;
    r.esperado += v;
    if (d.status === 'pago') r.pago += v;
    else if (d.status === 'atrasado') r.atrasado += v;
    else if (d.status === 'ignorado') r.ignorado += v;
    else r.pendente += v;
  }
  for (const k of ['esperado', 'pago', 'pendente', 'atrasado', 'ignorado']) {
    r[k] = Math.round(r[k] * 100) / 100;
  }
  return r;
}

// GET /api/despesas?ym=YYYY-MM  (+ seed se vazio)
router.get('/', async (req, res) => {
  try {
    const ym = ymValido(req.query.ym) ? req.query.ym : ymAtual();
    const seed = await seedMesSeVazio(ym);
    const rows = await all(
      `SELECT * FROM despesas_mes WHERE ym = $1 ORDER BY
        CASE status WHEN 'atrasado' THEN 0 WHEN 'pendente' THEN 1 WHEN 'pago' THEN 2 ELSE 3 END,
        COALESCE(dia_vencimento, 99), titulo`,
      [ym]
    );
    const despesas = rows.map((r) => enriquecerStatus(r, ym));
    // Persiste status atrasado derivado (só visual → DB se mudou)
    for (const d of despesas) {
      if (d.status === 'atrasado' && rows.find((x) => x.id === d.id)?.status === 'pendente') {
        await run(`UPDATE despesas_mes SET status = 'atrasado' WHERE id = $1 AND status = 'pendente'`, [d.id]);
      }
    }
    res.json({ ym, seed, despesas, resumo: resumo(despesas) });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// POST /api/despesas
router.post('/', async (req, res) => {
  try {
    const ym = ymValido(req.body.ym) ? req.body.ym : ymAtual();
    const titulo = String(req.body.titulo || '').trim();
    const valor = Number(req.body.valor_esperado ?? req.body.valor);
    if (!titulo || !Number.isFinite(valor) || valor <= 0) {
      return res.status(400).json({ erro: 'titulo e valor_esperado obrigatorios' });
    }
    const dia = req.body.dia_vencimento != null ? Number(req.body.dia_vencimento) : null;
    const categoria = req.body.categoria || 'outros';
    const origem = req.body.origem || 'manual';
    const id = uuid();

    let status = 'pendente';
    const hojeYm = ymAtual();
    const hojeDia = diaHoje();
    if (ym < hojeYm) status = 'atrasado';
    else if (ym === hojeYm && dia && dia < hojeDia) status = 'atrasado';

    await run(
      `INSERT INTO despesas_mes (id, ym, titulo, valor_esperado, dia_vencimento, categoria, status, origem)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, ym, titulo, valor, dia, categoria, status, origem]
    );
    const row = await get(`SELECT * FROM despesas_mes WHERE id = $1`, [id]);
    res.status(201).json(enriquecerStatus(row, ym));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// POST /api/despesas/reconciliar — antes de /:id
router.post('/reconciliar', async (req, res) => {
  try {
    const ym = ymValido(req.query.ym || req.body?.ym) ? (req.query.ym || req.body.ym) : ymAtual();
    await seedMesSeVazio(ym);

    const pendentes = await all(
      `SELECT * FROM despesas_mes WHERE ym = $1 AND status IN ('pendente','atrasado')`,
      [ym]
    );
    const txs = await all(
      `SELECT id, descricao, valor, data, fonte
       FROM financeiro
       WHERE tipo = 'saida'
         AND TO_CHAR(data::date, 'YYYY-MM') = $1
         AND id NOT IN (SELECT tx_id FROM despesas_mes WHERE tx_id IS NOT NULL)`,
      [ym]
    );

    const usados = new Set();
    let matched = 0;

    for (const desp of pendentes) {
      let melhor = null;
      let melhorScore = 0;
      for (const tx of txs) {
        if (usados.has(tx.id)) continue;
        if (!valorCasa(desp.valor_esperado, tx.valor)) continue;
        if (!dataDentroJanela(tx.data, ym, desp.dia_vencimento, 3)) continue;
        const score = similaridade(desp.titulo, tx.descricao);
        const scoreFinal = score + 0.35;
        if (scoreFinal > melhorScore) {
          melhorScore = scoreFinal;
          melhor = tx;
        }
      }
      if (melhor && melhorScore >= 0.35) {
        usados.add(melhor.id);
        const pagoEm =
          typeof melhor.data === 'string'
            ? melhor.data.slice(0, 10)
            : new Date(melhor.data).toISOString().slice(0, 10);
        await run(
          `UPDATE despesas_mes SET status = 'pago', pago_em = $1, confirmado_por = 'banco', tx_id = $2
           WHERE id = $3`,
          [pagoEm, melhor.id, desp.id]
        );
        matched++;
      }
    }

    const rows = await all(
      `SELECT * FROM despesas_mes WHERE ym = $1 ORDER BY dia_vencimento NULLS LAST, titulo`,
      [ym]
    );
    const despesas = rows.map((r) => enriquecerStatus(r, ym));
    res.json({ ym, matched, despesas, resumo: resumo(despesas) });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// PATCH /api/despesas/:id
router.patch('/:id', async (req, res) => {
  try {
    const row = await get(`SELECT * FROM despesas_mes WHERE id = $1`, [req.params.id]);
    if (!row) return res.status(404).json({ erro: 'Despesa nao encontrada' });

    const titulo = req.body.titulo != null ? String(req.body.titulo).trim() : row.titulo;
    const valor =
      req.body.valor_esperado != null ? Number(req.body.valor_esperado) : Number(row.valor_esperado);
    const dia =
      req.body.dia_vencimento !== undefined ? req.body.dia_vencimento : row.dia_vencimento;
    const categoria = req.body.categoria != null ? req.body.categoria : row.categoria;

    let status = row.status;
    let pago_em = row.pago_em;
    let confirmado_por = row.confirmado_por;
    let tx_id = row.tx_id;

    if (req.body.status === 'pago' || req.body.acao === 'confirmar') {
      status = 'pago';
      pago_em = req.body.pago_em || new Date().toISOString().slice(0, 10);
      confirmado_por = req.body.confirmado_por || 'manual';
      if (req.body.tx_id) tx_id = req.body.tx_id;
    } else if (req.body.status === 'pendente' || req.body.acao === 'desvincular') {
      status = 'pendente';
      pago_em = null;
      confirmado_por = null;
      tx_id = null;
    } else if (req.body.status === 'ignorado' || req.body.acao === 'ignorar') {
      status = 'ignorado';
    } else if (req.body.status) {
      status = req.body.status;
    }

    await run(
      `UPDATE despesas_mes SET
        titulo = $1, valor_esperado = $2, dia_vencimento = $3, categoria = $4,
        status = $5, pago_em = $6, confirmado_por = $7, tx_id = $8
       WHERE id = $9`,
      [titulo, valor, dia, categoria, status, pago_em, confirmado_por, tx_id, req.params.id]
    );
    const updated = await get(`SELECT * FROM despesas_mes WHERE id = $1`, [req.params.id]);
    res.json(enriquecerStatus(updated, updated.ym));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// DELETE /api/despesas/:id
router.delete('/:id', async (req, res) => {
  try {
    await run(`DELETE FROM despesas_mes WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;
