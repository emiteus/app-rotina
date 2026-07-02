const express = require('express');
const { run, all, get } = require('../lib/db');

const router = express.Router();

// ---- helpers de planejamento ----
// Cálculos com base nos últimos 3 meses completos (ignora mês atual pra não distorcer)
async function planejamentoBase() {
  const meses = 3;
  // Renda média mensal (últimos N meses, excluindo mês atual)
  const linhas = await all(`
    SELECT TO_CHAR(data, 'YYYY-MM') AS mes,
           SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END) AS entradas,
           SUM(CASE WHEN tipo='saida' THEN valor ELSE 0 END) AS saidas
    FROM financeiro
    WHERE data >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '${meses} months'
      AND data < DATE_TRUNC('month', CURRENT_DATE)
    GROUP BY mes
    ORDER BY mes
  `);
  const somaEnt = linhas.reduce((s, l) => s + Number(l.entradas), 0);
  const somaSai = linhas.reduce((s, l) => s + Number(l.saidas), 0);
  const denom = Math.max(linhas.length, 1);
  const rendaMedia = somaEnt / denom;
  const gastoMedio = somaSai / denom;
  const sobraEstimada = Math.max(rendaMedia - gastoMedio, 0);
  return { rendaMedia, gastoMedio, sobraEstimada, mesesAmostra: linhas.length };
}

function mesesAtePrazo(prazo) {
  if (!prazo) return null;
  const hoje = new Date();
  const d = new Date(prazo);
  const diffMs = d - hoje;
  if (diffMs <= 0) return 0;
  // meses (30.44 dias médio pra suavizar) — mínimo 1
  return Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24 * 30.44)));
}

// GET /api/metas — lista com progresso e planejamento
router.get('/', async (req, res) => {
  try {
    const base = await planejamentoBase();
    const metas = await all(`SELECT id, nome, valor_total, prazo, prioridade, concluida FROM metas ORDER BY concluida ASC, prazo NULLS LAST, criado_em ASC`);
    const depositos = await all(`SELECT meta_id, valor FROM metas_depositos`);
    const guardadoPorMeta = {};
    depositos.forEach(d => { guardadoPorMeta[d.meta_id] = (guardadoPorMeta[d.meta_id] || 0) + Number(d.valor); });

    // 1) Calcula mensal necessário para metas com prazo (não concluídas)
    let compromissosMensais = 0;
    const enriquecidas = metas.map(m => {
      const guardado = guardadoPorMeta[m.id] || 0;
      const restante = Math.max(Number(m.valor_total) - guardado, 0);
      const pct = Number(m.valor_total) > 0 ? Math.min(100, (guardado / Number(m.valor_total)) * 100) : 100;
      let mesesRest = m.prazo ? mesesAtePrazo(m.prazo) : null;
      let mensalNecessario = null;
      if (m.prazo && !m.concluida) {
        mensalNecessario = mesesRest > 0 ? restante / mesesRest : restante;
        compromissosMensais += mensalNecessario;
      }
      return { ...m, guardado, restante, pct, mesesRest, mensalNecessario, eta: null, etaData: null };
    });

    // 2) Metas sem prazo (não concluídas) dividem o que sobra da sobra estimada
    const semPrazo = enriquecidas.filter(m => !m.prazo && !m.concluida && m.restante > 0);
    const livre = Math.max(base.sobraEstimada - compromissosMensais, 0);
    const porMetaSemPrazo = semPrazo.length > 0 ? livre / semPrazo.length : 0;
    semPrazo.forEach(m => {
      if (porMetaSemPrazo > 0) {
        const meses = Math.max(1, Math.ceil(m.restante / porMetaSemPrazo));
        m.eta = meses;
        const d = new Date();
        d.setMonth(d.getMonth() + meses);
        m.etaData = d.toISOString().substring(0, 10);
        // Nunca pede mais do que falta pra concluir a meta
        m.mensalNecessario = Math.min(porMetaSemPrazo, m.restante);
      }
    });

    const insuficiente = compromissosMensais > base.sobraEstimada && base.sobraEstimada > 0;

    res.json({
      metas: enriquecidas,
      base,
      compromissosMensais,
      livre,
      insuficiente
    });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// POST /api/metas — criar
router.post('/', async (req, res) => {
  const { nome, valorTotal, prazo } = req.body || {};
  const n = String(nome || '').trim();
  const v = parseFloat(valorTotal);
  if (!n) return res.status(400).json({ erro: 'nome obrigatório' });
  if (isNaN(v) || v <= 0) return res.status(400).json({ erro: 'valorTotal inválido' });
  try {
    const r = await get(
      `INSERT INTO metas (nome, valor_total, prazo) VALUES ($1,$2,$3) RETURNING id`,
      [n, v, prazo || null]
    );
    res.status(201).json({ ok: true, id: r.id });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// PATCH — editar meta
router.patch('/:id', async (req, res) => {
  const { nome, valorTotal, prazo, concluida } = req.body || {};
  try {
    const sets = [];
    const vals = [];
    if (nome != null) { sets.push(`nome = $${sets.length + 1}`); vals.push(String(nome).trim()); }
    if (valorTotal != null) { sets.push(`valor_total = $${sets.length + 1}`); vals.push(parseFloat(valorTotal)); }
    if (prazo !== undefined) { sets.push(`prazo = $${sets.length + 1}`); vals.push(prazo || null); }
    if (concluida != null) { sets.push(`concluida = $${sets.length + 1}`); vals.push(!!concluida); }
    if (sets.length === 0) return res.status(400).json({ erro: 'nada pra atualizar' });
    vals.push(req.params.id);
    await run(`UPDATE metas SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// DELETE — remover meta (cascata nos depósitos)
router.delete('/:id', async (req, res) => {
  try {
    await run(`DELETE FROM metas WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// POST /api/metas/:id/depositos — registra depósito
router.post('/:id/depositos', async (req, res) => {
  const v = parseFloat(req.body && req.body.valor);
  if (isNaN(v) || v <= 0) return res.status(400).json({ erro: 'valor inválido' });
  try {
    await run(
      `INSERT INTO metas_depositos (meta_id, valor, descricao) VALUES ($1,$2,$3)`,
      [req.params.id, v, (req.body && req.body.descricao) || null]
    );
    // Se atingiu ou passou o total, marca como concluída
    const meta = await get(`SELECT valor_total FROM metas WHERE id = $1`, [req.params.id]);
    if (meta) {
      const soma = await get(`SELECT COALESCE(SUM(valor),0) AS s FROM metas_depositos WHERE meta_id = $1`, [req.params.id]);
      if (Number(soma.s) >= Number(meta.valor_total)) {
        await run(`UPDATE metas SET concluida = true WHERE id = $1`, [req.params.id]);
      }
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;
