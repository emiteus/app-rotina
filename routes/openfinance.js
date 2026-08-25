const express = require('express');
const { v4: uuid } = require('uuid');
const axios = require('axios');
const { run, get, all } = require('../lib/db');
const { hojeStr, addDias } = require('../lib/datas');
const { categoriaObvia } = require('../lib/categoria-heuristica');
const { nomeBancoDisplay } = require('../lib/banco-nome');

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

/** Detecta PJ pelo nome do conector/apelido (Inter Empresas, MEI, etc.) */
function inferirPessoa(...nomes) {
  const t = nomes.filter(Boolean).join(' ').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (/\bempresas?\b|\bpj\b|\bmei\b|pessoa\s*juridica|business|cnpj|conta\s*pj|inter\s*pj|banco\s*inter\s*empresas/.test(t)) {
    return 'PJ';
  }
  return 'PF';
}

function apelidoPadrao(pessoa, connectorNome, apelidoAtual) {
  const atual = String(apelidoAtual || '').trim();
  const conn = String(connectorNome || '');
  if (atual && !/meu\s*pluggy/i.test(atual)) return atual;
  if (pessoa === 'PJ') {
    if (/inter|meu\s*pluggy/i.test(conn + ' ' + atual)) return 'Inter empresas';
    return atual || 'Empresa (PJ)';
  }
  if (/nu|nubank/i.test(conn)) return atual || 'Nubank';
  if (/inter/i.test(conn)) return atual || 'Inter';
  if (/meu\s*pluggy/i.test(conn)) return atual || null;
  return atual || null;
}

