const express = require('express');
const { v4: uuid } = require('uuid');
const { run, get, all } = require('../lib/db');
const { ymAtual, hojeStr, diaDoMes } = require('../lib/datas');
const plano = require('../lib/plano-financeiro');
const { requireUserId } = require('../lib/tenant');

const router = express.Router();

function chaveTitulo(s) {
  return normalizaTexto(s);
}

function matchItem(row, item) {
  const nomes = [item.titulo, ...(item.aliases || [])].map(chaveTitulo);
  return nomes.includes(chaveTitulo(row.titulo));
}

function statusInicial(ym, dia) {
  const hojeYm = ymAtual();
  const hojeDia = diaDoMes();
  if (ym < hojeYm) return 'atrasado';
  if (ym === hojeYm && dia && dia < hojeDia) return 'atrasado';
  return 'pendente';
}

async function inserirDespesa(ym, item, statusOverride, userId) {
  const dia = item.dia != null ? Number(item.dia) : null;
  const status = statusOverride || (item.pago ? 'pago' : statusInicial(ym, dia));
  const pagoEm = status === 'pago' ? hojeStr() : null;
  await run(
    `INSERT INTO despesas_mes (id, ym, titulo, valor_esperado, dia_vencimento, categoria, status, origem, pago_em, confirmado_por, user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'plano',$8,$9,$10)`,
    [
      uuid(),
      ym,
      item.titulo,
      item.valor,
      dia,
      item.categoria || 'outros',
      status,
      pagoEm,
      status === 'pago' ? 'manual' : null,
      userId
    ]
  );
}

async function seedMesSeVazio(ym, userId) {
  const count = await get(`SELECT COUNT(*)::int AS n FROM despesas_mes WHERE ym = $1 AND user_id = $2`, [ym, userId]);
  if (count && count.n > 0) return { seeded: false, count: count.n };

  const { isPlanoOwnerUserId } = require('../lib/plano-owner');
  if (!(await isPlanoOwnerUserId(userId))) {
    return { seeded: false, count: 0, skip: 'nao_owner' };
  }

  const itens = plano.itensDoMes(ym);
  const pagos = new Set((plano.pagosPorMes[ym] || []).map(chaveTitulo));
  for (const item of itens) {
    const pago = item.pago || pagos.has(chaveTitulo(item.titulo));
    await inserirDespesa(ym, item, pago ? 'pago' : null, userId);
  }
  return { seeded: true, count: itens.length };
}

async function syncPlanoMes(ym, userId) {
  const { isPlanoOwnerUserId } = require('../lib/plano-owner');
  if (!(await isPlanoOwnerUserId(userId))) {
    return { criadas: 0, atualizadas: 0, ignoradas: 0, skip: 'nao_owner' };
  }

  const rows = await all(`SELECT * FROM despesas_mes WHERE ym = $1 AND user_id = $2`, [ym, userId]);
  let criadas = 0;
  let atualizadas = 0;
  let ignoradas = 0;

  for (const nome of plano.cancelados) {
    const hit = rows.find((r) => chaveTitulo(r.titulo) === chaveTitulo(nome));
    if (hit && hit.status !== 'ignorado' && hit.status !== 'pago') {
      await run(`UPDATE despesas_mes SET status = 'ignorado' WHERE id = $1 AND user_id = $2`, [hit.id, userId]);
      hit.status = 'ignorado';
      ignoradas++;
    }
  }

  const itens = plano.itensDoMes(ym);
  const pagos = new Set((plano.pagosPorMes[ym] || []).map(chaveTitulo));

  for (const item of itens) {
    const existente = rows.find((r) => matchItem(r, item));
    const devePagar = item.pago || pagos.has(chaveTitulo(item.titulo));
    if (!existente) {
      await inserirDespesa(ym, item, devePagar ? 'pago' : null, userId);
      criadas++;
      continue;
    }
    const dia = item.dia != null ? Number(item.dia) : null;
    const campos = [];
    const vals = [];
    let i = 1;
    if (existente.titulo !== item.titulo) {
      campos.push(`titulo = $${i++}`);
      vals.push(item.titulo);
    }
    if (Math.round(Number(existente.valor_esperado) * 100) !== Math.round(Number(item.valor) * 100)) {
      campos.push(`valor_esperado = $${i++}`);
      vals.push(item.valor);
    }
    // Só sobrescreve dia se o plano define um dia fixo (não apaga dia aprendido do cartão)
    if (dia != null && Number(existente.dia_vencimento || 0) !== Number(dia)) {
      campos.push(`dia_vencimento = $${i++}`);
      vals.push(dia);
    }
    if ((existente.categoria || 'outros') !== (item.categoria || 'outros')) {
      campos.push(`categoria = $${i++}`);
      vals.push(item.categoria || 'outros');
    }
    if (devePagar && existente.status !== 'pago') {
      campos.push(`status = $${i++}`);
      vals.push('pago');
      campos.push(`pago_em = $${i++}`);
      vals.push(hojeStr());
      campos.push(`confirmado_por = $${i++}`);
      vals.push('manual');
    }
    if (campos.length) {
      vals.push(existente.id);
      await run(`UPDATE despesas_mes SET ${campos.join(', ')} WHERE id = $${i} AND user_id = $${i + 1}`, [...vals, userId]);
      atualizadas++;
    }
  }

  return { criadas, atualizadas, ignoradas };
}

