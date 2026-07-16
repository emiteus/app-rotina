const express = require('express');
const { v4: uuid } = require('uuid');
const axios = require('axios');
const { run, get, all } = require('../lib/db');

const router = express.Router();
const PLUGGY_BASE = 'https://api.pluggy.ai';

let wsServer;
function emitUpdate(tipo, dados) {
  if (wsServer) wsServer.broadcast({ tipo: 'financeiro-' + tipo, dados });
}

// ---- Credenciais ----
function temCredenciais() {
  return !!(process.env.PLUGGY_CLIENT_ID && process.env.PLUGGY_CLIENT_SECRET);
}

// Cache simples do apiKey (validade ~2h; renovamos a cada 1h)
let _apiKey = null;
let _apiKeyAt = 0;
async function getApiKey() {
  if (!temCredenciais()) {
    const e = new Error('PLUGGY_NAO_CONFIGURADO');
    e.code = 'PLUGGY_NAO_CONFIGURADO';
    throw e;
  }
  const agora = Date.now();
  if (_apiKey && (agora - _apiKeyAt) < 60 * 60 * 1000) return _apiKey;
  const resp = await axios.post(`${PLUGGY_BASE}/auth`, {
    clientId: process.env.PLUGGY_CLIENT_ID,
    clientSecret: process.env.PLUGGY_CLIENT_SECRET
  });
  _apiKey = resp.data.apiKey;
  _apiKeyAt = agora;
  return _apiKey;
}

// Mapeia categoria do Pluggy pras categorias do app
function mapCategoria(pluggyCat) {
  if (!pluggyCat) return 'outros';
  const c = String(pluggyCat).toLowerCase();
  if (/(food|restaurant|aliment|grocer|mercado|supermerc)/.test(c)) return 'alimentacao';
  if (/(transport|uber|fuel|gasolin|combust|mobilidade)/.test(c)) return 'transporte';
  if (/(health|saude|pharm|farmac|medic)/.test(c)) return 'saude';
  if (/(leisure|lazer|entertain|game|streaming|cinema)/.test(c)) return 'lazer';
  if (/(rent|hous|moradia|aluguel|utilit)/.test(c)) return 'moradia';
  if (/(bet|gambl|aposta|casino|superbet|bon lation)/.test(c)) return 'apostas';
  if (/(salary|salario|payroll|income|renda)/.test(c)) return 'receita_trabalho';
  return 'outros';
}

// Chave de aprendizado: normaliza estabelecimento/descrição p/ casar transações semelhantes
function chaveCategoria(t) {
  const raw = (t.merchant && (t.merchant.name || t.merchant.businessName))
    || (t.paymentData && ((t.paymentData.receiver && t.paymentData.receiver.name) || (t.paymentData.payer && t.paymentData.payer.name)))
    || t.description || '';
  return String(raw).toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 40) || 'semchave';
}

// =====================================================
// STATUS — frontend checa se Open Finance está disponível
// =====================================================
router.get('/status', async (req, res) => {
  try {
    const items = temCredenciais() ? await all(`SELECT * FROM openfinance_items ORDER BY criado_em DESC`) : [];
    res.json({ configurado: temCredenciais(), items });
  } catch (err) {
    res.json({ configurado: temCredenciais(), items: [], erro: err.message });
  }
});

