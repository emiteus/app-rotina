const express = require('express');
const axios = require('axios');
const { v4: uuid } = require('uuid');
const { all, run, get } = require('../lib/db');
const { checkinHabito, listarHabitos, analisarConsistencia } = require('../lib/habitos');
const { hojeStr, ymAtual, addDias, dataResetSql, horaAtual, diaSemana } = require('../lib/datas');
const { persistirHistoricoDia } = require('../lib/historico');
const plano = require('../lib/plano-financeiro');

const router = express.Router();

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';

// Flash primeiro; se estiver saturado, cai no Lite (mais folga no free tier).
const GEMINI_MODELS = [
  'gemini-3.5-flash',
  'gemini-flash-latest',
  'gemini-2.5-flash',
  'gemini-flash-lite-latest'
];
const GEMINI_MODEL = GEMINI_MODELS[0];

function geminiUrl(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

function providerAtivo() {
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return null;
}

function mensagemGemini(err) {
  const raw = err.response?.data?.error?.message || err.message || '';
  const status = err.response?.status;
  const saturado = status === 429 || status === 503 || /high demand|overloaded|unavailable|resource.?exhausted/i.test(raw);
  if (saturado) return 'O Gemini está saturado agora. Tenta de novo em alguns segundos.';
  return raw || 'Falha ao falar com a IA.';
}

function modeloSaturado(err) {
  const raw = err.response?.data?.error?.message || err.message || '';
  const status = err.response?.status;
  return status === 404 || status === 429 || status === 503
    || /high demand|overloaded|unavailable|resource.?exhausted|no longer available|not found/i.test(raw);
}

function montarHistorico(historico, user) {
  const msgs = [];
  if (Array.isArray(historico)) {
    for (const m of historico.slice(-10)) {
      const role = m.role === 'assistant' ? 'assistant' : 'user';
      const content = String(m.content || '').trim();
      if (!content) continue;
      msgs.push({ role, content: content.slice(0, 4000) });
    }
  }
  msgs.push({ role: 'user', content: String(user || '') });
  return msgs;
}

async function chamarGemini({ body, timeout, models = GEMINI_MODELS }) {
  let ultimo = null;
  for (const model of models) {
    try {
      const resp = await axios.post(
        `${geminiUrl(model)}?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`,
        body,
        { headers: { 'content-type': 'application/json' }, timeout }
      );
      const texto = (resp.data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
      return { texto, usage: resp.data?.usageMetadata, provider: 'gemini', model };
    } catch (err) {
      ultimo = err;
      if (modeloSaturado(err)) continue;
      throw err;
    }
  }
  throw ultimo;
}

// Helper único: chama Gemini (grátis) ou Anthropic (fallback) e devolve
// { texto: string, usage: object }. jsonMode=true força resposta em JSON.
async function chamarIA({ system, user, historico, maxTokens = 300, jsonMode = false, timeout = 20000 }) {
  const prov = providerAtivo();
  if (!prov) throw new Error('Nenhuma API key configurada (GEMINI_API_KEY ou ANTHROPIC_API_KEY).');
  const msgs = montarHistorico(historico, user);

  if (prov === 'gemini') {
    const contents = msgs.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: maxTokens,
        ...(jsonMode ? { responseMimeType: 'application/json' } : {})
      }
    };
    return chamarGemini({ body, timeout });
  }

  // Anthropic (fallback)
  const resp = await axios.post(
    ANTHROPIC_URL,
    {
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      system,
      messages: msgs.map(m => ({ role: m.role, content: m.content }))
    },
    {
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      timeout
    }
  );
  const texto = (resp.data?.content?.[0]?.text || '').trim();
  return { texto, usage: resp.data?.usage, provider: 'anthropic', model: ANTHROPIC_MODEL };
}

// Parse JSON tolerante (aceita ```json ... ``` e JSON truncado com "resposta")
function limparJsonIA(txt) {
  return String(txt || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/g, '')
    .trim();
}

function extrairCampoResposta(s) {
  const m = s.match(/"resposta"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (m) {
    try { return JSON.parse(`"${m[1]}"`); } catch (e) { return m[1]; }
  }
  // Truncado no meio: {"resposta": "texto cortado...
  const parcial = s.match(/"resposta"\s*:\s*"((?:\\.|[^"\\])*)/);
  if (parcial) {
    return parcial[1]
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .trim();
  }
  return null;
}

function extrairCampoAcoes(s) {
  const m = String(s || '').match(/"acoes"\s*:\s*(\[[\s\S]*?\])\s*(?:,|\})/);
  if (!m) return null;
  try {
    const arr = JSON.parse(m[1]);
    return Array.isArray(arr) ? arr : null;
  } catch (e) {
    return null;
  }
}

function parseJSON(txt) {
  const s = limparJsonIA(txt);
  try {
    return JSON.parse(s);
  } catch (e1) {
    // Tenta reparar JSON comum (vírgula trailing)
    try {
      const repaired = s.replace(/,\s*([}\]])/g, '$1');
      return JSON.parse(repaired);
    } catch (e2) { /* segue */ }
    const resposta = extrairCampoResposta(s);
    const acoes = extrairCampoAcoes(s) || [];
    if (resposta) return { resposta, acoes };
    throw e1;
  }
}