function ymValido(ym) {
  return typeof ym === 'string' && /^\d{4}-\d{2}$/.test(ym);
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

/** Score de texto: containment de título/alias na descrição do extrato (bom pra fatura de cartão). */
function scoreTexto(titulo, descricao, aliases = []) {
  const d = normalizaTexto(descricao);
  if (!d) return 0;
  const candidatos = [titulo, ...(aliases || [])].map(normalizaTexto).filter(Boolean);
  let best = 0;
  for (const c of candidatos) {
    if (!c) continue;
    if (d.includes(c) || c.includes(d)) best = Math.max(best, 0.95);
    else {
      const tokens = c.split(' ').filter((t) => t.length >= 3);
      const hits = tokens.filter((t) => d.includes(t)).length;
      if (tokens.length && hits === tokens.length) best = Math.max(best, 0.85);
      else if (hits > 0) best = Math.max(best, 0.45 + 0.2 * (hits / tokens.length));
      best = Math.max(best, similaridade(c, d));
    }
  }
  return best;
}

function valorCasa(esperado, real, { frouxo = false } = {}) {
  const e = Math.abs(Number(esperado));
  const r = Math.abs(Number(real));
  const tol = frouxo ? Math.max(8, e * 0.15) : Math.max(2, e * 0.02);
  return Math.abs(e - r) <= tol;
}

/** Normaliza DATE do pg (Date) ou string pra YYYY-MM-DD (UTC date parts). */
function dataISO(d) {
  if (!d) return null;
  if (typeof d === 'string') {
    const m = d.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    const parsed = new Date(d);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10);
  }
  if (d instanceof Date && !Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return null;
}

function dataDentroJanela(dataStr, ym, diaVenc, janela = 3) {
  const iso = dataISO(dataStr);
  if (!iso) return false;
  const txYm = iso.slice(0, 7);
  if (txYm !== ym) return false;
  if (!diaVenc) return true;
  const dia = Number(iso.slice(8, 10));
  return Math.abs(dia - Number(diaVenc)) <= janela;
}

function ymAnterior(ym) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function diaDoPago(pagoEm) {
  if (!pagoEm) return null;
  if (typeof pagoEm === 'string') {
    const m = pagoEm.match(/^\d{4}-\d{2}-(\d{2})/);
    if (m) return Number(m[1]);
  }
  const d = new Date(pagoEm);
  if (Number.isNaN(d.getTime())) return null;
  // Usa UTC date parts se for Date midnight UTC de um DATE do PG
  return d.getUTCDate();
}

async function preencherVencimentoPeloPagamento(ym, userId) {
  const r = await run(
    `UPDATE despesas_mes
     SET dia_vencimento = EXTRACT(DAY FROM pago_em::date)::int
     WHERE ym = $1
       AND user_id = $2
       AND dia_vencimento IS NULL
       AND pago_em IS NOT NULL`,
    [ym, userId]
  );
  return r?.rowCount || 0;
}

function aliasesDaDespesa(titulo) {
  const itens = [...plano.despesas, ...Object.values(plano.extrasPorMes || {}).flat()];
  const hit = itens.find((i) => chaveTitulo(i.titulo) === chaveTitulo(titulo));
  return hit?.aliases || [];
}

function enriquecerStatus(row, ym) {
  const hojeYm = ymAtual();
  const hojeDia = diaDoMes();
  let status = row.status;
  if (status === 'pendente') {
    if (ym < hojeYm) status = 'atrasado';
    else if (ym === hojeYm && row.dia_vencimento && Number(row.dia_vencimento) < hojeDia) status = 'atrasado';
  }
  return { ...row, status, valor_esperado: Number(row.valor_esperado) };
}

function resumo(lista) {
  const r = { esperado: 0, pago: 0, pendente: 0, atrasado: 0, ignorado: 0, qtd: 0 };
  for (const d of lista) {
    // Faturas de cartão já incluem assinaturas/itens listados à parte — não somar de novo
    if ((d.categoria || '') === 'faturas') continue;
    const v = Number(d.valor_esperado) || 0;
    r.qtd++;
    if (d.status === 'ignorado') {
      r.ignorado += v;
      continue;
    }
    r.esperado += v;
    if (d.status === 'pago') r.pago += v;
    else if (d.status === 'atrasado') r.atrasado += v;
    else r.pendente += v;
  }
  for (const k of ['esperado', 'pago', 'pendente', 'atrasado', 'ignorado']) {
    r[k] = Math.round(r[k] * 100) / 100;
  }
  return r;
}

// GET /api/despesas?ym=YYYY-MM  (+ seed se vazio)
router.get('/', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const ym = ymValido(req.query.ym) ? req.query.ym : ymAtual();
    const seed = await seedMesSeVazio(ym, uid);
    const sync = await syncPlanoMes(ym, uid);
    await preencherVencimentoPeloPagamento(ym, uid);
    const rows = await all(
      `SELECT * FROM despesas_mes WHERE ym = $1 AND user_id = $2 ORDER BY
        CASE status WHEN 'atrasado' THEN 0 WHEN 'pendente' THEN 1 WHEN 'pago' THEN 2 ELSE 3 END,
        COALESCE(dia_vencimento, 99), titulo`,
      [ym, uid]
    );
    const despesas = rows.map((r) => enriquecerStatus(r, ym));
    // Persiste status atrasado derivado (só visual → DB se mudou)
    for (const d of despesas) {
      if (d.status === 'atrasado' && rows.find((x) => x.id === d.id)?.status === 'pendente') {
        await run(`UPDATE despesas_mes SET status = 'atrasado' WHERE id = $1 AND user_id = $2 AND status = 'pendente'`, [d.id, uid]);
      }
    }
    res.json({ ym, seed, sync, despesas, resumo: resumo(despesas) });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// POST /api/despesas
router.post('/', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
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
    const hojeDia = diaDoMes();
    if (ym < hojeYm) status = 'atrasado';
    else if (ym === hojeYm && dia && dia < hojeDia) status = 'atrasado';

    await run(
      `INSERT INTO despesas_mes (id, ym, titulo, valor_esperado, dia_vencimento, categoria, status, origem, user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, ym, titulo, valor, dia, categoria, status, origem, uid]
    );
    const row = await get(`SELECT * FROM despesas_mes WHERE id = $1 AND user_id = $2`, [id, uid]);
    res.status(201).json(enriquecerStatus(row, ym));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

/** Casa despesas pendentes com extrato do mês (e mês anterior pra fatura). Exportável. */
async function reconciliarMes(uid, ymIn) {
  const ym = ymValido(ymIn) ? ymIn : ymAtual();
  await seedMesSeVazio(ym, uid);
  await syncPlanoMes(ym, uid);
  await preencherVencimentoPeloPagamento(ym, uid);

  const pendentes = await all(
    `SELECT * FROM despesas_mes WHERE ym = $1 AND user_id = $2 AND status IN ('pendente','atrasado')`,
    [ym, uid]
  );

  const ymPrev = ymAnterior(ym);
  const txs = await all(
    `SELECT f.id, f.descricao, f.valor,
            TO_CHAR(f.data::date, 'YYYY-MM-DD') AS data,
            f.fonte, a.tipo AS conta_tipo
     FROM financeiro f
     LEFT JOIN openfinance_accounts a ON a.account_id = f.account_id
     WHERE f.user_id = $1
       AND f.tipo = 'saida'
       AND TO_CHAR(f.data::date, 'YYYY-MM') IN ($2, $3)
       AND f.id NOT IN (SELECT tx_id FROM despesas_mes WHERE tx_id IS NOT NULL AND user_id = $1)`,
    [uid, ym, ymPrev]
  );

  const usados = new Set();
  let matched = 0;
  const detalhes = [];

  for (const desp of pendentes) {
    const aliases = aliasesDaDespesa(desp.titulo);
    const cat = desp.categoria || '';
    const ehAssinatura = cat === 'assinaturas' || cat === 'projetos' || !desp.dia_vencimento;
    let melhor = null;
    let melhorScore = 0;

    for (const tx of txs) {
      if (usados.has(tx.id)) continue;
      const ehCartao = tx.conta_tipo === 'CREDIT';
      const texto = scoreTexto(desp.titulo, tx.descricao, aliases);

      // Sem overlap de texto: não casa (evita Netflix↔Cursor só por valor parecido)
      if (texto < 0.35) continue;

      const frouxo = ehCartao || ehAssinatura;
      const ehDas = chaveTitulo(desp.titulo) === 'das';
      const textoReceita =
        /receita\s*federal|pgdas|das\s*mei|documento\s*de\s*arrecad/i.test(String(tx.descricao || ''));
      const valorOk =
        valorCasa(desp.valor_esperado, tx.valor, { frouxo }) ||
        (texto >= 0.7 && ehCartao && Math.abs(Number(tx.valor)) >= 5 &&
          Math.abs(Number(tx.valor) - Number(desp.valor_esperado)) / Math.max(Number(desp.valor_esperado), 1) <= 1.2) ||
        (ehDas && textoReceita && Number(tx.valor) >= 50 && Number(tx.valor) <= 300);

      if (!valorOk) continue;

      const txYm = (dataISO(tx.data) || '').slice(0, 7);
      let dataOk = false;
      if (ehCartao || ehAssinatura || (ehDas && textoReceita)) {
        dataOk = txYm === ym || txYm === ymPrev;
      } else {
        dataOk = dataDentroJanela(tx.data, ym, desp.dia_vencimento, 5);
      }
      if (!dataOk) continue;

      const scoreFinal =
        texto +
        (ehCartao ? 0.1 : 0) +
        (valorCasa(desp.valor_esperado, tx.valor) ? 0.15 : 0) +
        (ehDas && textoReceita ? 0.4 : 0);
      if (scoreFinal > melhorScore) {
        melhorScore = scoreFinal;
        melhor = tx;
      }
    }

    if (melhor && melhorScore >= 0.45) {
      usados.add(melhor.id);
      const pagoEm = dataISO(melhor.data) || hojeStr();
      await run(
        `UPDATE despesas_mes SET status = 'pago', pago_em = $1, confirmado_por = 'banco', tx_id = $2,
           dia_vencimento = COALESCE(dia_vencimento, EXTRACT(DAY FROM $1::date)::int)
         WHERE id = $3 AND user_id = $4`,
        [pagoEm, melhor.id, desp.id, uid]
      );
      matched++;
      detalhes.push({
        despesa: desp.titulo,
        tx: melhor.descricao,
        valor: Number(melhor.valor),
        via: melhor.conta_tipo === 'CREDIT' ? 'cartao' : 'conta'
      });
    }
  }

  const rows = await all(
    `SELECT * FROM despesas_mes WHERE ym = $1 AND user_id = $2 ORDER BY dia_vencimento NULLS LAST, titulo`,
    [ym, uid]
  );
  const despesas = rows.map((r) => enriquecerStatus(r, ym));
  return { ym, matched, detalhes, despesas, resumo: resumo(despesas) };
}

// POST /api/despesas/reconciliar — antes de /:id
router.post('/reconciliar', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const ym = ymValido(req.query.ym || req.body?.ym) ? (req.query.ym || req.body.ym) : ymAtual();
    const out = await reconciliarMes(uid, ym);
    res.json(out);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// PATCH /api/despesas/:id
router.patch('/:id', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const row = await get(`SELECT * FROM despesas_mes WHERE id = $1 AND user_id = $2`, [req.params.id, uid]);
    if (!row) return res.status(404).json({ erro: 'Despesa nao encontrada' });

    const titulo = req.body.titulo != null ? String(req.body.titulo).trim() : row.titulo;
    const valor =
      req.body.valor_esperado != null ? Number(req.body.valor_esperado) : Number(row.valor_esperado);
    let dia =
      req.body.dia_vencimento !== undefined ? req.body.dia_vencimento : row.dia_vencimento;
    const categoria = req.body.categoria != null ? req.body.categoria : row.categoria;

    let status = row.status;
    let pago_em = row.pago_em;
    let confirmado_por = row.confirmado_por;
    let tx_id = row.tx_id;

    if (req.body.status === 'pago' || req.body.acao === 'confirmar') {
      status = 'pago';
      pago_em = req.body.pago_em || hojeStr();
      confirmado_por = req.body.confirmado_por || 'manual';
      if (req.body.tx_id) tx_id = req.body.tx_id;
      if (dia == null) dia = diaDoPago(pago_em);
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

    // Se já estava pago sem vencimento, aprende o dia do pagamento
    if (status === 'pago' && (dia == null || dia === '') && pago_em) {
      dia = diaDoPago(pago_em);
    }

    await run(
      `UPDATE despesas_mes SET
        titulo = $1, valor_esperado = $2, dia_vencimento = $3, categoria = $4,
        status = $5, pago_em = $6::date, confirmado_por = $7, tx_id = $8
       WHERE id = $9 AND user_id = $10`,
      [titulo, valor, dia, categoria, status, pago_em, confirmado_por, tx_id, req.params.id, uid]
    );
    const updated = await get(`SELECT * FROM despesas_mes WHERE id = $1 AND user_id = $2`, [req.params.id, uid]);
    res.json(enriquecerStatus(updated, updated.ym));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// POST /api/despesas/:id/confirmar — atalho mais confiável no mobile/PWA
router.post('/:id/confirmar', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const row = await get(`SELECT * FROM despesas_mes WHERE id = $1 AND user_id = $2`, [req.params.id, uid]);
    if (!row) return res.status(404).json({ erro: 'Despesa nao encontrada' });
    await run(
      `UPDATE despesas_mes SET
        status = 'pago',
        pago_em = $1::date,
        confirmado_por = COALESCE($2, 'manual'),
        dia_vencimento = COALESCE(dia_vencimento, EXTRACT(DAY FROM $1::date)::int)
       WHERE id = $3 AND user_id = $4`,
      [hojeStr(), req.body?.confirmado_por || 'manual', req.params.id, uid]
    );
    const updated = await get(`SELECT * FROM despesas_mes WHERE id = $1 AND user_id = $2`, [req.params.id, uid]);
    res.json(enriquecerStatus(updated, updated.ym));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// POST /api/despesas/:id/ignorar
router.post('/:id/ignorar', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const row = await get(`SELECT * FROM despesas_mes WHERE id = $1 AND user_id = $2`, [req.params.id, uid]);
    if (!row) return res.status(404).json({ erro: 'Despesa nao encontrada' });
    await run(`UPDATE despesas_mes SET status = 'ignorado' WHERE id = $1 AND user_id = $2`, [req.params.id, uid]);
    const updated = await get(`SELECT * FROM despesas_mes WHERE id = $1 AND user_id = $2`, [req.params.id, uid]);
    res.json(enriquecerStatus(updated, updated.ym));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// POST /api/despesas/:id/desvincular
router.post('/:id/desvincular', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const row = await get(`SELECT * FROM despesas_mes WHERE id = $1 AND user_id = $2`, [req.params.id, uid]);
    if (!row) return res.status(404).json({ erro: 'Despesa nao encontrada' });
    await run(
      `UPDATE despesas_mes SET status = 'pendente', pago_em = NULL, confirmado_por = NULL, tx_id = NULL WHERE id = $1 AND user_id = $2`,
      [req.params.id, uid]
    );
    const updated = await get(`SELECT * FROM despesas_mes WHERE id = $1 AND user_id = $2`, [req.params.id, uid]);
    res.json(enriquecerStatus(updated, updated.ym));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// DELETE /api/despesas/:id
router.delete('/:id', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const r = await run(`DELETE FROM despesas_mes WHERE id = $1 AND user_id = $2`, [req.params.id, uid]);
    if (!r.rowCount) return res.status(404).json({ erro: 'Despesa nao encontrada' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;
module.exports.reconciliarMes = reconciliarMes;
