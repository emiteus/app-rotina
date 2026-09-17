const { v4: uuid } = require('uuid');
const { all, run, get } = require('../../../db');
const { hojeStr } = require('../../../datas');
const plano = require('../../../plano-financeiro');
const openfinanceRouter = require('../../../../routes/openfinance');

const TYPES = new Set([
  'criar_despesa',
  'criar_meta',
  'criar_categoria',
  'recategorizar',
  'renomear_categoria',
  'fundir_categorias',
  'confirmar_despesa',
  'confirmar_receita',
  'criar_receita',
  'depositar_meta',
  'criar_transacao',
  'deletar_transacao',
  'corrigir_data_tx',
  'marcar_das',
  'reconciliar_despesas',
  'sincronizar_bancos'
]);

function brlNum(v) {
  return Math.round(Number(v || 0) * 100) / 100;
}

async function handle(acao, ctx) {
  const tipo = acao && acao.tipo;
  if (!TYPES.has(tipo)) return null;

  const {
    userId,
    ym,
    normalizarChave,
    garantirCategoria,
    resolverCategoriaRef,
    buscarTxsComFallback
  } = ctx;

  if (tipo === 'criar_despesa') {
    const titulo = String(acao.titulo || '').trim();
    const valor = Number(acao.valor_esperado ?? acao.valor);
    if (!titulo || !Number.isFinite(valor) || valor <= 0) {
      return { tipo, ok: false, erro: 'titulo/valor inválidos' };
    }
    const id = uuid();
    const dia = acao.dia_vencimento != null ? Number(acao.dia_vencimento) : null;
    await run(
      `INSERT INTO despesas_mes (id, ym, titulo, valor_esperado, dia_vencimento, categoria, status, origem, user_id)
       VALUES ($1,$2,$3,$4,$5,$6,'pendente','manual',$7)`,
      [id, acao.ym || ym, titulo, valor, Number.isFinite(dia) ? dia : null, acao.categoria || 'outros', userId]
    );
    return { tipo, ok: true, titulo, valor };
  }

  if (tipo === 'criar_meta') {
    const nome = String(acao.nome || acao.titulo || '').trim();
    const valor = Number(acao.valor_total ?? acao.valor);
    if (!nome || !Number.isFinite(valor) || valor <= 0) {
      return { tipo, ok: false, erro: 'nome/valor inválidos' };
    }
    const r = await get(
      `INSERT INTO metas (nome, valor_total, prazo, user_id) VALUES ($1,$2,$3,$4) RETURNING id`,
      [nome, valor, acao.prazo || null, userId]
    );
    return { tipo, ok: true, nome, valor, id: r && r.id };
  }

  if (tipo === 'criar_categoria') {
    const cat = await garantirCategoria(acao);
    if (!cat) {
      return { tipo, ok: false, erro: 'label/categoria obrigatórios' };
    }
    return {
      tipo,
      ok: true,
      categoria: cat.chave,
      label: cat.label,
      criada: cat.criada
    };
  }

  if (tipo === 'recategorizar') {
    const cat = await garantirCategoria(acao);
    if (!cat) {
      return { tipo, ok: false, erro: 'categoria obrigatória' };
    }
    let txs = await buscarTxsComFallback(acao);
    let syncInfo = null;
    if (!txs.length) {
      const contem = Array.isArray(acao.filtros?.contem) ? acao.filtros.contem : [];
      if (contem.length && acao.aprender !== false) {
        for (const token of contem.slice(0, 4)) {
          const chave = normalizarChave(token).slice(0, 40);
          if (!chave || chave.length < 3) continue;
          await run(
            `INSERT INTO categoria_regras (chave, categoria, exemplo, user_id)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (chave) DO UPDATE SET categoria = EXCLUDED.categoria, user_id = EXCLUDED.user_id`,
            [chave, cat.chave, String(acao.filtros?.trecho || token).slice(0, 120), userId]
          );
        }
      }
      if (contem.length && openfinanceRouter.temCredenciais && openfinanceRouter.temCredenciais()) {
        try {
          syncInfo = await openfinanceRouter.syncAll(null, { refresh: false }, userId);
          txs = await buscarTxsComFallback(acao);
        } catch (syncErr) {
        }
      }
    }
    if (!txs.length) {
      const contem = Array.isArray(acao.filtros?.contem) ? acao.filtros.contem : [];
      const tokTxt = contem.length ? contem.join('", "') : 'esse nome';
      let totalTxt = '';
      try {
        const row = await get(`SELECT COUNT(*)::int AS n FROM financeiro WHERE user_id = $1`, [userId]);
        totalTxt = row && row.n ? ` (${row.n} lançamentos no extrato)` : '';
      } catch (e) { /* ok */ }
      const syncTxt = syncInfo && Number(syncInfo.importadas) > 0
        ? ` Sincronizei o banco (+${syncInfo.importadas} novos) mas ainda não achei.`
        : (syncInfo ? ' Sincronizei o banco mas ainda não achei.' : '');
      return {
        tipo,
        ok: false,
        erro: `Não achei lançamento com "${tokTxt}" no extrato${totalTxt}.${syncTxt} `
          + 'Se aparece no app do banco, confira Financeiro → Bancos. '
          + 'Ou me manda **valor e data** que eu procuro.',
        categoria: cat.chave,
        filtros: acao.filtros || null
      };
    }
    const ids = txs.map(t => t.id);
    const marcarTerceiro = !!(acao.pago_terceiro || acao.terceiro_nome);
    const nomeTerceiro = String(acao.terceiro_nome || acao.categoria_label || '').trim() || null;
    await run(
      `UPDATE financeiro
       SET categoria = $1,
           categoria_confirmada = true,
           pago_terceiro = CASE WHEN $3 THEN true ELSE pago_terceiro END,
           terceiro_nome = CASE WHEN $3 AND $4 IS NOT NULL THEN $4 ELSE terceiro_nome END
       WHERE user_id = $5 AND id = ANY($2::text[])`,
      [cat.chave, ids, marcarTerceiro, nomeTerceiro, userId]
    );
    if (acao.aprender !== false) {
      for (const t of txs) {
        const chave = t.chave_categoria || normalizarChave(t.descricao).slice(0, 40);
        if (!chave) continue;
        await run(
          `INSERT INTO categoria_regras (chave, categoria, exemplo, user_id)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (chave) DO UPDATE SET categoria = EXCLUDED.categoria, user_id = EXCLUDED.user_id`,
          [chave, cat.chave, String(t.descricao || '').slice(0, 120), userId]
        );
      }
    }
    return {
      tipo,
      ok: true,
      categoria: cat.chave,
      label: cat.label,
      qtd: ids.length,
      ids,
      exemplos: txs.slice(0, 5).map(t => String(t.descricao || '').slice(0, 40))
    };
  }

  if (tipo === 'renomear_categoria') {
    const novoLabel = String(acao.categoria_label || acao.label || acao.novo_nome || '').trim();
    if (!novoLabel) {
      return { tipo, ok: false, erro: 'novo nome obrigatório' };
    }
    const deRaw = String(acao.de || acao.categoria || acao.chave || acao.categoria_antiga || '').trim();
    let row = null;
    if (deRaw) {
      const chaveTry = /^[a-z0-9_]+$/i.test(deRaw) ? deRaw.toLowerCase() : normalizarChave(deRaw);
      row = await get(
        `SELECT chave, label FROM categorias WHERE chave = $1 AND (user_id IS NULL OR user_id = $2)`,
        [chaveTry, userId]
      );
      if (!row) {
        row = await get(
          `SELECT chave, label FROM categorias WHERE lower(label) = lower($1) AND (user_id IS NULL OR user_id = $2)`,
          [deRaw, userId]
        );
      }
      if (!row) {
        row = await get(
          `SELECT chave, label FROM categorias
           WHERE (user_id IS NULL OR user_id = $3)
             AND (label ILIKE $1 OR chave ILIKE $2)
           ORDER BY length(label) ASC LIMIT 1`,
          [`%${deRaw}%`, `%${chaveTry}%`, userId]
        );
      }
    }
    if (!row) {
      const chaveNovo = normalizarChave(novoLabel);
      row = await get(
        `SELECT chave, label FROM categorias WHERE chave = $1 AND (user_id IS NULL OR user_id = $2)`,
        [chaveNovo, userId]
      );
      if (!row && chaveNovo.length >= 6) {
        row = await get(
          `SELECT chave, label FROM categorias
           WHERE (user_id IS NULL OR user_id = $3)
             AND (chave LIKE $1 OR $2 LIKE (chave || '%'))
           ORDER BY ABS(length(chave) - length($2)) ASC, length(chave) DESC
           LIMIT 1`,
          [`${chaveNovo}%`, chaveNovo, userId]
        );
      }
      if (!row && /amigo/i.test(novoLabel)) {
        row = await get(
          `SELECT chave, label FROM categorias
           WHERE (user_id IS NULL OR user_id = $1)
             AND (chave ILIKE '%amigo%' OR label ILIKE '%amigo%')
           ORDER BY length(label) ASC LIMIT 1`,
          [userId]
        );
      }
      if (!row && /aposta/i.test(novoLabel)) {
        row = await get(
          `SELECT chave, label FROM categorias
           WHERE (user_id IS NULL OR user_id = $1)
             AND (chave ILIKE '%aposta%' OR label ILIKE '%aposta%')
           ORDER BY CASE WHEN chave = 'apostas' THEN 1 ELSE 0 END, length(label) ASC
           LIMIT 1`,
          [userId]
        );
      }
    }
    if (!row) {
      return { tipo, ok: false, erro: 'categoria não encontrada pra renomear' };
    }
    await run(`UPDATE categorias SET label = $1 WHERE chave = $2 AND user_id = $3`, [novoLabel, row.chave, userId]);
    return {
      tipo,
      ok: true,
      categoria: row.chave,
      label: novoLabel,
      label_antes: row.label
    };
  }

  if (tipo === 'fundir_categorias') {
    const novoLabel = String(acao.categoria_label || acao.label || acao.para || '').trim();
    let fontesRaw = [];
    if (Array.isArray(acao.de)) fontesRaw = acao.de;
    else if (Array.isArray(acao.fontes)) fontesRaw = acao.fontes;
    else if (acao.de) fontesRaw = String(acao.de).split(/[,;/|e]+/i);
    fontesRaw = fontesRaw.map(s => String(s || '').trim()).filter(Boolean).slice(0, 12);

    // Se não veio lista, mas o label já está duplicado (2x "Pai e Mãe"), funde por label
    if (!fontesRaw.length && novoLabel) {
      const dups = await all(
        `SELECT chave, label FROM categorias WHERE lower(label) = lower($1) AND (user_id IS NULL OR user_id = $2)`,
        [novoLabel, userId]
      );
      if (dups.length >= 2) fontesRaw = dups.map(d => d.chave);
    }

    const resolvidas = [];
    for (const f of fontesRaw) {
      const r = await resolverCategoriaRef(f);
      if (r && !resolvidas.find(x => x.chave === r.chave)) resolvidas.push(r);
    }

    // Também pega qualquer outra categoria com o mesmo label-alvo (duplicatas)
    if (novoLabel) {
      const dups = await all(
        `SELECT chave, label FROM categorias WHERE lower(label) = lower($1) AND (user_id IS NULL OR user_id = $2)`,
        [novoLabel, userId]
      );
      for (const d of dups) {
        if (!resolvidas.find(x => x.chave === d.chave)) resolvidas.push(d);
      }
    }

    if (resolvidas.length < 2 && !novoLabel) {
      return { tipo, ok: false, erro: 'informe ao menos 2 categorias pra unificar' };
    }
    if (!resolvidas.length) {
      return { tipo, ok: false, erro: 'categorias de origem não encontradas' };
    }

    const lab = novoLabel || resolvidas[0].label;
    const alvo = await garantirCategoria({
      categoria_label: lab,
      categoria: acao.categoria || undefined
    });
    if (!alvo) {
      return { tipo, ok: false, erro: 'não deu pra criar categoria destino' };
    }

    const chavesOrigem = resolvidas.map(r => r.chave).filter(c => c !== alvo.chave);
    if (!chavesOrigem.length) {
      // Só duplicata de label na mesma chave — só garante label
      await run(`UPDATE categorias SET label = $1 WHERE chave = $2 AND user_id = $3`, [lab, alvo.chave, userId]);
      return {
        tipo,
        ok: true,
        categoria: alvo.chave,
        label: lab,
        de: resolvidas.map(r => r.chave),
        qtd: 0
      };
    }

    const updFin = await run(
      `UPDATE financeiro
       SET categoria = $1, categoria_confirmada = true
       WHERE user_id = $2 AND categoria = ANY($3::text[])`,
      [alvo.chave, userId, chavesOrigem]
    );
    await run(
      `UPDATE categoria_regras SET categoria = $1 WHERE user_id = $2 AND categoria = ANY($3::text[])`,
      [alvo.chave, userId, chavesOrigem]
    ).catch(() => {});
    await run(
      `UPDATE despesas_mes SET categoria = $1 WHERE user_id = $2 AND categoria = ANY($3::text[])`,
      [alvo.chave, userId, chavesOrigem]
    ).catch(() => {});

    // Remove categorias origem (não apaga seed clássicos se ainda forem a chave alvo)
    const seedKeep = new Set([
      'alimentacao', 'contas_fixas', 'moradia', 'transporte', 'lazer', 'apostas',
      'compras', 'assinaturas', 'saude', 'educacao', 'outros', 'projetos', 'faturas',
      'iof', 'transferencia', 'receita_trabalho', 'pj_receita', 'pj_despesa'
    ]);
    for (const c of chavesOrigem) {
      if (seedKeep.has(c)) {
        // seed: só restaura label padrão se for alimentacao etc — deixa label como está se user renomeou
        continue;
      }
      await run(`DELETE FROM categorias WHERE chave = $1 AND user_id = $2`, [c, userId]).catch(() => {});
    }

    await run(`UPDATE categorias SET label = $1 WHERE chave = $2 AND user_id = $3`, [lab, alvo.chave, userId]);

    return {
      tipo,
      ok: true,
      categoria: alvo.chave,
      label: lab,
      de: chavesOrigem,
      qtd: Number(updFin && updFin.rowCount) || 0
    };
  }

  if (tipo === 'confirmar_despesa') {
    const titulo = String(acao.titulo || acao.nome || '').trim();
    const id = acao.id ? String(acao.id) : null;
    let row = null;
    if (id) row = await get(`SELECT id, titulo, status FROM despesas_mes WHERE id = $1 AND user_id = $2`, [id, userId]);
    if (!row && titulo) {
      row = await get(
        `SELECT id, titulo, status FROM despesas_mes
         WHERE user_id = $1 AND ym = $2 AND status IN ('pendente','atrasado')
           AND (lower(titulo) = lower($3) OR titulo ILIKE $4)
         ORDER BY CASE WHEN lower(titulo) = lower($3) THEN 0 ELSE 1 END, dia_vencimento NULLS LAST
         LIMIT 1`,
        [userId, acao.ym || ym, titulo, `%${titulo}%`]
      );
    }
    if (!row) {
      return { tipo, ok: false, erro: 'despesa não encontrada' };
    }
    if (row.status === 'pago') {
      return { tipo, ok: true, titulo: row.titulo, ja: true };
    }
    const pagoEm = (acao.pago_em && String(acao.pago_em).slice(0, 10)) || hojeStr();
    await run(
      `UPDATE despesas_mes SET
         status = 'pago',
         pago_em = $1::date,
         confirmado_por = 'assistente',
         dia_vencimento = COALESCE(dia_vencimento, EXTRACT(DAY FROM $1::date)::int)
       WHERE id = $2 AND user_id = $3`,
      [pagoEm, row.id, userId]
    );
    return { tipo, ok: true, titulo: row.titulo, id: row.id, pago_em: pagoEm };
  }

  if (tipo === 'confirmar_receita') {
    const ymRec = String(acao.ym || ym).slice(0, 7);
    const titulo = String(acao.titulo || acao.nome || '').trim();
    const chave = String(acao.chave || '').trim() || null;
    const id = acao.id ? String(acao.id) : null;

    const countRec = await get(`SELECT COUNT(*)::int AS n FROM receitas_mes WHERE ym = $1 AND user_id = $2`, [ymRec, userId]);
    if (!countRec?.n) {
      for (const item of plano.rendaFixa || []) {
        const dia = item.dia != null ? Number(item.dia) : null;
        await run(
          `INSERT INTO receitas_mes
            (id, ym, titulo, valor_esperado, valor_recebido, dia_previsto, tipo, chave, status, recebido_em, origem, user_id)
           VALUES ($1,$2,$3,$4,NULL,$5,'fixa',$6,'pendente',NULL,'plano',$7)`,
          [uuid(), ymRec, item.nome, item.valor, dia, item.chave, userId]
        );
      }
    }

    let row = null;
    if (id) row = await get(`SELECT * FROM receitas_mes WHERE id = $1 AND user_id = $2`, [id, userId]);
    if (!row && chave) {
      row = await get(
        `SELECT * FROM receitas_mes WHERE user_id = $1 AND ym = $2 AND chave = $3 AND status IN ('pendente','atrasado')
         ORDER BY CASE tipo WHEN 'fixa' THEN 0 ELSE 1 END LIMIT 1`,
        [userId, acao.ym || ymRec, chave]
      );
    }
    if (!row && titulo) {
      row = await get(
        `SELECT * FROM receitas_mes
         WHERE user_id = $1 AND ym = $2 AND status IN ('pendente','atrasado')
           AND (lower(titulo) = lower($3) OR titulo ILIKE $4)
         ORDER BY CASE WHEN lower(titulo) = lower($3) THEN 0 ELSE 1 END, dia_previsto NULLS LAST
         LIMIT 1`,
        [userId, ymRec, titulo, `%${titulo}%`]
      );
    }
    if (!row) {
      return { tipo, ok: false, erro: 'receita não encontrada' };
    }
    if (row.status === 'recebido') {
      return { tipo, ok: true, titulo: row.titulo, ja: true };
    }
    const valor = Number(acao.valor_recebido ?? acao.valor ?? row.valor_esperado);
    const recebidoEm = (acao.recebido_em && String(acao.recebido_em).slice(0, 10)) || hojeStr();
    await run(
      `UPDATE receitas_mes SET
         status = 'recebido',
         valor_recebido = $1,
         recebido_em = $2::date,
         origem = CASE WHEN origem = 'plano' THEN origem ELSE 'assistente' END,
         dia_previsto = COALESCE(dia_previsto, EXTRACT(DAY FROM $2::date)::int)
       WHERE id = $3 AND user_id = $4`,
      [valor, recebidoEm, row.id, userId]
    );
    return { tipo, ok: true, titulo: row.titulo, id: row.id, valor, recebido_em: recebidoEm };
  }

  if (tipo === 'criar_receita') {
    const ymRec = String(acao.ym || ym).slice(0, 7);
    const chave = String(acao.chave || '').trim() || 'outro';
    const tituloBody = String(acao.titulo || acao.nome || '').trim();
    const fixa = (plano.rendaFixa || []).find(r => r.chave === chave);
    const varr = (plano.rendaVariavelTipos || []).find(r => r.chave === chave);
    const titulo = tituloBody || (fixa && fixa.nome) || (varr && varr.label) || 'Receita';
    const valor = Number(acao.valor_recebido ?? acao.valor);
    if (!Number.isFinite(valor) || valor <= 0) {
      return { tipo, ok: false, erro: 'valor inválido' };
    }
    const recebidoEm = (acao.recebido_em && String(acao.recebido_em).slice(0, 10)) || hojeStr();
    const id = uuid();
    await run(
      `INSERT INTO receitas_mes
        (id, ym, titulo, valor_esperado, valor_recebido, dia_previsto, tipo, chave, status, recebido_em, notas, origem, user_id)
       VALUES ($1,$2,$3,$4,$5,$6,'variavel',$7,'recebido',$8,$9,'assistente',$10)`,
      [
        id,
        ymRec,
        titulo,
        valor,
        valor,
        recebidoEm ? Number(String(recebidoEm).slice(8, 10)) : null,
        chave,
        recebidoEm,
        acao.notas ? String(acao.notas).trim() : null,
        userId
      ]
    );
    return { tipo, ok: true, id, titulo, valor, chave, recebido_em: recebidoEm };
  }

  if (tipo === 'depositar_meta') {
    const valor = Number(acao.valor);
    if (!Number.isFinite(valor) || valor <= 0) {
      return { tipo, ok: false, erro: 'valor inválido' };
    }
    let meta = null;
    if (acao.id) meta = await get(`SELECT id, nome, valor_total, concluida FROM metas WHERE id = $1 AND user_id = $2`, [acao.id, userId]);
    const nome = String(acao.nome || acao.titulo || acao.meta || '').trim();
    if (!meta && nome) {
      meta = await get(
        `SELECT id, nome, valor_total, concluida FROM metas
         WHERE user_id = $1 AND (lower(nome) = lower($2) OR nome ILIKE $3)
         ORDER BY CASE WHEN lower(nome) = lower($2) THEN 0 ELSE 1 END, concluida ASC
         LIMIT 1`,
        [userId, nome, `%${nome}%`]
      );
    }
    if (!meta) {
      return { tipo, ok: false, erro: 'meta não encontrada' };
    }
    await run(
      `INSERT INTO metas_depositos (meta_id, valor, descricao, user_id) VALUES ($1,$2,$3,$4)`,
      [meta.id, valor, acao.descricao || 'via assistente', userId]
    );
    const soma = await get(
      `SELECT COALESCE(SUM(valor),0) AS s FROM metas_depositos WHERE meta_id = $1 AND user_id = $2`,
      [meta.id, userId]
    );
    let concluidaAgora = false;
    if (Number(soma.s) >= Number(meta.valor_total) && !meta.concluida) {
      await run(`UPDATE metas SET concluida = true WHERE id = $1 AND user_id = $2`, [meta.id, userId]);
      concluidaAgora = true;
    }
    return {
      tipo,
      ok: true,
      meta: meta.nome,
      valor,
      guardado: brlNum(soma.s),
      concluida: concluidaAgora || !!meta.concluida
    };
  }

  if (tipo === 'criar_transacao') {
    const rawSentido = String(acao.tipo_tx || acao.sentido || acao.movimento || '').toLowerCase();
    const sentido = rawSentido === 'entrada' ? 'entrada' : 'saida';
    const valor = Math.abs(Number(acao.valor));
    if (!Number.isFinite(valor) || valor <= 0) {
      return { tipo, ok: false, erro: 'valor inválido' };
    }
    const desc = String(acao.descricao || acao.titulo || '').trim() || 'Manual';
    const data = (acao.data && String(acao.data).slice(0, 10)) || hojeStr();
    let cat = String(acao.categoria || '').trim() || 'outros';
    if (cat && !/^[a-z0-9_]+$/i.test(cat)) {
      const g = await garantirCategoria({ categoria_label: cat });
      cat = g ? g.chave : normalizarChave(cat) || 'outros';
    }
    const id = uuid();
    await run(
      `INSERT INTO financeiro (id, tipo, valor, descricao, data, categoria, fonte, categoria_confirmada, user_id)
       VALUES ($1,$2,$3,$4,$5,$6,'manual',true,$7)`,
      [id, sentido, valor, desc, data, cat, userId]
    );
    return {
      tipo,
      ok: true,
      id,
      sentido,
      valor,
      descricao: desc,
      data,
      categoria: cat
    };
  }

  if (tipo === 'deletar_transacao') {
    const txs = await buscarTxsComFallback(acao);
    if (!txs.length) {
      return { tipo, ok: false, erro: 'nenhuma transação encontrada' };
    }
    const ids = txs.map(t => t.id);
    await run(`DELETE FROM financeiro WHERE user_id = $1 AND id = ANY($2::text[])`, [userId, ids]);
    return {
      tipo,
      ok: true,
      qtd: ids.length,
      ids,
      exemplos: txs.slice(0, 3).map(t => String(t.descricao || '').slice(0, 40))
    };
  }

  if (tipo === 'corrigir_data_tx') {
    const novaData = String(acao.data || acao.nova_data || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(novaData)) {
      return { tipo, ok: false, erro: 'data (YYYY-MM-DD) obrigatória' };
    }
    const txs = await buscarTxsComFallback(acao);
    if (!txs.length) {
      return { tipo, ok: false, erro: 'nenhuma transação encontrada' };
    }
    const ids = txs.map(t => t.id);
    await run(`UPDATE financeiro SET data = $1::date WHERE user_id = $2 AND id = ANY($3::text[])`, [novaData, userId, ids]);
    return {
      tipo,
      ok: true,
      data: novaData,
      qtd: ids.length,
      ids,
      exemplos: txs.slice(0, 3).map(t => String(t.descricao || '').slice(0, 40))
    };
  }

  if (tipo === 'marcar_das') {
    const ymDas = String(acao.ym || ym).slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ymDas)) {
      return { tipo, ok: false, erro: 'ym inválido' };
    }
    const pago = acao.pago === false ? false : true;
    const valor = acao.valor != null ? Number(acao.valor) : null;
    const existeDas = await get(`SELECT ym FROM mei_das WHERE ym = $1 AND user_id = $2`, [ymDas, userId]);
    if (existeDas) {
      await run(
        `UPDATE mei_das SET
           valor = COALESCE($1, valor),
           pago = $2,
           data_pagamento = CASE WHEN $2 THEN CURRENT_DATE ELSE NULL END
         WHERE ym = $3 AND user_id = $4`,
        [Number.isFinite(valor) ? valor : null, pago, ymDas, userId]
      );
    } else {
      await run(
        `INSERT INTO mei_das (ym, valor, pago, data_pagamento, user_id)
         VALUES ($1, $2, $3, CASE WHEN $3 THEN CURRENT_DATE ELSE NULL END, $4)`,
        [ymDas, Number.isFinite(valor) ? valor : null, pago, userId]
      );
    }
    return { tipo, ok: true, ym: ymDas, pago, valor: Number.isFinite(valor) ? valor : null };
  }

  if (tipo === 'reconciliar_despesas') {
    const { reconciliarMes } = require('../../../../routes/despesas');
    const ymRec = String(acao.ym || ym).slice(0, 7);
    const out = await reconciliarMes(userId, ymRec);
    return {
      tipo,
      ok: true,
      ym: out.ym,
      matched: out.matched || 0,
      detalhes: (out.detalhes || []).slice(0, 12)
    };
  }

  if (tipo === 'sincronizar_bancos') {
    const openfinanceLocal = require('../../../../routes/openfinance');
    const { reconciliarMes } = require('../../../../routes/despesas');
    const sync = await openfinanceLocal.syncAll(null, { refresh: true }, userId);
    if (sync && sync.semItems) {
      return { tipo, ok: false, erro: 'Nenhum banco conectado' };
    }
    const out = await reconciliarMes(userId, ym);
    return {
      tipo,
      ok: true,
      importadas: (sync && sync.importadas) || 0,
      matched: out.matched || 0,
      detalhes: (out.detalhes || []).slice(0, 12)
    };
  }

  return null;
}

module.exports = { TYPES, handle };