function textoAssistenteSeguro(textoBruto, parsed) {
  if (parsed && parsed.resposta != null) {
    const r = String(parsed.resposta).trim();
    if (r && !/^\s*\{/.test(r)) return r;
  }
  const s = limparJsonIA(textoBruto);
  const extraido = extrairCampoResposta(s);
  if (extraido) return extraido;
  if (s && !/^\s*\{/.test(s)) return s;
  return 'Beleza — me conta mais um detalhe pra eu agir.';
}

/** Nunca deixa a IA afirmar que alterou o app se a ação não rodou de verdade. */
function reconciliarRespostaComAcoes(resposta, acoesExec) {
  const oks = (acoesExec || []).filter(a => a && a.ok);
  const fails = (acoesExec || []).filter(a => a && a.ok === false);
  const finOk = oks.filter(a =>
    a.tipo === 'recategorizar' || a.tipo === 'criar_categoria' || a.tipo === 'renomear_categoria'
  );
  const claim = /criei|movi|categorizei|recategoriz|organizei|prontinho|renomeei|renomear|ajustei|já (está|esta|ficou)|alterei|atualizei/i.test(String(resposta || ''));

  if (finOk.length) {
    const partes = [];
    for (const a of finOk) {
      if (a.tipo === 'criar_categoria') {
        partes.push(a.criada
          ? `Criei a categoria **${a.label || a.categoria}**.`
          : `Categoria **${a.label || a.categoria}** ok.`);
      } else if (a.tipo === 'recategorizar') {
        partes.push(`Movi **${a.qtd || 0}** transações pra **${a.label || a.categoria}**.`);
      } else if (a.tipo === 'renomear_categoria') {
        partes.push(`Renomeei pra **${a.label || a.categoria}**.`);
      }
    }
    return partes.join(' ');
  }

  if (claim) {
    const err = fails.map(f => f.erro).filter(Boolean)[0];
    if (err) {
      return `Tentei alterar, mas não consegui: ${err}.`;
    }
    return 'Ainda **não alterei** nada — a ação não chegou a rodar. Pode repetir o pedido?';
  }

  return resposta;
}

router.get('/status', (req, res) => {
  const prov = providerAtivo();
  res.json({
    ok: true,
    disponivel: !!prov,
    provider: prov,
    model: prov === 'gemini' ? GEMINI_MODEL : (prov === 'anthropic' ? ANTHROPIC_MODEL : null)
  });
});

// Debug: lista modelos disponíveis no projeto Gemini
router.get('/gemini-models', async (req, res) => {
  if (!process.env.GEMINI_API_KEY) return res.status(400).json({ erro: 'GEMINI_API_KEY não configurada' });
  try {
    const resp = await axios.get(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, { timeout: 10000 });
    const nomes = (resp.data?.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => ({ nome: m.name, versao: m.version, displayName: m.displayName }));
    res.json({ total: nomes.length, modelos: nomes });
  } catch (e) {
    res.status(500).json({ erro: e.response?.data?.error?.message || e.message });
  }
});

// POST /api/ia/categorizar
router.post('/categorizar', async (req, res) => {
  if (!providerAtivo()) return res.status(400).json({ erro: 'IA não configurada.' });
  const desc = String(req.body?.descricao || '').trim();
  if (!desc) return res.status(400).json({ erro: 'descricao é obrigatória' });

  try {
    const cats = await all(`SELECT chave, label FROM categorias ORDER BY label`);
    if (cats.length === 0) return res.status(400).json({ erro: 'Nenhuma categoria cadastrada.' });

    const listaCategorias = cats.map(c => `- ${c.chave}: ${c.label}`).join('\n');
    const contexto = [
      `Descrição do usuário: "${desc}"`,
      req.body?.exemplo ? `Descrição bruta do banco: "${req.body.exemplo}"` : null,
      req.body?.valor != null ? `Valor: R$ ${Number(req.body.valor).toFixed(2).replace('.', ',')}` : null,
      req.body?.tipo ? `Tipo: ${req.body.tipo}` : null,
      req.body?.banco ? `Banco: ${req.body.banco}` : null
    ].filter(Boolean).join('\n');

    const systemPrompt = `Você é um classificador de transações financeiras pessoais em português brasileiro. Escolha EXATAMENTE UMA categoria da lista fornecida com base na descrição.

Categorias disponíveis (use o valor da esquerda como "categoria"):
${listaCategorias}

Regras:
- Responda APENAS com JSON válido, sem markdown, sem texto extra.
- Campo "categoria": um dos ids da lista acima.
- Campo "confianca": inteiro 0-100.
- Campo "motivo": explicação curta em 1 linha (máx 80 chars), em português.

Formato: {"categoria":"id","confianca":85,"motivo":"..."}`;

    const { texto, usage, provider } = await chamarIA({
      system: systemPrompt, user: contexto, maxTokens: 200, jsonMode: true
    });

    let parsed;
    try { parsed = parseJSON(texto); }
    catch (e) { return res.status(502).json({ erro: 'Resposta da IA em formato inválido', raw: texto }); }

    const catExiste = cats.find(c => c.chave === parsed.categoria);
    if (!catExiste) return res.status(502).json({ erro: `Categoria "${parsed.categoria}" não existe`, raw: texto });

    res.json({
      categoria: parsed.categoria,
      label: catExiste.label,
      confianca: Math.max(0, Math.min(100, Number(parsed.confianca) || 0)),
      motivo: String(parsed.motivo || '').slice(0, 120),
      provider, usage
    });
  } catch (err) {
    res.status(err.response?.status || 500).json({
      erro: err.response?.data?.error?.message || err.message
    });
  }
});

// POST /api/ia/metas/parse
router.post('/metas/parse', async (req, res) => {
  if (!providerAtivo()) return res.status(400).json({ erro: 'IA não configurada.' });
  const texto = String(req.body?.texto || '').trim();
  if (!texto) return res.status(400).json({ erro: 'texto é obrigatório' });

  const hoje = hojeStr();
  const systemPrompt = `Você extrai dados estruturados de descrições de metas financeiras pessoais em português brasileiro. Hoje é ${hoje}.

Regras estritas:
- Responda APENAS com JSON válido, sem markdown, sem texto extra.
- Formato: {"nome":"...","valor_total":123.45,"prazo":"YYYY-MM-DD"|null,"prioridade":1-5,"motivo":"..."}

Campos:
- "nome": título curto (3-40 chars). Ex: "Cadeira gamer", "Viagem pra Europa".
- "valor_total": número positivo em reais (R$ 1.500 → 1500). Se não mencionado, null.
- "prazo": data ISO YYYY-MM-DD. Datas relativas ("em 6 meses", "até dezembro") calcule a partir de hoje. Se não mencionar, null.
- "prioridade": 1 (baixa) a 5 (alta). "urgente" → 5. "quando puder" → 2. Default 3.
- "motivo": frase curta em pt (máx 80 chars).

Exemplos:
"quero cadeira gamer de 2500 até dezembro" → {"nome":"Cadeira gamer","valor_total":2500,"prazo":"2026-12-31","prioridade":3,"motivo":"prazo dezembro assumido como último dia"}
"juntar 10 mil pra viagem" → {"nome":"Viagem","valor_total":10000,"prazo":null,"prioridade":3,"motivo":"sem prazo mencionado"}
"reserva de emergencia urgente 5000" → {"nome":"Reserva de emergência","valor_total":5000,"prazo":null,"prioridade":5,"motivo":"marcado urgente"}`;

  try {
    const { texto: raw, usage, provider } = await chamarIA({
      system: systemPrompt, user: texto, maxTokens: 300, jsonMode: true
    });

    let parsed;
    try { parsed = parseJSON(raw); }
    catch (e) { return res.status(502).json({ erro: 'Resposta da IA em formato inválido', raw }); }

    const nome = String(parsed.nome || '').trim();
    if (!nome || nome.length < 2) return res.status(502).json({ erro: 'IA não conseguiu extrair um nome válido', raw });

    const valor = parsed.valor_total;
    if (valor !== null && (typeof valor !== 'number' || !isFinite(valor) || valor <= 0)) {
      return res.status(502).json({ erro: 'IA não extraiu um valor válido', raw });
    }

    let prazo = parsed.prazo;
    if (prazo && !/^\d{4}-\d{2}-\d{2}$/.test(prazo)) prazo = null;

    const prioridade = Math.max(1, Math.min(5, parseInt(parsed.prioridade, 10) || 3));

    res.json({
      nome: nome.slice(0, 40),
      valor_total: valor,
      prazo: prazo || null,
      prioridade,
      motivo: String(parsed.motivo || '').slice(0, 120),
      provider, usage
    });
  } catch (err) {
    res.status(err.response?.status || 500).json({
      erro: err.response?.data?.error?.message || err.message
    });
  }
});

// POST /api/ia/analise/diaria
router.post('/analise/diaria', async (req, res) => {
  if (!providerAtivo()) return res.status(400).json({ erro: 'IA não configurada.' });

  try {
    const hoje = hojeStr();
    const ontem = addDias(-1);
    const inicio30 = addDias(-30);

    const tarefasHoje = await all(
      `SELECT COUNT(*)::int AS total, SUM(CASE WHEN concluida THEN 1 ELSE 0 END)::int AS concluidas
       FROM tasks WHERE data_reset::date = $1`,
      [hoje]
    );

    const finHoje = await all(
      `SELECT tipo, categoria, valor, descricao
       FROM financeiro WHERE data::date = $1
       ORDER BY valor DESC LIMIT 20`,
      [hoje]
    );

    const finMedia = await all(
      `SELECT
         COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END),0) AS entradas30,
         COALESCE(SUM(CASE WHEN tipo='saida' THEN valor ELSE 0 END),0) AS saidas30,
         COUNT(*)::int AS n
       FROM financeiro
       WHERE data::date BETWEEN $1 AND $2 AND data::date < $3`,
      [inicio30, ontem, hoje]
    );

    const t = tarefasHoje[0] || { total: 0, concluidas: 0 };
    const m = finMedia[0] || { entradas30: 0, saidas30: 0, n: 0 };
    const gastosHoje = finHoje.filter(f => f.tipo === 'saida').reduce((s, f) => s + Number(f.valor), 0);
    const entradasHoje = finHoje.filter(f => f.tipo === 'entrada').reduce((s, f) => s + Number(f.valor), 0);
    const gastoMedioDia = Number(m.saidas30) / 30;

    const contexto = {
      data: hoje,
      tarefas: { total: t.total, concluidas: t.concluidas, taxa: t.total > 0 ? Math.round((t.concluidas / t.total) * 100) : 0 },
      financeiro_hoje: {
        entradas: entradasHoje,
        saidas: gastosHoje,
        saldo: entradasHoje - gastosHoje,
        transacoes: finHoje.slice(0, 10).map(f => ({
          desc: (f.descricao || '').slice(0, 40),
          valor: Number(f.valor),
          tipo: f.tipo,
          categoria: f.categoria
        }))
      },
      media_30d: {
        gasto_medio_dia: Math.round(gastoMedioDia * 100) / 100,
        diferenca_hoje_vs_media: gastosHoje - gastoMedioDia
      }
    };

    const systemPrompt = `Você é um assistente pessoal do usuário — informal, direto, tipo um amigo que dá insights sobre o dia dele. Responda em português brasileiro conversacional (usa "vc" ou "você"). Estrutura:

1. Frase de abertura curta comentando o dia (produtividade + finanças em 1-2 linhas)
2. Um insight ou padrão notável nos dados
3. Uma sugestão prática pra amanhã ou agora

Regras:
- Total máximo 3 parágrafos curtos, ~200 palavras.
- Não invente dados que não estão no JSON.
- Se o dia teve pouca atividade, seja breve e sugira algo pra começar.
- Use emojis só se fizerem sentido (1-2 no total).
- Não repita números óbvios do dashboard — dê análise, não descrição.`;

    const { texto, usage, provider } = await chamarIA({
      system: systemPrompt, user: JSON.stringify(contexto), maxTokens: 500, jsonMode: false
    });

    res.json({ analise: texto, contexto, provider, usage });
  } catch (err) {
    res.status(err.response?.status || 500).json({
      erro: err.response?.data?.error?.message || err.message
    });
  }
});

function brlNum(v) {
  return Math.round(Number(v || 0) * 100) / 100;
}

function mapTarefa(t) {
  return {
    titulo: t.titulo,
    concluida: !!t.concluida,
    prioridade: t.prioridade || 'media',
    hora: t.hora || null,
    concluida_em: t.concluida_em || null,
    categoria: t.categoria || null,
    data: t.data_reset ? String(t.data_reset).slice(0, 10) : null
  };
}

async function snapshotAssistente() {
  const hoje = hojeStr();
  const ym = ymAtual();
  const ontem = addDias(-1);
  const amanha = addDias(1);
  const inicio7 = addDias(-7);
  const inicio30 = addDias(-30);
  const fim14 = addDias(14);
  const diasSemana = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

  const [
    tarefasHoje,
    tarefasOntem,
    tarefasAmanha,
    tarefasProx,
    tarefasAtrasadas,
    stats7,
    stats30,
    fin7,
    fin30,
    finMes,
    txsRecentes,
    categoriasLista,
    gastosCat,
    despesas,
    metas,
    alarmes,
    habitosLista,
    recorrentes,
    eventos,
    historico,
    saldos,
    dasLista,
    consistencia
  ] = await Promise.all([
    all(
      `SELECT titulo, concluida, prioridade, hora, concluida_em, categoria, data_reset
       FROM tasks WHERE data_reset::date = $1
       ORDER BY concluida, prioridade, hora NULLS LAST LIMIT 50`,
      [hoje]
    ).catch(() => []),
    all(
      `SELECT titulo, concluida, prioridade, hora, concluida_em, categoria
       FROM tasks WHERE data_reset::date = $1
       ORDER BY concluida, prioridade LIMIT 30`,
      [ontem]
    ).catch(() => []),
    all(
      `SELECT titulo, concluida, prioridade, hora, categoria
       FROM tasks WHERE data_reset::date = $1
       ORDER BY prioridade, hora NULLS LAST LIMIT 30`,
      [amanha]
    ).catch(() => []),
    all(
      `SELECT titulo, concluida, prioridade, hora, categoria, data_reset
       FROM tasks
       WHERE data_reset::date > $1::date AND data_reset::date <= $2::date
       ORDER BY data_reset, prioridade LIMIT 40`,
      [hoje, fim14]
    ).catch(() => []),
    all(
      `SELECT titulo, prioridade, hora, data_reset
       FROM tasks
       WHERE concluida = false
         AND data_reset IS NOT NULL
         AND data_reset::date < $1::date
       ORDER BY data_reset DESC LIMIT 20`,
      [hoje]
    ).catch(() => []),
    get(
      `SELECT COUNT(*)::int AS total,
              SUM(CASE WHEN concluida THEN 1 ELSE 0 END)::int AS concluidas
       FROM tasks
       WHERE data_reset IS NOT NULL AND DATE(data_reset) >= $1::date`,
      [inicio7]
    ).catch(() => ({ total: 0, concluidas: 0 })),
    get(
      `SELECT COUNT(*)::int AS total,
              SUM(CASE WHEN concluida THEN 1 ELSE 0 END)::int AS concluidas
       FROM tasks
       WHERE data_reset IS NOT NULL AND DATE(data_reset) >= $1::date`,
      [inicio30]
    ).catch(() => ({ total: 0, concluidas: 0 })),
    get(
      `SELECT
         COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END),0) AS entradas,
         COALESCE(SUM(CASE WHEN tipo='saida' THEN valor ELSE 0 END),0) AS saidas
       FROM financeiro WHERE data::date >= $1::date`,
      [inicio7]
    ).catch(() => ({ entradas: 0, saidas: 0 })),
    get(
      `SELECT
         COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END),0) AS entradas,
         COALESCE(SUM(CASE WHEN tipo='saida' THEN valor ELSE 0 END),0) AS saidas
       FROM financeiro WHERE data::date >= $1::date`,
      [inicio30]
    ).catch(() => ({ entradas: 0, saidas: 0 })),
    get(
      `SELECT
         COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END),0) AS entradas,
         COALESCE(SUM(CASE WHEN tipo='saida' THEN valor ELSE 0 END),0) AS saidas
       FROM financeiro WHERE TO_CHAR(data, 'YYYY-MM') = $1`,
      [ym]
    ).catch(() => ({ entradas: 0, saidas: 0 })),
    all(
      `SELECT id, descricao, valor, tipo, categoria, data, fonte, chave_categoria
       FROM financeiro
       ORDER BY data DESC
       LIMIT 40`
    ).catch(() => []),
    all(`SELECT chave, label FROM categorias ORDER BY label LIMIT 80`).catch(() => []),
    all(
      `SELECT COALESCE(NULLIF(categoria,''),'outros') AS categoria,
              SUM(valor)::float AS total, COUNT(*)::int AS qtd
       FROM financeiro
       WHERE tipo = 'saida' AND data::date >= $1::date
       GROUP BY 1 ORDER BY total DESC LIMIT 12`,
      [inicio30]
    ).catch(() => []),
    all(
      `SELECT titulo, valor_esperado, dia_vencimento, categoria, status, pago_em, confirmado_por
       FROM despesas_mes WHERE ym = $1
       ORDER BY CASE status WHEN 'atrasado' THEN 0 WHEN 'pendente' THEN 1 WHEN 'pago' THEN 2 ELSE 3 END,
                dia_vencimento NULLS LAST
       LIMIT 60`,
      [ym]
    ).catch(() => []),
    all(
      `SELECT m.nome, m.valor_total, m.prazo, m.concluida,
              COALESCE((SELECT SUM(valor) FROM metas_depositos d WHERE d.meta_id = m.id),0) AS guardado
       FROM metas m
       ORDER BY m.concluida ASC, m.prazo NULLS LAST
       LIMIT 20`
    ).catch(() => []),
    all(`SELECT hora, mensagem, ativo FROM alarmes ORDER BY ativo DESC, hora LIMIT 20`).catch(() => []),
    listarHabitos().catch(() => ({ habitos: [] })),
    all(
      `SELECT titulo, prioridade, categoria, frequencia, dias_semana, ativa
       FROM tarefas_recorrentes WHERE ativa = true
       ORDER BY titulo LIMIT 30`
    ).catch(() => []),
    all(
      `SELECT titulo, tipo, data, hora, cor
       FROM eventos
       WHERE data::date >= $1::date AND data::date <= $2::date
       ORDER BY data, hora NULLS LAST
       LIMIT 25`,
      [hoje, fim14]
    ).catch(() => []),
    all(
      `SELECT data, total, concluidas
       FROM task_historico
       WHERE data::date >= $1::date
       ORDER BY data DESC LIMIT 21`,
      [inicio30]
    ).catch(() => []),
    all(
      `SELECT a.nome, a.tipo, a.saldo, i.pessoa, i.connector_nome
       FROM openfinance_accounts a
       JOIN openfinance_items i ON i.item_id = a.item_id
       ORDER BY i.pessoa, a.tipo, a.nome
       LIMIT 20`
    ).catch(() => []),
    all(
      `SELECT ym, valor, pago, data_pagamento
       FROM mei_das
       ORDER BY ym DESC
       LIMIT 6`
    ).catch(() => []),
    analisarConsistencia(30).catch(() => null)
  ]);

  const tHoje = tarefasHoje || [];
  const st7 = stats7 || { total: 0, concluidas: 0 };
  const st30 = stats30 || { total: 0, concluidas: 0 };
  const f7 = fin7 || { entradas: 0, saidas: 0 };
  const f30 = fin30 || { entradas: 0, saidas: 0 };
  const fMes = finMes || { entradas: 0, saidas: 0 };
  const desp = despesas || [];

  const resumoDesp = desp.reduce((acc, d) => {
    if ((d.categoria || '') === 'faturas') return acc;
    const v = brlNum(d.valor_esperado);
    acc.esperado += v;
    if (d.status === 'pago') acc.pago += v;
    else if (d.status === 'atrasado') acc.atrasado += v;
    else if (d.status !== 'ignorado') acc.pendente += v;
    return acc;
  }, { esperado: 0, pago: 0, pendente: 0, atrasado: 0 });

  const taxa = (c, t) => (t > 0 ? Math.round((c / t) * 100) : 0);
  let streak = 0;
  for (const h of (historico || [])) {
    const total = Number(h.total || 0);
    const conc = Number(h.concluidas || 0);
    if (total > 0 && conc >= total) streak++;
    else break;
  }

  const comprometido = brlNum(plano.comprometidoMensal());
  const rendaPiso = brlNum(plano.rendaPiso);

  return {
    agora: {
      hoje,
      hora: horaAtual(),
      dia_semana: diasSemana[diaSemana()] || '',
      mes: ym
    },
    tarefas: {
      hoje: {
        total: tHoje.length,
        concluidas: tHoje.filter(t => t.concluida).length,
        itens: tHoje.map(mapTarefa)
      },
      ontem: {
        total: (tarefasOntem || []).length,
        concluidas: (tarefasOntem || []).filter(t => t.concluida).length,
        pendentes: (tarefasOntem || []).filter(t => !t.concluida).map(t => t.titulo)
      },
      amanha: (tarefasAmanha || []).map(mapTarefa),
      proximos_dias: (tarefasProx || []).map(mapTarefa),
      atrasadas: (tarefasAtrasadas || []).map(t => ({
        titulo: t.titulo,
        data: String(t.data_reset).slice(0, 10),
        prioridade: t.prioridade
      })),
      stats_7d: { total: st7.total || 0, concluidas: st7.concluidas || 0, taxa: taxa(st7.concluidas, st7.total) },
      stats_30d: { total: st30.total || 0, concluidas: st30.concluidas || 0, taxa: taxa(st30.concluidas, st30.total) },
      streak_dias_completos: streak
    },
    recorrentes: (recorrentes || []).map(r => ({
      titulo: r.titulo,
      frequencia: r.frequencia,
      dias_semana: r.dias_semana,
      prioridade: r.prioridade
    })),
    financeiro: {
      d7: {
        entradas: brlNum(f7.entradas),
        saidas: brlNum(f7.saidas),
        sobra: brlNum(f7.entradas - f7.saidas)
      },
      d30: {
        entradas: brlNum(f30.entradas),
        saidas: brlNum(f30.saidas),
        sobra: brlNum(f30.entradas - f30.saidas),
        gastando_mais_que_ganha: Number(f30.saidas) > Number(f30.entradas)
      },
      mes_atual: {
        entradas: brlNum(fMes.entradas),
        saidas: brlNum(fMes.saidas),
        sobra: brlNum(fMes.entradas - fMes.saidas)
      },
      ultimas_transacoes: (txsRecentes || []).map(t => ({
        id: t.id,
        desc: String(t.descricao || '').slice(0, 80),
        valor: brlNum(t.valor),
        tipo: t.tipo,
        categoria: t.categoria || 'outros',
        data: t.data ? String(t.data).slice(0, 10) : null,
        fonte: t.fonte || null,
        chave: t.chave_categoria || null
      })),
      categorias: (categoriasLista || []).map(c => ({ chave: c.chave, label: c.label })),
      gastos_por_categoria_30d: (gastosCat || []).map(c => ({
        categoria: c.categoria,
        total: brlNum(c.total),
        qtd: c.qtd
      })),
      saldos_contas: (saldos || []).map(s => ({
        nome: s.nome,
        tipo: s.tipo,
        pessoa: s.pessoa,
        banco: s.connector_nome,
        saldo: brlNum(s.saldo)
      }))
    },
    despesas_mes: {
      resumo: {
        esperado: brlNum(resumoDesp.esperado),
        pago: brlNum(resumoDesp.pago),
        pendente: brlNum(resumoDesp.pendente),
        atrasado: brlNum(resumoDesp.atrasado)
      },
      itens: desp.map(d => ({
        titulo: d.titulo,
        valor: brlNum(d.valor_esperado),
        dia: d.dia_vencimento,
        status: d.status,
        categoria: d.categoria,
        pago_em: d.pago_em ? String(d.pago_em).slice(0, 10) : null
      }))
    },
    plano_financeiro: {
      renda_piso: rendaPiso,
      renda_fontes: (plano.rendaFixa || []).map(r => ({ nome: r.nome, valor: r.valor, dia: r.dia })),
      comprometido_mensal: comprometido,
      sobra_estimada_piso: brlNum(rendaPiso - comprometido),
      emprestimos: (plano.emprestimos || []).map(e => ({
        titulo: e.titulo,
        parcela: e.valor,
        dia: e.dia,
        pagas: e.pagas,
        total: e.total
      }))
    },
    metas: (metas || []).map(m => ({
      nome: m.nome,
      total: brlNum(m.valor_total),
      guardado: brlNum(m.guardado),
      falta: brlNum(Number(m.valor_total) - Number(m.guardado)),
      prazo: m.prazo,
      concluida: !!m.concluida
    })),
    alarmes: (alarmes || []).map(a => ({
      hora: a.hora,
      msg: a.mensagem,
      ativo: a.ativo !== false
    })),
    eventos_proximos: (eventos || []).map(e => ({
      titulo: e.titulo,
      tipo: e.tipo,
      data: e.data ? String(e.data).slice(0, 10) : null,
      hora: e.hora || null
    })),
    habitos: ((habitosLista && habitosLista.habitos) || []).map((h) => ({
      titulo: h.titulo,
      feito_hoje: !!(h.hoje && h.hoje.concluida),
      semana_concluidas: (h.semana && h.semana.concluidas) || 0,
      mes_concluidas: (h.mes && h.mes.concluidas) || 0
    })),
    consistencia_horario: consistencia || null,
    historico_tarefas_recentes: (historico || []).slice(0, 14).map(h => ({
      data: String(h.data).slice(0, 10),
      total: h.total,
      concluidas: h.concluidas
    })),
    mei_das: (dasLista || []).map(d => ({
      ym: d.ym,
      valor: d.valor != null ? brlNum(d.valor) : null,
      pago: !!d.pago,
      data_pagamento: d.data_pagamento ? String(d.data_pagamento).slice(0, 10) : null
    })),
    guia_periodos: {
      hoje,
      ontem,
      amanha,
      semana: 'habitos[].semana_concluidas e tarefas.stats_7d',
      mes: 'despesas_mes, financeiro.mes_atual, habitos[].mes_concluidas'
    }
  };
}

async function executarAcoes(acoes) {
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
    const existe = await get(`SELECT chave, label FROM categorias WHERE chave = $1`, [chave]);
    if (existe) return { chave: existe.chave, label: existe.label, criada: false };
    const lab = label || chave;
    await run(
      `INSERT INTO categorias (chave, label, criado_por_usuario) VALUES ($1,$2,true)
       ON CONFLICT (chave) DO NOTHING`,
      [chave, lab]
    );
    return { chave, label: lab, criada: true };
  }

  async function buscarTxsParaRecategorizar(acao) {
    const ids = Array.isArray(acao.ids) ? acao.ids.map(String).filter(Boolean).slice(0, 40) : [];
    if (ids.length) {
      return all(
        `SELECT id, descricao, valor, tipo, data, chave_categoria, categoria
         FROM financeiro WHERE id = ANY($1::text[])`,
        [ids]
      );
    }
    const f = acao.filtros || {};
    const W = [];
    const V = [];
    let p = 1;
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
    return all(
      `SELECT id, descricao, valor, tipo, data, chave_categoria, categoria
       FROM financeiro
       WHERE ${W.join(' AND ')}
       ORDER BY data DESC
       LIMIT 40`,
      V
    );
  }

  async function buscarTxsComFallback(acao) {
    let txs = await buscarTxsParaRecategorizar(acao);
    if (txs.length) return txs;
    const f = acao.filtros || {};
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
          `INSERT INTO despesas_mes (id, ym, titulo, valor_esperado, dia_vencimento, categoria, status, origem)
           VALUES ($1,$2,$3,$4,$5,$6,'pendente','manual')`,
          [id, acao.ym || ym, titulo, valor, Number.isFinite(dia) ? dia : null, acao.categoria || 'outros']
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
          `INSERT INTO tasks (id, titulo, descricao, prioridade, categoria, data_reset, hora)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [id, titulo, acao.descricao || '', acao.prioridade || 'media', acao.categoria || 'geral', dataReset, acao.hora || null]
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
          `INSERT INTO metas (nome, valor_total, prazo) VALUES ($1,$2,$3) RETURNING id`,
          [nome, valor, acao.prazo || null]
        );
        feitos.push({ tipo, ok: true, nome, valor, id: r && r.id });
      } else if (tipo === 'marcar_habito') {
        const titulo = String(acao.titulo || 'Academia').trim() || 'Academia';
        const r = await checkinHabito(titulo);
        persistirHistoricoDia(hojeStr()).catch(() => {});
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
        const txs = await buscarTxsComFallback(acao);
        if (!txs.length) {
          feitos.push({ tipo, ok: false, erro: 'nenhuma transação encontrada com esses filtros', categoria: cat.chave });
          continue;
        }
        const ids = txs.map(t => t.id);
        await run(
          `UPDATE financeiro
           SET categoria = $1, categoria_confirmada = true
           WHERE id = ANY($2::text[])`,
          [cat.chave, ids]
        );
        if (acao.aprender !== false) {
          for (const t of txs) {
            const chave = t.chave_categoria || normalizarChave(t.descricao).slice(0, 40);
            if (!chave) continue;
            await run(
              `INSERT INTO categoria_regras (chave, categoria, exemplo)
               VALUES ($1,$2,$3)
               ON CONFLICT (chave) DO UPDATE SET categoria = EXCLUDED.categoria`,
              [chave, cat.chave, String(t.descricao || '').slice(0, 120)]
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
          row = await get(`SELECT chave, label FROM categorias WHERE chave = $1`, [chaveTry]);
          if (!row) {
            row = await get(`SELECT chave, label FROM categorias WHERE lower(label) = lower($1)`, [deRaw]);
          }
          if (!row) {
            row = await get(
              `SELECT chave, label FROM categorias
               WHERE label ILIKE $1 OR chave ILIKE $2
               ORDER BY length(label) ASC LIMIT 1`,
              [`%${deRaw}%`, `%${chaveTry}%`]
            );
          }
        }
        if (!row) {
          const chaveNovo = normalizarChave(novoLabel);
          row = await get(`SELECT chave, label FROM categorias WHERE chave = $1`, [chaveNovo]);
        }
        if (!row) {
          feitos.push({ tipo, ok: false, erro: 'categoria não encontrada pra renomear' });
          continue;
        }
        await run(`UPDATE categorias SET label = $1 WHERE chave = $2`, [novoLabel, row.chave]);
        feitos.push({
          tipo,
          ok: true,
          categoria: row.chave,
          label: novoLabel,
          label_antes: row.label
        });
      } else {
        feitos.push({ tipo: tipo || 'desconhecido', ok: false, erro: 'tipo não suportado' });
      }
    } catch (e) {
      feitos.push({ tipo, ok: false, erro: e.message });
    }
  }
  return feitos;
}

function tituloDeMensagem(msg) {
  const t = String(msg || '').replace(/\s+/g, ' ').trim();
  if (!t) return 'Nova conversa';
  return t.length > 56 ? t.slice(0, 53) + '…' : t;
}

async function garantirConversa(conversaId, primeiraMsg) {
  if (conversaId) {
    const existe = await get(`SELECT id FROM assist_conversas WHERE id = $1`, [conversaId]);
    if (existe) return conversaId;
  }
  const id = uuid();
  await run(
    `INSERT INTO assist_conversas (id, titulo) VALUES ($1, $2)`,
    [id, tituloDeMensagem(primeiraMsg)]
  );
  return id;
}

async function salvarMensagem(conversaId, role, content) {
  const id = uuid();
  await run(
    `INSERT INTO assist_mensagens (id, conversa_id, role, content) VALUES ($1, $2, $3, $4)`,
    [id, conversaId, role, String(content || '')]
  );
  await run(
    `UPDATE assist_conversas SET atualizado_em = CURRENT_TIMESTAMP WHERE id = $1`,
    [conversaId]
  );
  return id;
}

// GET /api/ia/conversas — lista conversas recentes
router.get('/conversas', async (req, res) => {
  try {
    const rows = await all(`
      SELECT c.id, c.titulo, c.criado_em, c.atualizado_em,
             (SELECT COUNT(*)::int FROM assist_mensagens m WHERE m.conversa_id = c.id) AS msgs
      FROM assist_conversas c
      ORDER BY c.atualizado_em DESC
      LIMIT 40
    `);
    res.json({ conversas: rows });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// GET /api/ia/conversas/:id — mensagens de uma conversa
router.get('/conversas/:id', async (req, res) => {
  try {
    const conv = await get(`SELECT id, titulo, criado_em, atualizado_em FROM assist_conversas WHERE id = $1`, [req.params.id]);
    if (!conv) return res.status(404).json({ erro: 'Conversa não encontrada' });
    const mensagens = await all(`
      SELECT id, role, content, criado_em
      FROM assist_mensagens
      WHERE conversa_id = $1
      ORDER BY criado_em ASC, id ASC
      LIMIT 200
    `, [req.params.id]);
    res.json({ conversa: conv, mensagens });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// POST /api/ia/conversas — nova conversa vazia
router.post('/conversas', async (req, res) => {
  try {
    const id = uuid();
    const titulo = String(req.body?.titulo || 'Nova conversa').trim() || 'Nova conversa';
    await run(`INSERT INTO assist_conversas (id, titulo) VALUES ($1, $2)`, [id, titulo]);
    res.json({ id, titulo });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// DELETE /api/ia/conversas/:id
router.delete('/conversas/:id', async (req, res) => {
  try {
    await run(`DELETE FROM assist_conversas WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// POST /api/ia/chat — assistente global
router.post('/chat', async (req, res) => {
  if (!providerAtivo()) return res.status(400).json({ erro: 'IA não configurada. Defina GEMINI_API_KEY ou ANTHROPIC_API_KEY.' });
  const mensagem = String(req.body?.mensagem || '').trim();
  if (!mensagem) return res.status(400).json({ erro: 'mensagem é obrigatória' });
  let historico = Array.isArray(req.body?.historico) ? req.body.historico : [];
  let conversaId = req.body?.conversa_id ? String(req.body.conversa_id) : null;

  try {
    conversaId = await garantirConversa(conversaId, mensagem);

    // Se o cliente não mandou histórico, monta pelos últimos turns no banco
    if (!historico.length) {
      const msgsDb = await all(`
        SELECT role, content FROM assist_mensagens
        WHERE conversa_id = $1 AND role IN ('user','assistant')
        ORDER BY criado_em DESC, id DESC
        LIMIT 12
      `, [conversaId]);
      historico = msgsDb.reverse().map(m => ({ role: m.role, content: m.content }));
    }

    await salvarMensagem(conversaId, 'user', mensagem);

    // Título = primeira pergunta do usuário (se ainda for genérico)
    const conv = await get(`SELECT titulo FROM assist_conversas WHERE id = $1`, [conversaId]);
    if (conv && (!conv.titulo || conv.titulo === 'Nova conversa')) {
      await run(`UPDATE assist_conversas SET titulo = $1 WHERE id = $2`, [tituloDeMensagem(mensagem), conversaId]);
    }

    const snap = await snapshotAssistente();
    const systemPrompt = `Você é o assistente pessoal do App Rotina. Português brasileiro, direto, tom de amigo útil. Trata o usuário por "você".

Missão: responder QUALQUER pergunta sobre o app e os dados do usuário que estiverem no JSON de contexto abaixo — tarefas, hábitos, financeiro, despesas do mês, metas, alarmes, eventos/calendário, recorrentes, saldos, plano financeiro, MEI/DAS, histórico e streak. Se a informação existir no contexto, use-a. Se não existir no contexto, diga que não tem esse dado no app agora (não invente).

Contexto atual (fonte da verdade):
${JSON.stringify(snap)}

Como usar o contexto:
- Períodos: "hoje/ontem/amanhã" → tarefas.*; "essa semana" → habitos[].semana_concluidas ou tarefas.stats_7d; "esse mês" → despesas_mes, financeiro.mes_atual, habitos[].mes_concluidas.
- Finanças: financeiro.d7/d30/mes_atual, ultimas_transacoes (com id), categorias, gastos_por_categoria_30d, saldos_contas, plano_financeiro, despesas_mes.
- Produtividade: tarefas (hoje, atrasadas, próximos), stats_7d/30d, streak_dias_completos, historico_tarefas_recentes, recorrentes, consistencia_horario (horário médio e desvio por tarefa).
- Agenda: eventos_proximos, alarmes.
- Hábitos: só Academia (feito_hoje, semana e mês).
- Confirmações ("já paguei X"): diga o status em despesas_mes ou nas transações; se não achar, diga que não encontrou.

Ações (quando o usuário pedir pra fazer algo no app — VOCÊ executa; NÃO mande ele ir no Extrato manualmente):
- registrar pendência/dívida/despesa/tarefa/meta → acoes
- "fui na academia" → marcar_habito
- criar categoria / renomear / organizar / recategorizar / "joga pra X" / "não bagunçar gasto" / "ajusta o nome" → criar_categoria, renomear_categoria e/ou recategorizar
- Se faltar dado essencial (qual categoria? quais txs?), pergunte e NÃO emita ação
- Preferir ids de financeiro.ultimas_transacoes[].id quando bater a descrição/valor/data; senão use filtros

Responda APENAS um JSON válido completo:
{"resposta":"texto em markdown simples (máx 160 palavras). Use **negrito** em números-chave.","acoes":[]}

Tipos de ação:
- {"tipo":"criar_despesa","titulo":"...","valor_esperado":123.45,"dia_vencimento":15,"categoria":"contas_fixas|moradia|assinaturas|transporte|saude|outros|projetos|faturas"}
- {"tipo":"criar_tarefa","titulo":"...","prioridade":"alta|media|baixa","data_reset":"YYYY-MM-DD"}
- {"tipo":"criar_meta","nome":"...","valor_total":1000,"prazo":"YYYY-MM-DD"|null}
- {"tipo":"marcar_habito","titulo":"Academia"}
- {"tipo":"criar_categoria","categoria_label":"Apostas - Amigos"}
- {"tipo":"renomear_categoria","de":"apostasamigos","categoria_label":"Apostas - Amigos"}
- {"tipo":"recategorizar","categoria_label":"Apostas - Amigos","ids":["uuid1","uuid2"]}
- {"tipo":"recategorizar","categoria_label":"Apostas - Amigos","filtros":{"data":"YYYY-MM-DD","valores":[250,400,350],"contem":["Erik","Superbet","Tizon"]}}

Regras:
- "resposta" é o texto que o usuário lê — nunca JSON cru dentro dela. Confirme o que foi feito (ex: "categorizei N txs em Apostas - Amigos").
- NUNCA diga que criou/moveu/renomeou/categorizou se não emitir a ação correspondente em "acoes". Sem ação = não aconteceu.
- Se o usuário pedir organização de categorias, EMITA a ação — não diga "vai no extrato e altera".
- "ajusta/renomeia o nome da categoria" → renomear_categoria (use chave de financeiro.categorias; "de" = chave ou label atual).
- Use financeiro.categorias (chave/label) se a categoria já existir; senão criar_categoria + recategorizar (ou só recategorizar, que cria a categoria).
- Em filtros.contem use pedaços reais da descrição (ex: "ERIK", "SPRBT", "TIZON"), não apelidos inventados.
- Prefira ids de ultimas_transacoes quando bater.
- Responda a pergunta feita; não desvie pra pitch genérico.
- acoes pode ser [].
- Não invente números, títulos, ids ou status.
- No máximo 1 emoji.
- Valores em R$ (ex: R$ 1.200).`;

    const { texto, usage, provider } = await chamarIA({
      system: systemPrompt,
      user: mensagem,
      historico,
      maxTokens: 1400,
      jsonMode: true,
      timeout: 35000
    });

    let parsed = null;
    try { parsed = parseJSON(texto); }
    catch (e) { parsed = null; }

    const respostaBruta = textoAssistenteSeguro(texto, parsed);
    const acoesExec = await executarAcoes(parsed && parsed.acoes);
    const resposta = reconciliarRespostaComAcoes(respostaBruta, acoesExec);
    await salvarMensagem(conversaId, 'assistant', resposta);

    res.json({ resposta, acoes: acoesExec, snapshot: snap, provider, usage, conversa_id: conversaId });
  } catch (err) {
    res.status(503).json({
      erro: mensagemGemini(err)
    });
  }
});

module.exports = router;
