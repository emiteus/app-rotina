const { requireLib } = require('../../host');
const { all, run, get } = requireLib('db');
const { ymAtual } = requireLib('datas');

function createHandlerContext(userId) {
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
        [likeContains(raw), likeContains(chaveTry), userId]
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
        V.push(likeContains(c));
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
        [userId, likeContains(frag)]
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

  return {
    userId,
    ym,
    normalizarChave,
    garantirCategoria,
    resolverCategoriaRef,
    buscarTxsParaRecategorizar,
    buscarTxsComFallback
  };
}

/**
 * Padrão ILIKE "contém" com % _ \ escapados (escape padrão do Postgres é \).
 * Sem isso, título "%" ou "_" casava com qualquer registro.
 */
function likeContains(text) {
  return `%${String(text || '').replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

module.exports = { createHandlerContext, likeContains };
