const express = require('express');
const { v4: uuid } = require('uuid');
const { run, get, all } = require('../lib/db');
const { ymAtual, hojeStr, diaDoMes } = require('../lib/datas');
const plano = require('../lib/plano-financeiro');

const router = express.Router();

function ymValido(ym) {
  return typeof ym === 'string' && /^\d{4}-\d{2}$/.test(ym);
}

function chaveTitulo(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function labelChave(chave) {
  const fixa = (plano.rendaFixa || []).find((r) => r.chave === chave);
  if (fixa) return fixa.nome;
  const varr = (plano.rendaVariavelTipos || []).find((r) => r.chave === chave);
  if (varr) return varr.label;
  return chave || 'Receita';
}

function statusInicial(ym, dia) {
  const hojeYm = ymAtual();
  const hojeDia = diaDoMes();
  if (ym < hojeYm) return 'atrasado';
  if (ym === hojeYm && dia && dia < hojeDia) return 'atrasado';
  return 'pendente';
}

async function inserirReceitaFixa(ym, item, statusOverride) {
  const dia = item.dia != null ? Number(item.dia) : null;
  const status = statusOverride || statusInicial(ym, dia);
  const recebidoEm = status === 'recebido' ? hojeStr() : null;
  const valorRecebido = status === 'recebido' ? item.valor : null;
  await run(
    `INSERT INTO receitas_mes
      (id, ym, titulo, valor_esperado, valor_recebido, dia_previsto, tipo, chave, status, recebido_em, origem)
     VALUES ($1,$2,$3,$4,$5,$6,'fixa',$7,$8,$9,'plano')`,
    [
      uuid(),
      ym,
      item.nome,
      item.valor,
      valorRecebido,
      dia,
      item.chave,
      status,
      recebidoEm
    ]
  );
}

async function seedMesSeVazio(ym) {
  const count = await get(`SELECT COUNT(*)::int AS n FROM receitas_mes WHERE ym = $1`, [ym]);
  if (count && count.n > 0) return { seeded: false, count: count.n };

  for (const item of plano.rendaFixa || []) {
    await inserirReceitaFixa(ym, item);
  }
  return { seeded: true, count: (plano.rendaFixa || []).length };
}

async function syncPlanoMes(ym) {
  const rows = await all(`SELECT * FROM receitas_mes WHERE ym = $1`, [ym]);
  let criadas = 0;
  let atualizadas = 0;

  for (const item of plano.rendaFixa || []) {
    const existente = rows.find((r) => r.chave === item.chave || chaveTitulo(r.titulo) === chaveTitulo(item.nome));
    if (!existente) {
      await inserirReceitaFixa(ym, item);
      criadas++;
      continue;
    }
    const dia = item.dia != null ? Number(item.dia) : null;
    const campos = [];
    const vals = [];
    let i = 1;
    if (existente.titulo !== item.nome) {
      campos.push(`titulo = $${i++}`);
      vals.push(item.nome);
    }
    if (Math.round(Number(existente.valor_esperado || 0) * 100) !== Math.round(Number(item.valor) * 100)) {
      campos.push(`valor_esperado = $${i++}`);
      vals.push(item.valor);
    }
    if (dia != null && Number(existente.dia_previsto || 0) !== Number(dia)) {
      campos.push(`dia_previsto = $${i++}`);
      vals.push(dia);
    }
    if (!existente.chave && item.chave) {
      campos.push(`chave = $${i++}`);
      vals.push(item.chave);
    }
    if (campos.length) {
      vals.push(existente.id);
      await run(`UPDATE receitas_mes SET ${campos.join(', ')} WHERE id = $${i}`, vals);
      atualizadas++;
    }
  }

  return { criadas, atualizadas };
}

function enriquecerStatus(row, ym) {
  const hojeYm = ymAtual();
  const hojeDia = diaDoMes();
  let status = row.status;
  if (status === 'pendente') {
    if (ym < hojeYm) status = 'atrasado';
    else if (ym === hojeYm && row.dia_previsto && Number(row.dia_previsto) < hojeDia) status = 'atrasado';
  }
  return {
    ...row,
    status,
    valor_esperado: row.valor_esperado != null ? Number(row.valor_esperado) : null,
    valor_recebido: row.valor_recebido != null ? Number(row.valor_recebido) : null,
    label_chave: labelChave(row.chave)
  };
}

function resumo(lista) {
  const r = {
    piso: 0,
    recebido: 0,
    pendente: 0,
    atrasado: 0,
    variavel: 0,
    qtd: 0
  };
  for (const item of lista) {
    r.qtd++;
    if (item.tipo === 'fixa') {
      const esperado = Number(item.valor_esperado) || 0;
      r.piso += esperado;
      if (item.status === 'recebido') {
        r.recebido += Number(item.valor_recebido ?? item.valor_esperado) || 0;
      } else if (item.status === 'atrasado') r.atrasado += esperado;
      else r.pendente += esperado;
    } else {
      const v = Number(item.valor_recebido ?? item.valor_esperado) || 0;
      r.variavel += v;
      if (item.status === 'recebido') r.recebido += v;
    }
  }
  for (const k of Object.keys(r)) {
    if (k !== 'qtd') r[k] = Math.round(r[k] * 100) / 100;
  }
  return r;
}

router.get('/', async (req, res) => {
  try {
    const ym = ymValido(req.query.ym) ? req.query.ym : ymAtual();
    const seed = await seedMesSeVazio(ym);
    const sync = await syncPlanoMes(ym);
    const rows = await all(
      `SELECT * FROM receitas_mes WHERE ym = $1
       ORDER BY
         CASE tipo WHEN 'fixa' THEN 0 ELSE 1 END,
         CASE status WHEN 'atrasado' THEN 0 WHEN 'pendente' THEN 1 WHEN 'recebido' THEN 2 ELSE 3 END,
         COALESCE(dia_previsto, 99),
         titulo`,
      [ym]
    );
    const receitas = rows.map((r) => enriquecerStatus(r, ym));
    for (const item of receitas) {
      if (item.status === 'atrasado' && rows.find((x) => x.id === item.id)?.status === 'pendente') {
        await run(`UPDATE receitas_mes SET status = 'atrasado' WHERE id = $1 AND status = 'pendente'`, [item.id]);
      }
    }
    res.json({
      ym,
      seed,
      sync,
      receitas,
      resumo: resumo(receitas),
      tipos_variavel: plano.rendaVariavelTipos || [],
      renda_fixa: plano.rendaFixa || []
    });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const ym = ymValido(req.body.ym) ? req.body.ym : ymAtual();
    const tipo = String(req.body.tipo || 'variavel').toLowerCase() === 'fixa' ? 'fixa' : 'variavel';
    const chave = String(req.body.chave || '').trim() || null;
    const tituloBody = String(req.body.titulo || '').trim();
    const titulo = tituloBody || labelChave(chave) || 'Receita';
    const valor = Number(req.body.valor_recebido ?? req.body.valor ?? req.body.valor_esperado);
    if (!Number.isFinite(valor) || valor <= 0) {
      return res.status(400).json({ erro: 'valor obrigatorio' });
    }
    const recebidoEm = (req.body.recebido_em && String(req.body.recebido_em).slice(0, 10)) || hojeStr();
    const origem = req.body.origem || 'manual';
    const notas = req.body.notas ? String(req.body.notas).trim() : null;
    const id = uuid();

    if (tipo === 'fixa') {
      return res.status(400).json({ erro: 'renda fixa vem do plano; use confirmar recebimento' });
    }

    await run(
      `INSERT INTO receitas_mes
        (id, ym, titulo, valor_esperado, valor_recebido, dia_previsto, tipo, chave, status, recebido_em, notas, origem)
       VALUES ($1,$2,$3,$4,$5,$6,'variavel',$7,'recebido',$8,$9,$10)`,
      [
        id,
        ym,
        titulo,
        valor,
        valor,
        recebidoEm ? Number(String(recebidoEm).slice(8, 10)) : null,
        chave || 'outro',
        recebidoEm,
        notas,
        origem
      ]
    );
    const row = await get(`SELECT * FROM receitas_mes WHERE id = $1`, [id]);
    res.status(201).json(enriquecerStatus(row, ym));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.post('/:id/confirmar', async (req, res) => {
  try {
    const id = String(req.params.id);
    const row = await get(`SELECT * FROM receitas_mes WHERE id = $1`, [id]);
    if (!row) return res.status(404).json({ erro: 'receita nao encontrada' });
    if (row.status === 'recebido') {
      return res.json(enriquecerStatus(row, row.ym));
    }
    const valor = Number(req.body.valor_recebido ?? req.body.valor ?? row.valor_esperado);
    if (!Number.isFinite(valor) || valor <= 0) {
      return res.status(400).json({ erro: 'valor invalido' });
    }
    const recebidoEm = (req.body.recebido_em && String(req.body.recebido_em).slice(0, 10)) || hojeStr();
    const origem = req.body.confirmado_por || req.body.origem || 'manual';
    await run(
      `UPDATE receitas_mes SET
         status = 'recebido',
         valor_recebido = $1,
         recebido_em = $2::date,
         origem = CASE WHEN origem = 'plano' THEN origem ELSE $3 END,
         dia_previsto = COALESCE(dia_previsto, EXTRACT(DAY FROM $2::date)::int)
       WHERE id = $4`,
      [valor, recebidoEm, origem, id]
    );
    const atual = await get(`SELECT * FROM receitas_mes WHERE id = $1`, [id]);
    res.json(enriquecerStatus(atual, atual.ym));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const id = String(req.params.id);
    const row = await get(`SELECT * FROM receitas_mes WHERE id = $1`, [id]);
    if (!row) return res.status(404).json({ erro: 'receita nao encontrada' });

    if (req.body.acao === 'confirmar' || req.body.acao === 'receber') {
      req.body = { ...req.body, confirmado_por: req.body.confirmado_por || 'manual' };
      const valor = Number(req.body.valor_recebido ?? req.body.valor ?? row.valor_esperado);
      const recebidoEm = (req.body.recebido_em && String(req.body.recebido_em).slice(0, 10)) || hojeStr();
      await run(
        `UPDATE receitas_mes SET status = 'recebido', valor_recebido = $1, recebido_em = $2::date WHERE id = $3`,
        [valor, recebidoEm, id]
      );
    } else if (req.body.acao === 'reabrir') {
      if (row.tipo === 'fixa') {
        await run(
          `UPDATE receitas_mes SET status = 'pendente', valor_recebido = NULL, recebido_em = NULL WHERE id = $1`,
          [id]
        );
      } else {
        await run(`DELETE FROM receitas_mes WHERE id = $1`, [id]);
        return res.json({ ok: true, removida: true, id });
      }
    } else {
      const campos = [];
      const vals = [];
      let i = 1;
      if (req.body.titulo != null) {
        campos.push(`titulo = $${i++}`);
        vals.push(String(req.body.titulo).trim());
      }
      if (req.body.notas != null) {
        campos.push(`notas = $${i++}`);
        vals.push(String(req.body.notas).trim() || null);
      }
      if (req.body.valor_recebido != null || req.body.valor != null) {
        const v = Number(req.body.valor_recebido ?? req.body.valor);
        campos.push(`valor_recebido = $${i++}`);
        vals.push(v);
        campos.push(`valor_esperado = $${i++}`);
        vals.push(v);
      }
      if (campos.length) {
        vals.push(id);
        await run(`UPDATE receitas_mes SET ${campos.join(', ')} WHERE id = $${i}`, vals);
      }
    }

    const atual = await get(`SELECT * FROM receitas_mes WHERE id = $1`, [id]);
    if (!atual) return res.json({ ok: true, removida: true, id });
    res.json(enriquecerStatus(atual, atual.ym));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = String(req.params.id);
    const row = await get(`SELECT tipo FROM receitas_mes WHERE id = $1`, [id]);
    if (!row) return res.status(404).json({ erro: 'receita nao encontrada' });
    if (row.tipo === 'fixa') {
      return res.status(400).json({ erro: 'renda fixa nao pode ser apagada; reabra o recebimento' });
    }
    await run(`DELETE FROM receitas_mes WHERE id = $1`, [id]);
    res.json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;
