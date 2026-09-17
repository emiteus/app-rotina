/**
 * Tool action handlers (extracted from routes/ia.js — debt reduction).
 * Behavior unchanged; runToolBatch wraps timeout/HITL/logs.
 */
const { v4: uuid } = require('uuid');
const { all, run, get } = require('../../db');
const { checkinHabito } = require('../../habitos');
const { hojeStr, ymAtual, dataResetSql } = require('../../datas');
const { persistirHistoricoDia } = require('../../historico');
const plano = require('../../plano-financeiro');
const openfinanceRouter = require('../../../routes/openfinance');

async function executarAcoesCorpo(acoes, userId) {
  if (!Array.isArray(acoes) || acoes.length === 0) return [];
  const feitos = [];
  const ym = ymAtual();

  const normalizarChave = (label) => String(label || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 40);

  async function garantirCategoria(acao) {
    const labelHint = String(acao.categoria_label || acao.label || '').trim();
    const catRaw = String(acao.categoria || '').trim();
    const label = labelHint || catRaw;
    let chave = '';
    if (/^[a-z0-9_]+$/i.test(catRaw)) chave = catRaw.toLowerCase();
    else chave = normalizarChave(label || catRaw);
    if (!chave) return null;
    const existe = await get(
      `SELECT chave, label FROM categorias WHERE chave = $1 AND (user_id IS NULL OR user_id = $2)`,
      [chave, userId]
    );
    if (existe) {
      if (labelHint && labelHint !== existe.label) {
        await run(`UPDATE categorias SET label = $1 WHERE chave = $2 AND user_id = $3`, [labelHint, existe.chave, userId]);
        return { chave: existe.chave, label: labelHint, criada: false };
      }
      return { chave: existe.chave, label: existe.label, criada: false };
    }
    const lab = label || chave;
    await run(
      `INSERT INTO categorias (chave, label, criado_por_usuario, user_id) VALUES ($1,$2,true,$3)
       ON CONFLICT (chave) DO NOTHING`,
      [chave, lab, userId]
    );
    return { chave, label: lab, criada: true };
  }

  async function resolverCategoriaRef(ref) {
    const raw = String(ref || '').trim();
    if (!raw) return null;
    const chaveTry = /^[a-z0-9_]+$/i.test(raw) ? raw.toLowerCase() : normalizarChave(raw);
    let row = await get(
      `SELECT chave, label FROM categorias WHERE chave = $1 AND (user_id IS NULL OR user_id = $2)`,
      [chaveTry, userId]
    );
    if (!row) row = await get(
      `SELECT chave, label FROM categorias WHERE lower(label) = lower($1) AND (user_id IS NULL OR user_id = $2)`,
      [raw, userId]
    );
    if (!row) {
      row = await get(
        `SELECT chave, label FROM categorias
         WHERE (user_id IS NULL OR user_id = $3)
           AND (label ILIKE $1 OR chave ILIKE $2)
         ORDER BY length(label) ASC LIMIT 1`,
        [`%${raw}%`, `%${chaveTry}%`, userId]
      );
    }
    return row;
  }

  async function buscarTxsParaRecategorizar(acao) {
    const ids = Array.isArray(acao.ids) ? acao.ids.map(String).filter(Boolean).slice(0, 40) : [];
    if (ids.length) {
      return all(
        `SELECT id, descricao, valor, tipo, data, chave_categoria, categoria
         FROM financeiro WHERE user_id = $1 AND id = ANY($2::text[])`,
        [userId, ids]
      );
    }
    const f = acao.filtros || {};
    const W = [`user_id = $1`];
    const V = [userId];
    let p = 2;
    if (f.data) {
      W.push(`data::date = $${p++}::date`);
      V.push(String(f.data).slice(0, 10));
    } else {
      if (f.data_de) { W.push(`data::date >= $${p++}::date`); V.push(String(f.data_de).slice(0, 10)); }
      if (f.data_ate) { W.push(`data::date <= $${p++}::date`); V.push(String(f.data_ate).slice(0, 10)); }
    }
    if (f.tipo === 'entrada' || f.tipo === 'saida') {
      W.push(`tipo = $${p++}`);
      V.push(f.tipo);
    }
    const catFiltro = String(f.categoria || f.de || f.de_categoria || acao.de || '').trim();
    if (catFiltro) {
      W.push(`(categoria = $${p} OR lower(categoria) = lower($${p}))`);
      V.push(catFiltro);
      p++;
    }
    const valores = Array.isArray(f.valores)
      ? f.valores.map(Number).filter(n => Number.isFinite(n) && n > 0).slice(0, 20)
      : [];
    if (valores.length) {
      W.push(`ROUND(ABS(valor)::numeric, 2) = ANY($${p++}::numeric[])`);
      V.push(valores.map(v => Number(v).toFixed(2)));
    }
    const contem = Array.isArray(f.contem)
      ? f.contem.map(s => String(s || '').trim()).filter(Boolean).slice(0, 12)
      : [];
    if (contem.length) {
      const parts = [];
      for (const c of contem) {
        parts.push(`descricao ILIKE $${p++}`);
        V.push(`%${c}%`);
      }
      W.push(`(${parts.join(' OR ')})`);
    }
    if (!W.length) return [];
    const soCategoria = !!catFiltro && !f.data && !f.data_de && !f.data_ate && !valores.length && !contem.length;
    const lim = soCategoria ? 2000 : 40;
    return all(
      `SELECT id, descricao, valor, tipo, data, chave_categoria, categoria
       FROM financeiro
       WHERE ${W.join(' AND ')}
       ORDER BY data DESC
       LIMIT ${lim}`,
      V
    );
  }

  async function buscarTxsComFallback(acao) {
    let txs = await buscarTxsParaRecategorizar(acao);
    if (txs.length) return txs;
    const f = acao.filtros || {};
    const trecho = String(f.trecho || '').trim();
    if (trecho.length >= 8) {
      const frag = trecho.slice(0, 80).replace(/[%_\\]/g, '');
      txs = await all(
        `SELECT id, descricao, valor, tipo, data, chave_categoria, categoria
         FROM financeiro WHERE user_id = $1 AND descricao ILIKE $2
         ORDER BY data DESC LIMIT 40`,
        [userId, `%${frag}%`]
      );
      if (txs.length) return txs;
    }
    // IA às vezes manda "Superbet" mas a descrição é "SPRBT" — tenta de novo só com data/valores
    if (Array.isArray(f.contem) && f.contem.length && (f.data || f.data_de || (f.valores && f.valores.length))) {
      const { contem, ...rest } = f;
      txs = await buscarTxsParaRecategorizar({ ...acao, filtros: rest, ids: undefined });
      if (txs.length) return txs;
    }
    return txs;
  }

  for (const acao of acoes.slice(0, 8)) {
    const tipo = acao && acao.tipo;
    try {
      if (tipo === 'criar_despesa') {
        const titulo = String(acao.titulo || '').trim();
        const valor = Number(acao.valor_esperado ?? acao.valor);
        if (!titulo || !Number.isFinite(valor) || valor <= 0) {
          feitos.push({ tipo, ok: false, erro: 'titulo/valor inválidos' });
          continue;
        }
        const id = uuid();
        const dia = acao.dia_vencimento != null ? Number(acao.dia_vencimento) : null;
        await run(
          `INSERT INTO despesas_mes (id, ym, titulo, valor_esperado, dia_vencimento, categoria, status, origem, user_id)
           VALUES ($1,$2,$3,$4,$5,$6,'pendente','manual',$7)`,
          [id, acao.ym || ym, titulo, valor, Number.isFinite(dia) ? dia : null, acao.categoria || 'outros', userId]
        );
        feitos.push({ tipo, ok: true, titulo, valor });
      } else if (tipo === 'criar_tarefa') {
        const titulo = String(acao.titulo || '').trim();
        if (!titulo) {
          feitos.push({ tipo, ok: false, erro: 'titulo obrigatório' });
          continue;
        }
        const id = uuid();
        const dataReset = acao.data_reset && String(acao.data_reset).length >= 10
          ? dataResetSql(String(acao.data_reset).slice(0, 10))
          : dataResetSql(hojeStr());
        await run(
          `INSERT INTO tasks (id, titulo, descricao, prioridade, categoria, data_reset, hora, user_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [id, titulo, acao.descricao || '', acao.prioridade || 'media', acao.categoria || 'geral', dataReset, acao.hora || null, userId]
        );
        feitos.push({ tipo, ok: true, titulo });
      } else if (tipo === 'criar_meta') {
        const nome = String(acao.nome || acao.titulo || '').trim();
        const valor = Number(acao.valor_total ?? acao.valor);
        if (!nome || !Number.isFinite(valor) || valor <= 0) {
          feitos.push({ tipo, ok: false, erro: 'nome/valor inválidos' });
          continue;
        }
        const r = await get(
          `INSERT INTO metas (nome, valor_total, prazo, user_id) VALUES ($1,$2,$3,$4) RETURNING id`,
          [nome, valor, acao.prazo || null, userId]
        );
        feitos.push({ tipo, ok: true, nome, valor, id: r && r.id });
      } else if (tipo === 'marcar_habito') {
        const titulo = String(acao.titulo || 'Academia').trim() || 'Academia';
        const r = await checkinHabito(titulo, userId);
        persistirHistoricoDia(hojeStr(), userId).catch(() => {});
        feitos.push({
          tipo,
          ok: true,
          titulo: r.titulo || (r.task && r.task.titulo) || titulo,
          ja: r.ja,
          criada: r.criada
        });
      } else if (tipo === 'criar_categoria') {
        const cat = await garantirCategoria(acao);
        if (!cat) {
          feitos.push({ tipo, ok: false, erro: 'label/categoria obrigatórios' });
          continue;
        }
        feitos.push({
          tipo,
          ok: true,
          categoria: cat.chave,
          label: cat.label,
          criada: cat.criada
        });
      } else if (tipo === 'recategorizar') {
        const cat = await garantirCategoria(acao);
        if (!cat) {
          feitos.push({ tipo, ok: false, erro: 'categoria obrigatória' });
          continue;
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
          feitos.push({
            tipo,
            ok: false,
            erro: `Não achei lançamento com "${tokTxt}" no extrato${totalTxt}.${syncTxt} `
              + 'Se aparece no app do banco, confira Financeiro → Bancos. '
              + 'Ou me manda **valor e data** que eu procuro.',
            categoria: cat.chave,
            filtros: acao.filtros || null
          });
          continue;
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
        feitos.push({
          tipo,
          ok: true,
          categoria: cat.chave,
          label: cat.label,
          qtd: ids.length,
          ids,
          exemplos: txs.slice(0, 5).map(t => String(t.descricao || '').slice(0, 40))
        });
      } else if (tipo === 'renomear_categoria') {
        const novoLabel = String(acao.categoria_label || acao.label || acao.novo_nome || '').trim();
        if (!novoLabel) {
          feitos.push({ tipo, ok: false, erro: 'novo nome obrigatório' });
          continue;
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
          feitos.push({ tipo, ok: false, erro: 'categoria não encontrada pra renomear' });
          continue;
        }
        await run(`UPDATE categorias SET label = $1 WHERE chave = $2 AND user_id = $3`, [novoLabel, row.chave, userId]);
        feitos.push({
          tipo,
          ok: true,
          categoria: row.chave,
          label: novoLabel,
          label_antes: row.label
        });
      } else if (tipo === 'fundir_categorias') {
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
          feitos.push({ tipo, ok: false, erro: 'informe ao menos 2 categorias pra unificar' });
          continue;
        }
        if (!resolvidas.length) {
          feitos.push({ tipo, ok: false, erro: 'categorias de origem não encontradas' });
          continue;
        }

        const lab = novoLabel || resolvidas[0].label;
        const alvo = await garantirCategoria({
          categoria_label: lab,
          categoria: acao.categoria || undefined
        });
        if (!alvo) {
          feitos.push({ tipo, ok: false, erro: 'não deu pra criar categoria destino' });
          continue;
        }

        const chavesOrigem = resolvidas.map(r => r.chave).filter(c => c !== alvo.chave);
        if (!chavesOrigem.length) {
          // Só duplicata de label na mesma chave — só garante label
          await run(`UPDATE categorias SET label = $1 WHERE chave = $2 AND user_id = $3`, [lab, alvo.chave, userId]);
          feitos.push({
            tipo,
            ok: true,
            categoria: alvo.chave,
            label: lab,
            de: resolvidas.map(r => r.chave),
            qtd: 0
          });
          continue;
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

        feitos.push({
          tipo,
          ok: true,
          categoria: alvo.chave,
          label: lab,
          de: chavesOrigem,
          qtd: Number(updFin && updFin.rowCount) || 0
        });
      } else if (tipo === 'confirmar_despesa') {
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
          feitos.push({ tipo, ok: false, erro: 'despesa não encontrada' });
          continue;
        }
        if (row.status === 'pago') {
          feitos.push({ tipo, ok: true, titulo: row.titulo, ja: true });
          continue;
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
        feitos.push({ tipo, ok: true, titulo: row.titulo, id: row.id, pago_em: pagoEm });
      } else if (tipo === 'confirmar_receita') {
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
          feitos.push({ tipo, ok: false, erro: 'receita não encontrada' });
          continue;
        }
        if (row.status === 'recebido') {
          feitos.push({ tipo, ok: true, titulo: row.titulo, ja: true });
          continue;
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
        feitos.push({ tipo, ok: true, titulo: row.titulo, id: row.id, valor, recebido_em: recebidoEm });
      } else if (tipo === 'criar_receita') {
        const ymRec = String(acao.ym || ym).slice(0, 7);
        const chave = String(acao.chave || '').trim() || 'outro';
        const tituloBody = String(acao.titulo || acao.nome || '').trim();
        const fixa = (plano.rendaFixa || []).find(r => r.chave === chave);
        const varr = (plano.rendaVariavelTipos || []).find(r => r.chave === chave);
        const titulo = tituloBody || (fixa && fixa.nome) || (varr && varr.label) || 'Receita';
        const valor = Number(acao.valor_recebido ?? acao.valor);
        if (!Number.isFinite(valor) || valor <= 0) {
          feitos.push({ tipo, ok: false, erro: 'valor inválido' });
          continue;
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
        feitos.push({ tipo, ok: true, id, titulo, valor, chave, recebido_em: recebidoEm });
      } else if (tipo === 'depositar_meta') {
        const valor = Number(acao.valor);
        if (!Number.isFinite(valor) || valor <= 0) {
          feitos.push({ tipo, ok: false, erro: 'valor inválido' });
          continue;
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
          feitos.push({ tipo, ok: false, erro: 'meta não encontrada' });
          continue;
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
        feitos.push({
          tipo,
          ok: true,
          meta: meta.nome,
          valor,
          guardado: brlNum(soma.s),
          concluida: concluidaAgora || !!meta.concluida
        });
      } else if (tipo === 'concluir_tarefa') {
        const titulo = String(acao.titulo || acao.nome || '').trim();
        const id = acao.id ? String(acao.id) : null;
        const dataAlvo = (acao.data_reset || acao.data || hojeStr()).slice(0, 10);
        let row = null;
        if (id) row = await get(`SELECT id, titulo, concluida FROM tasks WHERE id = $1 AND user_id = $2`, [id, userId]);
        if (!row && titulo) {
          row = await get(
            `SELECT id, titulo, concluida FROM tasks
             WHERE user_id = $1 AND data_reset::date = $2::date AND concluida = false
               AND (lower(titulo) = lower($3) OR titulo ILIKE $4)
             ORDER BY CASE WHEN lower(titulo) = lower($3) THEN 0 ELSE 1 END
             LIMIT 1`,
            [userId, dataAlvo, titulo, `%${titulo}%`]
          );
        }
        if (!row) {
          feitos.push({ tipo, ok: false, erro: 'tarefa não encontrada' });
          continue;
        }
        if (row.concluida) {
          feitos.push({ tipo, ok: true, titulo: row.titulo, ja: true });
          continue;
        }
        await run(
          `UPDATE tasks SET concluida = true, concluida_em = COALESCE(concluida_em, CURRENT_TIMESTAMP) WHERE id = $1 AND user_id = $2`,
          [row.id, userId]
        );
        persistirHistoricoDia(hojeStr(), userId).catch(() => {});
        feitos.push({ tipo, ok: true, titulo: row.titulo, id: row.id });
      } else if (tipo === 'criar_evento') {
        const titulo = String(acao.titulo || '').trim();
        const data = String(acao.data || '').slice(0, 10);
        if (!titulo || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
          feitos.push({ tipo, ok: false, erro: 'titulo e data (YYYY-MM-DD) obrigatórios' });
          continue;
        }
        const id = uuid();
        await run(
          `INSERT INTO eventos (id, titulo, descricao, data, hora, tipo, cor, user_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [id, titulo, acao.descricao || '', data, acao.hora || null, acao.tipo_evento || acao.tipo || 'evento', acao.cor || 'blue', userId]
        );
        feitos.push({ tipo, ok: true, titulo, data, hora: acao.hora || null, id });
      } else if (tipo === 'criar_alarme') {
        const hora = String(acao.hora || '').trim();
        const mensagem = String(acao.mensagem || acao.titulo || '').trim();
        if (!/^\d{2}:\d{2}$/.test(hora) || !mensagem) {
          feitos.push({ tipo, ok: false, erro: 'hora (HH:MM) e mensagem obrigatórios' });
          continue;
        }
        const id = uuid();
        await run(`INSERT INTO alarmes (id, hora, mensagem, user_id) VALUES ($1,$2,$3,$4)`, [id, hora, mensagem, userId]);
        feitos.push({ tipo, ok: true, hora, mensagem, id });
      } else if (tipo === 'criar_transacao') {
        const rawSentido = String(acao.tipo_tx || acao.sentido || acao.movimento || '').toLowerCase();
        const sentido = rawSentido === 'entrada' ? 'entrada' : 'saida';
        const valor = Math.abs(Number(acao.valor));
        if (!Number.isFinite(valor) || valor <= 0) {
          feitos.push({ tipo, ok: false, erro: 'valor inválido' });
          continue;
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
        feitos.push({
          tipo,
          ok: true,
          id,
          sentido,
          valor,
          descricao: desc,
          data,
          categoria: cat
        });
      } else if (tipo === 'deletar_transacao') {
        const txs = await buscarTxsComFallback(acao);
        if (!txs.length) {
          feitos.push({ tipo, ok: false, erro: 'nenhuma transação encontrada' });
          continue;
        }
        const ids = txs.map(t => t.id);
        await run(`DELETE FROM financeiro WHERE user_id = $1 AND id = ANY($2::text[])`, [userId, ids]);
        feitos.push({
          tipo,
          ok: true,
          qtd: ids.length,
          ids,
          exemplos: txs.slice(0, 3).map(t => String(t.descricao || '').slice(0, 40))
        });
      } else if (tipo === 'corrigir_data_tx') {
        const novaData = String(acao.data || acao.nova_data || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(novaData)) {
          feitos.push({ tipo, ok: false, erro: 'data (YYYY-MM-DD) obrigatória' });
          continue;
        }
        const txs = await buscarTxsComFallback(acao);
        if (!txs.length) {
          feitos.push({ tipo, ok: false, erro: 'nenhuma transação encontrada' });
          continue;
        }
        const ids = txs.map(t => t.id);
        await run(`UPDATE financeiro SET data = $1::date WHERE user_id = $2 AND id = ANY($3::text[])`, [novaData, userId, ids]);
        feitos.push({
          tipo,
          ok: true,
          data: novaData,
          qtd: ids.length,
          ids,
          exemplos: txs.slice(0, 3).map(t => String(t.descricao || '').slice(0, 40))
        });
      } else if (tipo === 'marcar_das') {
        const ymDas = String(acao.ym || ym).slice(0, 7);
        if (!/^\d{4}-\d{2}$/.test(ymDas)) {
          feitos.push({ tipo, ok: false, erro: 'ym inválido' });
          continue;
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
        feitos.push({ tipo, ok: true, ym: ymDas, pago, valor: Number.isFinite(valor) ? valor : null });
      } else if (tipo === 'reconciliar_despesas') {
        const { reconciliarMes } = require('./despesas');
        const ymRec = String(acao.ym || ym).slice(0, 7);
        const out = await reconciliarMes(userId, ymRec);
        feitos.push({
          tipo,
          ok: true,
          ym: out.ym,
          matched: out.matched || 0,
          detalhes: (out.detalhes || []).slice(0, 12)
        });
      } else if (tipo === 'sincronizar_bancos') {
        const openfinanceRouter = require('./openfinance');
        const { reconciliarMes } = require('./despesas');
        const sync = await openfinanceRouter.syncAll(null, { refresh: true }, userId);
        if (sync && sync.semItems) {
          feitos.push({ tipo, ok: false, erro: 'Nenhum banco conectado' });
          continue;
        }
        const out = await reconciliarMes(userId, ym);
        feitos.push({
          tipo,
          ok: true,
          importadas: (sync && sync.importadas) || 0,
          matched: out.matched || 0,
          detalhes: (out.detalhes || []).slice(0, 12)
        });
      } else if (
        tipo === 'cinerush_buscar' ||
        tipo === 'cinerush_provisionar' ||
        tipo === 'cinerush_reenviar_email'
      ) {
        const { isPlanoOwnerUserId } = require('../lib/plano-owner');
        if (!(await isPlanoOwnerUserId(userId))) {
          feitos.push({ tipo, ok: false, erro: 'CineRush só pro dono' });
          continue;
        }
        const cr = require('../lib/cinerush');
        if (!cr.cinerushReady()) {
          feitos.push({ tipo, ok: false, erro: 'CineRush não configurado' });
          continue;
        }
        if (tipo === 'cinerush_buscar') {
          const out = await cr.buscarAssinantes(acao.search || acao.q || '', acao.status || undefined);
          feitos.push({
            tipo,
            ok: true,
            total: out.total,
            itens: (out.data || []).slice(0, 8).map((s) => ({
              id: s.id,
              nome: s.nome,
              email: s.email,
              plano: s.plano,
              status: s.status
            }))
          });
        } else if (tipo === 'cinerush_provisionar') {
          let id = acao.id;
          if (!id && (acao.search || acao.email || acao.nome)) {
            const found = await cr.buscarAssinantes(acao.search || acao.email || acao.nome, 'pendente');
            const hit = (found.data || [])[0];
            if (!hit) {
              feitos.push({ tipo, ok: false, erro: 'Assinante pendente não encontrado' });
              continue;
            }
            id = hit.id;
          }
          if (!id) {
            feitos.push({ tipo, ok: false, erro: 'id ou search obrigatório' });
            continue;
          }
          const updated = await cr.provisionarAssinante(id);
          feitos.push({
            tipo,
            ok: true,
            id: updated.id || id,
            nome: updated.nome,
            email: updated.email,
            status: updated.status
          });
        } else {
          let id = acao.id;
          if (!id && (acao.search || acao.email || acao.nome)) {
            const found = await cr.buscarAssinantes(acao.search || acao.email || acao.nome);
            const hit = (found.data || [])[0];
            if (!hit) {
              feitos.push({ tipo, ok: false, erro: 'Assinante não encontrado' });
              continue;
            }
            id = hit.id;
          }
          if (!id) {
            feitos.push({ tipo, ok: false, erro: 'id ou search obrigatório' });
            continue;
          }
          const updated = await cr.reenviarEmailAssinante(id, acao.force !== false);
          feitos.push({
            tipo,
            ok: true,
            id: updated.id || id,
            nome: updated.nome,
            email: updated.email,
            status: updated.status
          });
        }
      } else if (
        tipo === 'chatwoot_listar' ||
        tipo === 'chatwoot_resolver' ||
        tipo === 'chatwoot_atribuir'
      ) {
        const { isPlanoOwnerUserId } = require('../lib/plano-owner');
        if (!(await isPlanoOwnerUserId(userId))) {
          feitos.push({ tipo, ok: false, erro: 'Chatwoot só pro dono' });
          continue;
        }
        const cr = require('../lib/cinerush');
        if (!cr.cinerushReady()) {
          feitos.push({ tipo, ok: false, erro: 'CineRush/Chatwoot não configurado' });
          continue;
        }
        if (tipo === 'chatwoot_listar') {
          const out = await cr.listarChatwoot(acao.status || 'open', acao.limit || 15);
          feitos.push({
            tipo,
            ok: true,
            total: out.total,
            itens: out.items || []
          });
        } else if (tipo === 'chatwoot_resolver') {
          if (!acao.id) {
            feitos.push({ tipo, ok: false, erro: 'id da conversa obrigatório' });
            continue;
          }
          await cr.resolverChatwoot(acao.id);
          feitos.push({ tipo, ok: true, id: acao.id });
        } else {
          if (!acao.id) {
            feitos.push({ tipo, ok: false, erro: 'id da conversa obrigatório' });
            continue;
          }
          await cr.atribuirChatwoot(acao.id, acao.team_id);
          feitos.push({ tipo, ok: true, id: acao.id });
        }
      } else if (tipo === 'attracione_coleta' || tipo === 'attracione_backup' || tipo === 'attracione_ranking') {
        const { isPlanoOwnerUserId } = require('../lib/plano-owner');
        if (!(await isPlanoOwnerUserId(userId))) {
          feitos.push({ tipo, ok: false, erro: 'Attracione só pro dono' });
          continue;
        }
        const at = require('../lib/attracione');
        if (!at.attracioneReady()) {
          feitos.push({ tipo, ok: false, erro: 'Attracione não configurado' });
          continue;
        }
        if (tipo === 'attracione_coleta') {
          const out = await at.dispararColeta(acao.plataforma || undefined);
          feitos.push({ tipo, ok: true, resultado: out });
        } else if (tipo === 'attracione_backup') {
          const out = await at.dispararBackup();
          feitos.push({ tipo, ok: true, resultado: out });
        } else {
          const out = await at.rankingComp(acao.n || acao.comp || acao.numero);
          feitos.push({
            tipo,
            ok: true,
            competicao: out.competicao,
            top: (out.linhas || []).slice(0, 15).map((l) => ({
              pos: l.posicao,
              nome: l.nomeCompleto,
              views: l.views,
              premio: l.valor
            }))
          });
        }
      } else if (
        tipo === 'socialhub_posts' ||
        tipo === 'socialhub_agendar' ||
        tipo === 'socialhub_publicar_agendados'
      ) {
        const { isPlanoOwnerUserId } = require('../lib/plano-owner');
        if (!(await isPlanoOwnerUserId(userId))) {
          feitos.push({ tipo, ok: false, erro: 'SocialHub só pro dono' });
          continue;
        }
        const sh = require('../lib/socialhub');
        if (!sh.socialhubReady()) {
          feitos.push({ tipo, ok: false, erro: 'SocialHub não configurado' });
          continue;
        }
        if (tipo === 'socialhub_posts') {
          const out = await sh.listarPosts(acao.status || undefined, acao.limit || 10);
          feitos.push({ tipo, ok: true, itens: out.posts || [] });
        } else if (tipo === 'socialhub_agendar') {
          const out = await sh.agendarPost({
            caption: acao.caption,
            socialAccountIds: acao.socialAccountIds || acao.accountIds,
            scheduledAt: acao.scheduledAt,
            mediaUrls: acao.mediaUrls,
            mediaType: acao.mediaType
          });
          feitos.push({
            tipo,
            ok: true,
            id: out.post?.id,
            scheduledAt: out.post?.scheduledAt
          });
        } else {
          const out = await sh.publicarAgendados();
          feitos.push({
            tipo,
            ok: true,
            processed: out.cron?.processed,
            resultado: out.cron || out
          });
        }
      } else if (tipo === 'clipper_criar' || tipo === 'clipper_retry') {
        const { isPlanoOwnerUserId } = require('../lib/plano-owner');
        if (!(await isPlanoOwnerUserId(userId))) {
          feitos.push({ tipo, ok: false, erro: 'Clipper só pro dono' });
          continue;
        }
        const cl = require('../lib/clipper');
        if (!cl.clipperReady()) {
          feitos.push({
            tipo,
            ok: false,
            erro: 'Clipper offline — defina CLIPPER_API_URL (túnel pro PC)'
          });
          continue;
        }
        if (tipo === 'clipper_criar') {
          const out = await cl.criarClip({
            durationSeconds: acao.durationSeconds || acao.duracao || 30,
            note: acao.note || acao.nota,
            streamIds: acao.streamIds
          });
          feitos.push({ tipo, ok: true, id: out.group?.id, group: out.group });
        } else {
          if (!acao.id) {
            feitos.push({ tipo, ok: false, erro: 'id do grupo obrigatório' });
            continue;
          }
          const out = await cl.retryClip(acao.id);
          feitos.push({ tipo, ok: true, id: acao.id, group: out.group });
        }
      } else {
        feitos.push({ tipo: tipo || 'desconhecido', ok: false, erro: 'tipo não suportado' });
      }
    } catch (e) {
      feitos.push({ tipo, ok: false, erro: e.message });
    }
  }
  return feitos;
}

module.exports = { executarAcoesCorpo };