// =====================================================
// STATUS — frontend checa se Open Finance está disponível
// =====================================================
router.get('/status', async (req, res) => {
  try {
    // Sempre lista itens do DB (mesmo se Pluggy env falhar) pra UI não sumir
    const items = await all(`SELECT * FROM openfinance_items ORDER BY criado_em DESC`).catch(() => []);

    // Corrige PF/PJ óbvios e apelidos MeuPluggy → Inter/Nubank
    for (const it of items || []) {
      const inferida = inferirPessoa(it.connector_nome, it.apelido);
      if (inferida === 'PJ' && it.pessoa !== 'PJ') {
        const apelido = apelidoPadrao('PJ', it.connector_nome, it.apelido);
        await run(
          `UPDATE openfinance_items SET pessoa = 'PJ', apelido = COALESCE($1, apelido) WHERE item_id = $2`,
          [apelido, it.item_id]
        ).catch(() => {});
        it.pessoa = 'PJ';
        if (apelido) it.apelido = apelido;
      }

      const precisaApelido = !it.apelido || /meu\s*pluggy/i.test(String(it.apelido));
      if (precisaApelido) {
        const contas = await all(
          `SELECT nome, tipo FROM openfinance_accounts WHERE item_id = $1`,
          [it.item_id]
        ).catch(() => []);
        const bom = nomeBancoDisplay({
          apelido: it.apelido,
          connector_nome: it.connector_nome,
          pessoa: it.pessoa,
          contasNomes: (contas || []).map(c => c.nome)
        });
        if (bom && !/meu\s*pluggy/i.test(bom)) {
          await run(`UPDATE openfinance_items SET apelido = $1 WHERE item_id = $2`, [bom, it.item_id]).catch(() => {});
          it.apelido = bom;
        }
      }
    }

    const itemsOut = (items || []).map(it => {
      const nome = String(it.connector_nome || '');
      const ehMeuPluggy = /meu\s*pluggy/i.test(nome);
      return { ...it, ehMeuPluggy };
    });

    let somenteDemo = false;
    let conectoresReais = 0;
    if (temCredenciais()) {
      try {
        const apiKey = await getApiKey();
        const resp = await axios.get(`${PLUGGY_BASE}/connectors`, {
          headers: { 'X-API-KEY': apiKey },
          params: { countries: 'BR', sandbox: false },
          timeout: 15000
        });
        const lista = resp.data.results || [];
        const reais = lista.filter(c => c.name && !/meu\s*pluggy|pluggy bank/i.test(c.name));
        conectoresReais = reais.length;
        somenteDemo = lista.length > 0 && reais.length === 0;
      } catch (e) {
        /* ignora — status ainda responde */
      }
    }

    res.json({
      configurado: temCredenciais(),
      items: itemsOut,
      temMeuPluggy: itemsOut.some(i => i.ehMeuPluggy),
      somenteDemo,
      conectoresReais
    });
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
    const contas = await all(`
      SELECT a.account_id, a.item_id, a.tipo, a.nome, a.saldo, a.saldo_em, a.atualizado_em,
             COALESCE(i.pessoa, 'PF') AS pessoa,
             COALESCE(i.apelido, i.connector_nome, '') AS banco
      FROM openfinance_accounts a
      LEFT JOIN openfinance_items i ON i.item_id = a.item_id
      ORDER BY COALESCE(i.pessoa, 'PF'), a.tipo, a.nome
    `);
    const porPessoa = {
      PF: { totalBanco: 0, totalCredito: 0 },
      PJ: { totalBanco: 0, totalCredito: 0 }
    };
    let totalBanco = 0, totalCredito = 0;
    let saldoEmMaisAntigo = null;
    let atualizadoEmMaisRecente = null;

    contas.forEach(c => {
      const v = Number(c.saldo) || 0;
      const p = c.pessoa === 'PJ' ? 'PJ' : 'PF';
      if (c.tipo === 'CREDIT') {
        totalCredito += Math.abs(v);
        porPessoa[p].totalCredito += Math.abs(v);
      } else if (c.tipo === 'BANK' || !c.tipo) {
        totalBanco += v;
        porPessoa[p].totalBanco += v;
      }
      const ref = c.saldo_em || c.atualizado_em;
      if (ref && (!saldoEmMaisAntigo || new Date(ref) < new Date(saldoEmMaisAntigo))) {
        saldoEmMaisAntigo = ref;
      }
      if (c.atualizado_em && (!atualizadoEmMaisRecente || new Date(c.atualizado_em) > new Date(atualizadoEmMaisRecente))) {
        atualizadoEmMaisRecente = c.atualizado_em;
      }
    });

    porPessoa.PF.saldoLiquido = porPessoa.PF.totalBanco - porPessoa.PF.totalCredito;
    porPessoa.PJ.saldoLiquido = porPessoa.PJ.totalBanco - porPessoa.PJ.totalCredito;

    // "Em conta" na visão geral = só PF (pessoal). Sem contas PF, cai no total.
    const temPfBanco = contas.some(c => c.pessoa !== 'PJ' && c.tipo !== 'CREDIT');
    const emConta = temPfBanco ? porPessoa.PF.totalBanco : totalBanco;
    const demoMeuPluggy = contas.some(c => /meu\s*pluggy/i.test(String(c.banco || '')));

    res.json({
      contas,
      totalBanco,
      totalCredito,
      saldoLiquido: totalBanco - totalCredito,
      emConta,
      porPessoa,
      saldoEmMaisAntigo,
      atualizadoEm: atualizadoEmMaisRecente,
      demoMeuPluggy
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
        if (a.tipo === 'CREDIT') saldoCredito += Math.abs(v);
        else if (a.tipo === 'BANK' || !a.tipo) saldoBanco += v;
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

// PATCH — marcar PF/PJ e/ou apelido de um banco (só campos enviados)
router.patch('/contas/:itemId', async (req, res) => {
  try {
    const { pessoa, apelido } = req.body || {};
    const it = await get(`SELECT item_id, connector_nome, apelido, pessoa FROM openfinance_items WHERE item_id = $1`, [req.params.itemId]);
    if (!it) return res.status(404).json({ erro: 'Banco não encontrado' });

    const sets = [];
    const params = [];

    if (pessoa === 'PJ' || pessoa === 'PF') {
      params.push(pessoa);
      sets.push(`pessoa = $${params.length}`);
      // Ao marcar PJ, dá nome claro se ainda estiver genérico
      if (pessoa === 'PJ') {
        const novoApelido = apelido != null && String(apelido).trim()
          ? String(apelido).trim()
          : apelidoPadrao('PJ', it.connector_nome, it.apelido);
        if (novoApelido) {
          params.push(novoApelido);
          sets.push(`apelido = $${params.length}`);
        }
      } else if (pessoa === 'PF' && /empresas|empresa\s*\(pj\)/i.test(String(it.apelido || ''))) {
        // Voltou pra PF: tira apelido de empresa genérico
        const limpo = apelidoPadrao('PF', it.connector_nome, null) || 'Inter';
        params.push(limpo);
        sets.push(`apelido = $${params.length}`);
      }
    }

    if (apelido != null && String(apelido).trim() && !(pessoa === 'PJ' || pessoa === 'PF')) {
      params.push(String(apelido).trim());
      sets.push(`apelido = $${params.length}`);
    } else if (apelido != null && String(apelido).trim() && pessoa !== 'PJ') {
      // Renomear explícito junto com troca de pessoa (exceto PJ que já setou acima)
      params.push(String(apelido).trim());
      sets.push(`apelido = $${params.length}`);
    }

    if (!sets.length) return res.status(400).json({ erro: 'Nada pra atualizar' });
    params.push(req.params.itemId);
    await run(`UPDATE openfinance_items SET ${sets.join(', ')} WHERE item_id = $${params.length}`, params);
    const atualizado = await get(`SELECT item_id, connector_nome, apelido, pessoa FROM openfinance_items WHERE item_id = $1`, [req.params.itemId]);
    res.json({ ok: true, item: atualizado });
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
    const nome = connectorNome || 'Banco';
    const pessoa = inferirPessoa(nome);
    const apelido = apelidoPadrao(pessoa, nome, null);
    await run(
      `INSERT INTO openfinance_items (item_id, connector_nome, status, pessoa, apelido)
       VALUES ($1, $2, 'ativo', $3, $4)
       ON CONFLICT (item_id) DO UPDATE SET
         connector_nome = EXCLUDED.connector_nome,
         status = 'ativo',
         pessoa = CASE
           WHEN openfinance_items.pessoa = 'PJ' THEN openfinance_items.pessoa
           ELSE EXCLUDED.pessoa
         END,
         apelido = COALESCE(openfinance_items.apelido, EXCLUDED.apelido)`,
      [itemId, nome, pessoa, apelido]
    );
    res.status(201).json({ ok: true, pessoa, apelido });
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
    const pessoa = inferirPessoa(nome);
    const apelido = apelidoPadrao(pessoa, nome, null);
    await run(
      `INSERT INTO openfinance_items (item_id, connector_nome, status, pessoa, apelido)
       VALUES ($1, $2, 'ativo', $3, $4)
       ON CONFLICT (item_id) DO UPDATE SET
         connector_nome = EXCLUDED.connector_nome,
         status = 'ativo',
         pessoa = CASE
           WHEN openfinance_items.pessoa = 'PJ' THEN openfinance_items.pessoa
           ELSE EXCLUDED.pessoa
         END,
         apelido = COALESCE(openfinance_items.apelido, EXCLUDED.apelido)`,
      [itemId, nome, pessoa, apelido]
    );
    const r = await syncItem(apiKey, itemId);
    if (r.importadas > 0) emitUpdate('sync', { importadas: r.importadas });
    res.json({ ok: true, connectorNome: nome, pessoa, apelido, importadas: r.importadas, ignoradas: r.ignoradas });
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

const REFRESH_COOLDOWN_MS = 60 * 60 * 1000; // Pluggy limita update manual a ~1x/hora

function saldoDeContaPluggy(conta) {
  // BANK: balance = disponível; closingBalance = disponível + bloqueado (pode inflar)
  if (conta.type === 'BANK' && conta.bankData && conta.bankData.closingBalance != null) {
    // Preferimos o balance (disponível pra gastar)
    return Number(conta.balance) || 0;
  }
  return Number(conta.balance) || 0;
}

async function upsertConta(conta, itemId, saldoOverride, saldoEmOverride) {
  const saldo = saldoOverride != null ? Number(saldoOverride) : saldoDeContaPluggy(conta);
  const saldoEm = saldoEmOverride || conta.updatedAt || new Date().toISOString();
  await run(
    `INSERT INTO openfinance_accounts (account_id, item_id, tipo, nome, saldo, saldo_em, atualizado_em)
     VALUES ($1,$2,$3,$4,$5,$6, CURRENT_TIMESTAMP)
     ON CONFLICT (account_id) DO UPDATE SET
       tipo=EXCLUDED.tipo, nome=EXCLUDED.nome, saldo=EXCLUDED.saldo,
       saldo_em=EXCLUDED.saldo_em, atualizado_em=CURRENT_TIMESTAMP, item_id=EXCLUDED.item_id`,
    [
      conta.id || conta.account_id,
      itemId || conta.itemId,
      conta.type || 'BANK',
      conta.name || conta.marketingName || 'Conta',
      saldo,
      saldoEm
    ]
  );
}

/** Saldo em tempo real via GET /accounts/{id}/balance (sem full sync). */
async function refreshSaldoConta(apiKey, accountId, meta) {
  const resp = await axios.get(`${PLUGGY_BASE}/accounts/${accountId}/balance`, {
    headers: { 'X-API-KEY': apiKey },
    timeout: 20000
  });
  const bal = resp.data || {};
  const saldo = Number(bal.balance);
  if (!Number.isFinite(saldo)) throw new Error('balance inválido');
  const saldoEm = bal.updateDateTime || new Date().toISOString();
  if (meta && meta.tipo) {
    await run(
      `UPDATE openfinance_accounts SET saldo = $1, saldo_em = $2, atualizado_em = CURRENT_TIMESTAMP WHERE account_id = $3`,
      [saldo, saldoEm, accountId]
    );
  } else {
    await run(
      `UPDATE openfinance_accounts SET saldo = $1, saldo_em = $2, atualizado_em = CURRENT_TIMESTAMP WHERE account_id = $3`,
      [saldo, saldoEm, accountId]
    );
  }
  return { accountId, saldo, saldoEm };
}

async function refreshSaldosAll(opts = {}) {
  const apiKey = await getApiKey();
  const contas = await all(`SELECT account_id, item_id, tipo, nome FROM openfinance_accounts`);
  if (!contas.length) return { semContas: true, ok: 0, falhas: 0, detalhes: [], demoMeuPluggy: false };

  // MeuPluggy (demo) não tem /balance realtime nem PATCH update
  const itemsMeta = await all(`SELECT item_id, connector_nome FROM openfinance_items`);
  const demoIds = new Set(
    itemsMeta.filter(i => /meu\s*pluggy/i.test(String(i.connector_nome || ''))).map(i => i.item_id)
  );
  const demoMeuPluggy = demoIds.size > 0;

  let ok = 0, falhas = 0;
  const detalhes = [];
  const jaListouItem = new Map(); // itemId -> results

  async function listarContasItem(itemId) {
    if (jaListouItem.has(itemId)) return jaListouItem.get(itemId);
    const accResp = await axios.get(`${PLUGGY_BASE}/accounts`, {
      headers: { 'X-API-KEY': apiKey },
      params: { itemId },
      timeout: 20000
    });
    const results = accResp.data.results || [];
    jaListouItem.set(itemId, results);
    return results;
  }

  for (const c of contas) {
    const ehDemo = demoIds.has(c.item_id);
    // Contas demo: só lista (realtime e update não existem)
    if (ehDemo) {
      try {
        const results = await listarContasItem(c.item_id);
        const hit = results.find(a => a.id === c.account_id);
        if (hit) {
          await upsertConta(hit, c.item_id);
          ok++;
          detalhes.push({
            account_id: c.account_id,
            nome: c.nome,
            ok: true,
            saldo: saldoDeContaPluggy(hit),
            via: 'list',
            demo: true
          });
        } else {
          falhas++;
          detalhes.push({ account_id: c.account_id, nome: c.nome, ok: false, erro: 'conta não encontrada', demo: true });
        }
      } catch (e) {
        falhas++;
        detalhes.push({ account_id: c.account_id, nome: c.nome, ok: false, erro: (e.message || 'falha').slice(0, 120), demo: true });
      }
      continue;
    }

    try {
      const r = await refreshSaldoConta(apiKey, c.account_id, c);
      ok++;
      detalhes.push({ account_id: c.account_id, nome: c.nome, ok: true, saldo: r.saldo, via: 'realtime' });
    } catch (e) {
      const code = e.response?.data?.codeDescription || e.response?.data?.code || '';
      const msg = e.response?.data?.message || e.message || '';
      try {
        const results = await listarContasItem(c.item_id);
        const hit = results.find(a => a.id === c.account_id);
        if (hit) {
          await upsertConta(hit, c.item_id);
          ok++;
          detalhes.push({
            account_id: c.account_id,
            nome: c.nome,
            ok: true,
            saldo: saldoDeContaPluggy(hit),
            via: 'list',
            aviso: String(code || msg).slice(0, 80)
          });
        } else {
          falhas++;
          detalhes.push({ account_id: c.account_id, nome: c.nome, ok: false, erro: 'conta não encontrada' });
        }
      } catch (e2) {
        falhas++;
        detalhes.push({
          account_id: c.account_id,
          nome: c.nome,
          ok: false,
          erro: (e.response?.data?.message || e.message || 'falha').slice(0, 120)
        });
      }
    }
  }

  if (ok > 0) emitUpdate('saldos', { ok, falhas, demoMeuPluggy });
  return { ok, falhas, detalhes, demoMeuPluggy, forcarUpdate: !!opts.forcarUpdate };
}

/** Pede ao Pluggy pra ir no banco de novo (PATCH /items/{id}). Respeita cooldown 1h. */
async function pedirUpdateItem(apiKey, itemId, { forcar = false } = {}) {
  const row = await get(`SELECT ultima_refresh_pedido, next_auto_sync FROM openfinance_items WHERE item_id = $1`, [itemId]);
  const ultimo = row && row.ultima_refresh_pedido ? new Date(row.ultima_refresh_pedido).getTime() : 0;
  if (!forcar && ultimo && (Date.now() - ultimo) < REFRESH_COOLDOWN_MS) {
    return { skipped: true, motivo: 'cooldown', proximoEmMin: Math.ceil((REFRESH_COOLDOWN_MS - (Date.now() - ultimo)) / 60000) };
  }
  try {
    const resp = await axios.patch(
      `${PLUGGY_BASE}/items/${itemId}`,
      {},
      { headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' }, timeout: 30000 }
    );
    await run(
      `UPDATE openfinance_items SET ultima_refresh_pedido = CURRENT_TIMESTAMP, ultimo_status = $1 WHERE item_id = $2`,
      [resp.data?.status || 'UPDATING', itemId]
    );
    return { ok: true, status: resp.data?.status, executionStatus: resp.data?.executionStatus };
  } catch (e) {
    const msg = e.response?.data?.message || e.message || '';
    const code = e.response?.data?.code || e.response?.status;
    // Já atualizando / cooldown do lado Pluggy — não é erro fatal
    if (/ALREADY_UPDATING|BEFORE_ALLOWED_FREQUENCY|CLIENT_IS_UPDATING/i.test(String(code) + msg)) {
      return { skipped: true, motivo: msg || String(code) };
    }
    // MFA / credenciais — precisa widget
    if (/LOGIN_ERROR|INVALID_CREDENTIALS|PARAMETERS|MFA|USER_INPUT/i.test(String(code) + msg)) {
      return { precisaUsuario: true, motivo: msg || String(code) };
    }
    // MeuPluggy (demo) não aceita update
    if (/meuplugy|meu.?pluggy|cant be updated/i.test(String(msg))) {
      return { skipped: true, demo: true, motivo: 'MeuPluggy (demo) não atualiza saldo' };
    }
    throw e;
  }
}

async function esperarItemAtualizado(apiKey, itemId, { timeoutMs = 45000 } = {}) {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    const resp = await axios.get(`${PLUGGY_BASE}/items/${itemId}`, {
      headers: { 'X-API-KEY': apiKey },
      timeout: 15000
    });
    const st = resp.data?.status;
    const ex = resp.data?.executionStatus;
    await run(
      `UPDATE openfinance_items SET ultimo_status = $1, next_auto_sync = $2 WHERE item_id = $3`,
      [st || null, resp.data?.nextAutoSyncAt || null, itemId]
    );
    if (st === 'UPDATED' || ex === 'SUCCESS' || st === 'LOGIN_ERROR' || st === 'OUTDATED') {
      return { status: st, executionStatus: ex };
    }
    if (st === 'WAITING_USER_INPUT') {
      return { status: st, precisaUsuario: true };
    }
    await new Promise(r => setTimeout(r, 2500));
  }
  return { timeout: true };
}

async function syncItem(apiKey, itemId, opts = {}) {
  let importadas = 0, ignoradas = 0;
  let refreshInfo = null;

  if (opts.refresh) {
    try {
      refreshInfo = await pedirUpdateItem(apiKey, itemId, { forcar: !!opts.forcar });
      if (refreshInfo.ok) {
        await esperarItemAtualizado(apiKey, itemId, { timeoutMs: opts.waitMs || 40000 });
      }
    } catch (e) {
      refreshInfo = { erro: e.message };
    }
  }

  // Pega metadata do item pra saber se tem auto-sync (produção Pluggy) ou é Meu Pluggy
  try {
    const itemResp = await axios.get(`${PLUGGY_BASE}/items/${itemId}`, { headers: { 'X-API-KEY': apiKey } });
    const nextAuto = itemResp.data && itemResp.data.nextAutoSyncAt;
    await run(
      `UPDATE openfinance_items SET next_auto_sync = $1, ultimo_status = $2 WHERE item_id = $3`,
      [nextAuto || null, itemResp.data?.status || null, itemId]
    );
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

  // Guarda o saldo REAL de cada conta
  for (const conta of contas) {
    try {
      await upsertConta(conta, itemId);
      // Tenta sobrescrever com balance realtime (mais fresco)
      try { await refreshSaldoConta(apiKey, conta.id, { tipo: conta.type }); } catch (e) { /* ok */ }
    } catch (e) { /* não bloqueia o sync por causa de saldo */ }
  }

  // Janela: últimos 90 dias
  const fromStr = addDias(-90);

  for (const conta of contas) {
    let url = `${PLUGGY_BASE}/v2/transactions`;
    let params = { accountId: conta.id };
    let guard = 0;
    let parar = false;
    while (url && guard < 200 && !parar) {
      guard++;
      const txResp = await axios.get(url, { headers: { 'X-API-KEY': apiKey }, params });
      const results = txResp.data.results || [];

      for (const t of results) {
        const dataUso = (t.date || '').split('T')[0] || hojeStr();
        if (dataUso < fromStr) { parar = true; continue; }
        const ehCartao = conta.type === 'CREDIT';
        const tipo = ehCartao
          ? (Number(t.amount) > 0 ? 'saida' : 'entrada')
          : ((t.type === 'CREDIT' || Number(t.amount) > 0) ? 'entrada' : 'saida');
        const valor = Math.abs(Number(t.amount) || 0);
        if (valor === 0) { ignoradas++; continue; }
        const extId = `pluggy:${t.id}`;
        const chave = chaveCategoria(t);
        const regra = regras[chave];
        const obvia = categoriaObvia(t.description || '');
        const categoria = regra || obvia || mapCategoria(t.category);
        const confirmada = !!(regra || obvia);
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
      url = parar ? null : (txResp.data.next || null);
      params = undefined;
    }
  }

  await run(`UPDATE openfinance_items SET ultima_sync = CURRENT_TIMESTAMP WHERE item_id = $1`, [itemId]);
  return { importadas, ignoradas, refresh: refreshInfo };
}

// Lógica reutilizável (usada pela rota e pelo agendador automático)
async function syncAll(itemId, opts = {}) {
  const apiKey = await getApiKey();
  const items = itemId
    ? [{ item_id: itemId }]
    : await all(`SELECT item_id FROM openfinance_items WHERE status = 'ativo'`);
  if (items.length === 0) return { semItems: true, importadas: 0, ignoradas: 0 };

  let importadas = 0, ignoradas = 0;
  const refreshes = [];
  for (const it of items) {
    const r = await syncItem(apiKey, it.item_id, opts);
    importadas += r.importadas;
    ignoradas += r.ignoradas;
    if (r.refresh) refreshes.push({ item_id: it.item_id, ...r.refresh });
  }
  if (importadas > 0) emitUpdate('sync', { importadas });
  // Sempre emite saldos após sync
  emitUpdate('saldos', { ok: true });
  return { importadas, ignoradas, refreshes };
}

router.post('/sync', async (req, res) => {
  try {
    const refresh = !!(req.body && req.body.refresh);
    const r = await syncAll(req.body && req.body.itemId, { refresh, forcar: !!(req.body && req.body.forcar) });
    if (r.semItems) return res.status(400).json({ erro: 'Nenhum banco conectado. Conecte um banco primeiro.' });
    // Após sync, puxa saldo realtime de novo
    let saldos = null;
    try { saldos = await refreshSaldosAll(); } catch (e) { /* best-effort */ }
    res.json({
      ok: true,
      importadas: r.importadas,
      ignoradas: r.ignoradas,
      refreshes: r.refreshes || [],
      saldos
    });
  } catch (err) {
    if (err.code === 'PLUGGY_NAO_CONFIGURADO') {
      return res.status(400).json({ erro: 'Open Finance não configurado. Adicione PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET no .env.' });
    }
    res.status(500).json({ erro: err.response?.data?.message || err.message });
  }
});

// Atualiza só saldos (rápido) — usa GET /accounts/{id}/balance
router.post('/refresh-saldos', async (req, res) => {
  try {
    const pedirUpdate = !!(req.body && req.body.pedirUpdate);
    const apiKey = await getApiKey();
    const updates = [];
    if (pedirUpdate) {
      const items = await all(`SELECT item_id FROM openfinance_items WHERE status = 'ativo'`);
      for (const it of items) {
        try {
          updates.push({ item_id: it.item_id, ...(await pedirUpdateItem(apiKey, it.item_id)) });
        } catch (e) {
          updates.push({ item_id: it.item_id, erro: e.message });
        }
      }
      // Se pediu update, espera um pouco e sincroniza contas
      const algumOk = updates.some(u => u.ok);
      if (algumOk) {
        await new Promise(r => setTimeout(r, 8000));
        await syncAll(null, { refresh: false });
      }
    }
    const saldos = await refreshSaldosAll();
    // Reusa o mesmo shape do GET /saldos
    const contas = await all(`
      SELECT a.account_id, a.item_id, a.tipo, a.nome, a.saldo, a.saldo_em, a.atualizado_em,
             COALESCE(i.pessoa, 'PF') AS pessoa,
             COALESCE(i.apelido, i.connector_nome, '') AS banco
      FROM openfinance_accounts a
      LEFT JOIN openfinance_items i ON i.item_id = a.item_id
      ORDER BY COALESCE(i.pessoa, 'PF'), a.tipo, a.nome
    `);
    const porPessoa = { PF: { totalBanco: 0, totalCredito: 0 }, PJ: { totalBanco: 0, totalCredito: 0 } };
    let totalBanco = 0, totalCredito = 0;
    contas.forEach(c => {
      const v = Number(c.saldo) || 0;
      const p = c.pessoa === 'PJ' ? 'PJ' : 'PF';
      if (c.tipo === 'CREDIT') { totalCredito += Math.abs(v); porPessoa[p].totalCredito += Math.abs(v); }
      else if (c.tipo === 'BANK' || !c.tipo) { totalBanco += v; porPessoa[p].totalBanco += v; }
    });
    porPessoa.PF.saldoLiquido = porPessoa.PF.totalBanco - porPessoa.PF.totalCredito;
    porPessoa.PJ.saldoLiquido = porPessoa.PJ.totalBanco - porPessoa.PJ.totalCredito;
    const temPfBanco = contas.some(c => c.pessoa !== 'PJ' && c.tipo !== 'CREDIT');
    const emConta = temPfBanco ? porPessoa.PF.totalBanco : totalBanco;
    res.json({
      ok: true,
      updates,
      refresh: saldos,
      totalBanco,
      totalCredito,
      saldoLiquido: totalBanco - totalCredito,
      emConta,
      porPessoa,
      contas,
      atualizadoEm: new Date().toISOString(),
      demoMeuPluggy: !!(saldos && saldos.demoMeuPluggy)
    });
  } catch (err) {
    if (err.code === 'PLUGGY_NAO_CONFIGURADO') {
      return res.status(400).json({ erro: 'Open Finance não configurado.' });
    }
    res.status(500).json({ erro: err.response?.data?.message || err.message });
  }
});

// Exposto pro agendador (server.js)
router.syncAll = function (itemId, opts) {
  return syncAll(itemId, opts).catch(e => ({ erro: e.message }));
};
router.refreshSaldosAll = function (opts) {
  return refreshSaldosAll(opts).catch(e => ({ erro: e.message }));
};
router.temCredenciais = temCredenciais;

/** Webhook Pluggy (público) — quando o banco termina de atualizar, puxa saldos/txs */
async function handlePluggyWebhook(req, res) {
  try {
    const secret = process.env.PLUGGY_WEBHOOK_SECRET;
    if (secret) {
      const got = req.get('X-Pluggy-Secret') || req.get('x-webhook-secret') || req.query.secret;
      if (got !== secret) return res.status(401).json({ erro: 'secret inválido' });
    }
    const event = req.body || {};
    const tipo = event.event || event.type || '';
    const itemId = event.itemId || event.data?.itemId || event.id;
    console.log('[pluggy-webhook]', tipo, itemId || '');
    if (/item\/updated|item\/created|item\/waiting|ITEM_UPDATED/i.test(tipo) && itemId) {
      // Fire-and-forget pra responder 200 rápido
      setImmediate(async () => {
        try {
          await syncAll(itemId, { refresh: false });
          await refreshSaldosAll();
        } catch (e) {
          console.error('[pluggy-webhook] sync falhou:', e.message);
        }
      });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
}
router.handlePluggyWebhook = handlePluggyWebhook;

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