// =====================================================
// ITEMS-STATUS — status detalhado por item (última sync, auto?, precisa reconectar?)
// =====================================================
router.get('/items-status', async (req, res) => {
  try {
    const items = await all(`
      SELECT item_id, apelido, connector_nome, pessoa, ultima_sync, next_auto_sync, status
      FROM openfinance_items
      ORDER BY criado_em
    `);
    const agora = Date.now();
    const out = items.map(it => {
      const ultimaMs = it.ultima_sync ? new Date(it.ultima_sync).getTime() : 0;
      const horas = ultimaMs ? Math.round((agora - ultimaMs) / 36e5) : null;
      const auto = !!it.next_auto_sync;
      return {
        item_id: it.item_id,
        apelido: it.apelido || it.connector_nome || 'Banco',
        pessoa: it.pessoa || 'PF',
        ultima_sync: it.ultima_sync,
        horas_desde_sync: horas,
        auto_sync: auto,
        next_auto_sync: it.next_auto_sync,
        precisa_reconectar: !auto && horas !== null && horas > 48,
        status: it.status || 'ativo'
      };
    });
    res.json({ items: out });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// =====================================================
// SALDOS — saldo REAL das contas (banco = ativo, cartão = dívida)
// =====================================================
router.get('/saldos', async (req, res) => {
  try {
    const contas = await all(`SELECT account_id, tipo, nome, saldo, saldo_em FROM openfinance_accounts ORDER BY tipo, nome`);
    let totalBanco = 0, totalCredito = 0;
    let saldoEmMaisAntigo = null;
    contas.forEach(c => {
      const v = Number(c.saldo) || 0;
      if (c.tipo === 'CREDIT') totalCredito += v; else totalBanco += v;
      if (c.saldo_em && (!saldoEmMaisAntigo || new Date(c.saldo_em) < new Date(saldoEmMaisAntigo))) {
        saldoEmMaisAntigo = c.saldo_em;
      }
    });
    res.json({
      contas,
      totalBanco,            // dinheiro disponível em conta
      totalCredito,          // fatura de cartão (dívida)
      saldoLiquido: totalBanco - totalCredito,
      saldoEmMaisAntigo      // data do saldo mais desatualizado (pra avisar)
    });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// =====================================================
// CONTAS — visão multi-conta consolidada (PF vs PJ)
// =====================================================
router.get('/contas', async (req, res) => {
  try {
    const items = await all(`SELECT item_id, connector_nome, pessoa, apelido, ultima_sync FROM openfinance_items ORDER BY criado_em`);
    const accounts = await all(`SELECT account_id, item_id, tipo, nome, saldo, saldo_em FROM openfinance_accounts`);

    // Fluxo do mês atual por conta (account_id)
    const agora = new Date();
    const mesAtual = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
    const tx = await all(
      `SELECT account_id, tipo, SUM(valor) AS total
       FROM financeiro
       WHERE account_id IS NOT NULL AND TO_CHAR(data, 'YYYY-MM') = $1
       GROUP BY account_id, tipo`, [mesAtual]
    );
    const fluxoPorConta = {};
    tx.forEach(r => {
      if (!fluxoPorConta[r.account_id]) fluxoPorConta[r.account_id] = { entradas: 0, saidas: 0 };
      fluxoPorConta[r.account_id][r.tipo === 'entrada' ? 'entradas' : 'saidas'] += Number(r.total) || 0;
    });

    const consolidado = {
      PF: { saldoBanco: 0, saldoCredito: 0, entradasMes: 0, saidasMes: 0 },
      PJ: { saldoBanco: 0, saldoCredito: 0, entradasMes: 0, saidasMes: 0 }
    };

    const contas = items.map(it => {
      const accs = accounts.filter(a => a.item_id === it.item_id);
      let saldoBanco = 0, saldoCredito = 0, entradasMes = 0, saidasMes = 0;
      accs.forEach(a => {
        const v = Number(a.saldo) || 0;
        if (a.tipo === 'CREDIT') saldoCredito += v; else saldoBanco += v;
        const f = fluxoPorConta[a.account_id] || { entradas: 0, saidas: 0 };
        entradasMes += f.entradas; saidasMes += f.saidas;
      });
      const p = (it.pessoa === 'PJ') ? 'PJ' : 'PF';
      consolidado[p].saldoBanco += saldoBanco;
      consolidado[p].saldoCredito += saldoCredito;
      consolidado[p].entradasMes += entradasMes;
      consolidado[p].saidasMes += saidasMes;
      return {
        item_id: it.item_id,
        connector_nome: it.connector_nome,
        pessoa: p,
        apelido: it.apelido || it.connector_nome || 'Conta',
        ultima_sync: it.ultima_sync,
        accounts: accs,
        saldoBanco, saldoCredito, entradasMes, saidasMes
      };
    });

    consolidado.totalBanco = consolidado.PF.saldoBanco + consolidado.PJ.saldoBanco;
    consolidado.totalCredito = consolidado.PF.saldoCredito + consolidado.PJ.saldoCredito;

    res.json({ contas, consolidado, mes: mesAtual });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// PATCH — marcar PF/PJ e apelido de um banco
router.patch('/contas/:itemId', async (req, res) => {
  try {
    const { pessoa, apelido } = req.body || {};
    const p = pessoa === 'PJ' ? 'PJ' : 'PF';
    await run(
      `UPDATE openfinance_items SET pessoa = $1, apelido = COALESCE($2, apelido) WHERE item_id = $3`,
      [p, apelido || null, req.params.itemId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// =====================================================
// CONNECT TOKEN — usado pelo widget Pluggy Connect
// =====================================================
router.post('/connect-token', async (req, res) => {
  try {
    const apiKey = await getApiKey();
    const body = {};
    if (req.body && req.body.itemId) body.itemId = req.body.itemId; // modo update/reconexão
    const resp = await axios.post(`${PLUGGY_BASE}/connect_token`, body, {
      headers: { 'X-API-KEY': apiKey }
    });
    res.json({ accessToken: resp.data.accessToken });
  } catch (err) {
    if (err.code === 'PLUGGY_NAO_CONFIGURADO') {
      return res.status(400).json({ erro: 'Open Finance não configurado. Adicione PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET no .env.' });
    }
    res.status(500).json({ erro: err.response?.data?.message || err.message });
  }
});

// =====================================================
// SALVAR ITEM — após o widget conectar um banco
// =====================================================
router.post('/items', async (req, res) => {
  const { itemId, connectorNome } = req.body;
  if (!itemId) return res.status(400).json({ erro: 'itemId obrigatório' });
  try {
    await run(
      `INSERT INTO openfinance_items (item_id, connector_nome, status)
       VALUES ($1, $2, 'ativo')
       ON CONFLICT (item_id) DO UPDATE SET connector_nome = EXCLUDED.connector_nome, status = 'ativo'`,
      [itemId, connectorNome || 'Banco']
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// =====================================================
// IMPORTAR POR ITEM ID — conecta o banco no meu.pluggy.ai e cola o Item ID aqui
// =====================================================
router.post('/import-item', async (req, res) => {
  const itemId = (req.body && req.body.itemId || '').trim();
  if (!itemId) return res.status(400).json({ erro: 'Cole o Item ID do Pluggy.' });
  try {
    const apiKey = await getApiKey();
    // Valida o item e pega o nome do banco
    let item;
    try {
      const r = await axios.get(`${PLUGGY_BASE}/items/${itemId}`, { headers: { 'X-API-KEY': apiKey } });
      item = r.data;
    } catch (e) {
      if (e.response?.status === 404) {
        return res.status(404).json({ erro: 'Item ID não encontrado na sua conta Pluggy. Confira se copiou certo.' });
      }
      throw e;
    }
    const nome = (item.connector && item.connector.name) || 'Banco';
    await run(
      `INSERT INTO openfinance_items (item_id, connector_nome, status)
       VALUES ($1, $2, 'ativo')
       ON CONFLICT (item_id) DO UPDATE SET connector_nome = EXCLUDED.connector_nome, status = 'ativo'`,
      [itemId, nome]
    );
    const r = await syncItem(apiKey, itemId);
    if (r.importadas > 0) emitUpdate('sync', { importadas: r.importadas });
    res.json({ ok: true, connectorNome: nome, importadas: r.importadas, ignoradas: r.ignoradas });
  } catch (err) {
    if (err.code === 'PLUGGY_NAO_CONFIGURADO') {
      return res.status(400).json({ erro: 'Open Finance não configurado no .env.' });
    }
    res.status(500).json({ erro: err.response?.data?.message || err.message });
  }
});

// =====================================================
// SYNC — puxa transações do(s) banco(s) e importa
// =====================================================
async function syncItem(apiKey, itemId) {
  let importadas = 0, ignoradas = 0;

  // Pega metadata do item pra saber se tem auto-sync (produção Pluggy) ou é Meu Pluggy
  try {
    const itemResp = await axios.get(`${PLUGGY_BASE}/items/${itemId}`, { headers: { 'X-API-KEY': apiKey } });
    const nextAuto = itemResp.data && itemResp.data.nextAutoSyncAt;
    await run(`UPDATE openfinance_items SET next_auto_sync = $1 WHERE item_id = $2`, [nextAuto || null, itemId]);
  } catch (e) { /* segue mesmo sem meta */ }

  // Regras de categoria aprendidas (chave -> categoria)
  const regras = {};
  try {
    (await all(`SELECT chave, categoria FROM categoria_regras`)).forEach(r => { regras[r.chave] = r.categoria; });
  } catch (e) { /* segue sem regras */ }

  // 1. Contas do item
  const accResp = await axios.get(`${PLUGGY_BASE}/accounts`, {
    headers: { 'X-API-KEY': apiKey },
    params: { itemId }
  });
  const contas = accResp.data.results || [];

  // Guarda o saldo REAL de cada conta (banco = ativo, cartão = dívida)
  for (const conta of contas) {
    try {
      await run(
        `INSERT INTO openfinance_accounts (account_id, item_id, tipo, nome, saldo, saldo_em, atualizado_em)
         VALUES ($1,$2,$3,$4,$5,$6, CURRENT_TIMESTAMP)
         ON CONFLICT (account_id) DO UPDATE SET tipo=EXCLUDED.tipo, nome=EXCLUDED.nome, saldo=EXCLUDED.saldo, saldo_em=EXCLUDED.saldo_em, atualizado_em=CURRENT_TIMESTAMP`,
        [conta.id, itemId, conta.type || 'BANK', conta.name || conta.marketingName || 'Conta', Number(conta.balance) || 0, conta.updatedAt || null]
      );
    } catch (e) { /* não bloqueia o sync por causa de saldo */ }
  }

  // Janela: últimos 90 dias
  const from = new Date();
  from.setDate(from.getDate() - 90);
  const fromStr = from.toISOString().split('T')[0];

  for (const conta of contas) {
    // v2/transactions: paginação por cursor ("next" = URL da próxima página).
    // O endpoint não aceita filtro de data, então filtramos a janela aqui.
    let url = `${PLUGGY_BASE}/v2/transactions`;
    let params = { accountId: conta.id };
    let guard = 0;
    let parar = false;
    while (url && guard < 200 && !parar) {
      guard++;
      const txResp = await axios.get(url, { headers: { 'X-API-KEY': apiKey }, params });
      const results = txResp.data.results || [];

      for (const t of results) {
        const dataUso = (t.date || '').split('T')[0] || new Date().toISOString().split('T')[0];
        if (dataUso < fromStr) { parar = true; continue; } // mais antiga que a janela → para
        // Cartão de crédito (CREDIT): amount+ = compra (saída), amount- = estorno/pagamento (entrada).
        // Conta bancária (BANK): amount+ ou type=CREDIT = entrada, senão saída.
        const ehCartao = conta.type === 'CREDIT';
        const tipo = ehCartao
          ? (Number(t.amount) > 0 ? 'saida' : 'entrada')
          : ((t.type === 'CREDIT' || Number(t.amount) > 0) ? 'entrada' : 'saida');
        const valor = Math.abs(Number(t.amount) || 0);
        if (valor === 0) { ignoradas++; continue; }
        const extId = `pluggy:${t.id}`;
        const chave = chaveCategoria(t);
        const regra = regras[chave];
        const categoria = regra || mapCategoria(t.category);
        const confirmada = !!regra; // se veio de regra aprendida, já está confirmada
        try {
          const r = await run(
            `INSERT INTO financeiro (id, tipo, valor, descricao, data, categoria, external_id, fonte, account_id, chave_categoria, categoria_confirmada)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'pluggy',$8,$9,$10)
             ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO NOTHING`,
            [uuid(), tipo, valor, t.description || 'Transação bancária', dataUso, categoria, extId, conta.id, chave, confirmada]
          );
          if (r.rowCount > 0) importadas++; else ignoradas++;
        } catch (e) { ignoradas++; }
      }
      // próxima página: o "next" já vem com query string embutida
      url = parar ? null : (txResp.data.next || null);
      params = undefined;
    }
  }

  await run(`UPDATE openfinance_items SET ultima_sync = CURRENT_TIMESTAMP WHERE item_id = $1`, [itemId]);
  return { importadas, ignoradas };
}

// Lógica reutilizável (usada pela rota e pelo agendador automático)
async function syncAll(itemId) {
  const apiKey = await getApiKey();
  const items = itemId
    ? [{ item_id: itemId }]
    : await all(`SELECT item_id FROM openfinance_items WHERE status = 'ativo'`);
  if (items.length === 0) return { semItems: true, importadas: 0, ignoradas: 0 };

  let importadas = 0, ignoradas = 0;
  for (const it of items) {
    const r = await syncItem(apiKey, it.item_id);
    importadas += r.importadas;
    ignoradas += r.ignoradas;
  }
  if (importadas > 0) emitUpdate('sync', { importadas });
  return { importadas, ignoradas };
}

router.post('/sync', async (req, res) => {
  try {
    const r = await syncAll(req.body && req.body.itemId);
    if (r.semItems) return res.status(400).json({ erro: 'Nenhum banco conectado. Conecte um banco primeiro.' });
    res.json({ ok: true, importadas: r.importadas, ignoradas: r.ignoradas });
  } catch (err) {
    if (err.code === 'PLUGGY_NAO_CONFIGURADO') {
      return res.status(400).json({ erro: 'Open Finance não configurado. Adicione PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET no .env.' });
    }
    res.status(500).json({ erro: err.response?.data?.message || err.message });
  }
});

// Exposto pro agendador (server.js)
router.syncAll = function () {
  return syncAll().catch(e => ({ erro: e.message }));
};
router.temCredenciais = temCredenciais;

// =====================================================
// DESCONECTAR banco
// =====================================================
router.delete('/items/:itemId', async (req, res) => {
  try {
    const itemId = req.params.itemId;
    // tenta remover no Pluggy (best-effort)
    try {
      const apiKey = await getApiKey();
      await axios.delete(`${PLUGGY_BASE}/items/${itemId}`, { headers: { 'X-API-KEY': apiKey } });
    } catch (e) { /* ignora falha remota */ }
    await run(`DELETE FROM openfinance_accounts WHERE item_id = $1`, [itemId]);
    await run(`DELETE FROM openfinance_items WHERE item_id = $1`, [itemId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.setWsServer = function (ws) { wsServer = ws; };

// =====================================================
// BACKFILL CARTÕES — apaga transações Pluggy de contas CREDIT e re-sincroniza
// (uso pontual após fix do bug de sinal invertido no sync)
// =====================================================
router.post('/backfill-cartoes', async (req, res) => {
  try {
    const cartoes = await all(`SELECT account_id FROM openfinance_accounts WHERE tipo = 'CREDIT'`);
    if (cartoes.length === 0) return res.status(400).json({ erro: 'Nenhuma conta CREDIT encontrada.' });
    const ids = cartoes.map(c => c.account_id);
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    const del = await run(`DELETE FROM financeiro WHERE fonte = 'pluggy' AND account_id IN (${placeholders})`, ids);
    const sync = await syncAll();
    res.json({ ok: true, cartoes: ids.length, deletadas: del.rowCount, importadas: sync.importadas, ignoradas: sync.ignoradas });
  } catch (err) {
    if (err.code === 'PLUGGY_NAO_CONFIGURADO') {
      return res.status(400).json({ erro: 'Open Finance não configurado.' });
    }
    res.status(500).json({ erro: err.response?.data?.message || err.message });
  }
});

module.exports = router;
