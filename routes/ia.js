const express = require('express');
const axios = require('axios');
const { v4: uuid } = require('uuid');
const { all, run, get } = require('../lib/db');
const { checkinHabito } = require('../lib/habitos');

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

// Parse JSON tolerante (aceita ```json ... ``` markdown wrapper)
function parseJSON(txt) {
  const s = String(txt || '').replace(/^```json\s*|\s*```$/g, '').trim();
  return JSON.parse(s);
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

  const hoje = new Date().toISOString().slice(0, 10);
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
    const hoje = new Date().toISOString().slice(0, 10);
    const ontem = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const inicio30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

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

function ymAtualLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function brlNum(v) {
  return Math.round(Number(v || 0) * 100) / 100;
}

async function snapshotAssistente() {
  const hoje = new Date().toISOString().slice(0, 10);
  const ym = ymAtualLocal();
  const inicio30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const [
    tarefasHoje,
    statsTarefas,
    fin30,
    despesas,
    metas,
    alarmes,
    habitosMes
  ] = await Promise.all([
    all(
      `SELECT titulo, concluida, prioridade, hora
       FROM tasks WHERE data_reset::date = $1
       ORDER BY concluida, prioridade, hora NULLS LAST
       LIMIT 40`,
      [hoje]
    ),
    all(
      `SELECT
         COUNT(*)::int AS total,
         SUM(CASE WHEN concluida THEN 1 ELSE 0 END)::int AS concluidas
       FROM tasks
       WHERE data_reset IS NOT NULL
         AND DATE(data_reset) >= CURRENT_DATE - INTERVAL '30 days'`
    ),
    all(
      `SELECT
         COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END),0) AS entradas,
         COALESCE(SUM(CASE WHEN tipo='saida' THEN valor ELSE 0 END),0) AS saidas
       FROM financeiro
       WHERE data >= $1`,
      [inicio30]
    ),
    all(
      `SELECT titulo, valor_esperado, dia_vencimento, categoria, status
       FROM despesas_mes WHERE ym = $1
       ORDER BY CASE status WHEN 'atrasado' THEN 0 WHEN 'pendente' THEN 1 ELSE 2 END, dia_vencimento NULLS LAST
       LIMIT 40`,
      [ym]
    ).catch(() => []),
    all(
      `SELECT m.nome, m.valor_total, m.prazo, m.concluida,
              COALESCE((SELECT SUM(valor) FROM metas_depositos d WHERE d.meta_id = m.id),0) AS guardado
       FROM metas m
       WHERE m.concluida = false
       ORDER BY m.prazo NULLS LAST
       LIMIT 15`
    ).catch(() => []),
    all(`SELECT hora, mensagem FROM alarmes WHERE ativo = true ORDER BY hora LIMIT 10`).catch(() => []),
    all(
      `SELECT
         COUNT(*) FILTER (WHERE concluida)::int AS concluidas,
         COUNT(*)::int AS total,
         ARRAY_AGG(TO_CHAR(data_reset::date, 'YYYY-MM-DD') ORDER BY data_reset)
           FILTER (WHERE concluida) AS dias
       FROM tasks
       WHERE data_reset IS NOT NULL
         AND DATE(data_reset) >= DATE_TRUNC('month', CURRENT_DATE)
         AND (
           titulo ILIKE '%academia%' OR titulo ILIKE '%treino%' OR titulo ILIKE '%pilates%'
           OR categoria ILIKE '%academia%' OR categoria ILIKE '%treino%'
         )`
    ).catch(() => [{ concluidas: 0, total: 0, dias: [] }])
  ]);

  const tHoje = tarefasHoje || [];
  const st = statsTarefas[0] || { total: 0, concluidas: 0 };
  const f = fin30[0] || { entradas: 0, saidas: 0 };
  const entradas = brlNum(f.entradas);
  const saidas = brlNum(f.saidas);
  const desp = despesas || [];
  const resumoDesp = desp.reduce((acc, d) => {
    const v = brlNum(d.valor_esperado);
    acc.esperado += v;
    if (d.status === 'pago') acc.pago += v;
    else if (d.status === 'atrasado') acc.atrasado += v;
    else if (d.status !== 'ignorado') acc.pendente += v;
    return acc;
  }, { esperado: 0, pago: 0, pendente: 0, atrasado: 0 });

  const livre30 = entradas - saidas;
  const taxa30 = st.total > 0 ? Math.round((st.concluidas / st.total) * 100) : 0;

  return {
    hoje,
    mes: ym,
    tarefas_hoje: {
      total: tHoje.length,
      concluidas: tHoje.filter(t => t.concluida).length,
      pendentes: tHoje.filter(t => !t.concluida).map(t => ({
        titulo: t.titulo,
        prioridade: t.prioridade,
        hora: t.hora
      }))
    },
    produtividade_30d: {
      total: st.total,
      concluidas: st.concluidas,
      taxa: taxa30
    },
    financeiro_30d: {
      entradas,
      saidas,
      sobra: brlNum(livre30),
      gastando_mais_que_ganha: saidas > entradas
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
        categoria: d.categoria
      }))
    },
    metas: (metas || []).map(m => ({
      nome: m.nome,
      total: brlNum(m.valor_total),
      guardado: brlNum(m.guardado),
      prazo: m.prazo
    })),
    alarmes: (alarmes || []).map(a => ({ hora: a.hora, msg: a.mensagem })),
    habitos_mes: {
      academia_treino: {
        concluidas: Number((habitosMes[0] || {}).concluidas || 0),
        total: Number((habitosMes[0] || {}).total || 0),
        dias: (habitosMes[0] && habitosMes[0].dias) || []
      },
      nota: 'Só conta tarefas deste mês cujo título/categoria contém academia, treino ou pilates. Se total=0, o app não registrou idas — não invente um número.'
    }
  };
}

async function executarAcoes(acoes) {
  if (!Array.isArray(acoes) || acoes.length === 0) return [];
  const feitos = [];
  const ym = ymAtualLocal();

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
        const dataReset = acao.data_reset && String(acao.data_reset).length === 10
          ? new Date(acao.data_reset + 'T00:00:00Z').toISOString()
          : new Date().toISOString();
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
        feitos.push({
          tipo,
          ok: true,
          titulo: (r.task && r.task.titulo) || titulo,
          ja: r.ja,
          criada: r.criada
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

// POST /api/ia/chat — assistente global
router.post('/chat', async (req, res) => {
  if (!providerAtivo()) return res.status(400).json({ erro: 'IA não configurada. Defina GEMINI_API_KEY ou ANTHROPIC_API_KEY.' });
  const mensagem = String(req.body?.mensagem || '').trim();
  if (!mensagem) return res.status(400).json({ erro: 'mensagem é obrigatória' });
  const historico = Array.isArray(req.body?.historico) ? req.body.historico : [];

  try {
    const snap = await snapshotAssistente();
    const livre = snap.financeiro_30d.sobra;
    const systemPrompt = `Você é o assistente pessoal do App Rotina. Fala português brasileiro, direto, sem enrolação. Trata o usuário por "você".

Contexto atual (não invente números fora disso):
${JSON.stringify(snap)}

Como usar o contexto:
- Saúde financeira: compare entradas vs saídas dos últimos 30 dias. Se gastando_mais_que_ganha, avise com clareza.
- Quanto pode gastar/investir no mês: use a sobra (entradas - saídas) e o que ainda está pendente/atrasado em despesas_mes.
- Tarefas: comente pendentes de hoje e a taxa de conclusão dos 30 dias. Se a taxa estiver baixa, seja honesto.
- Metas: diga se o ritmo cabe na sobra.

Ações: se o usuário pedir pra registrar pendência, dívida, despesa, tarefa ou meta, inclua no JSON. Se disser que foi à academia / treinou hoje, use marcar_habito. Não peça confirmação extra se os dados essenciais já vieram na frase. Se faltar valor, pergunte na resposta e NÃO emita a ação.

Responda APENAS JSON válido:
{"resposta":"texto em markdown simples, no máximo 180 palavras","acoes":[]}

Tipos de ação:
- {"tipo":"criar_despesa","titulo":"...","valor_esperado":123.45,"dia_vencimento":15,"categoria":"contas_fixas|moradia|assinaturas|transporte|saude|outros"}
- {"tipo":"criar_tarefa","titulo":"...","prioridade":"alta|media|baixa","data_reset":"YYYY-MM-DD"}
- {"tipo":"criar_meta","nome":"...","valor_total":1000,"prazo":"YYYY-MM-DD"|null}
- {"tipo":"marcar_habito","titulo":"Academia"}

Regras:
- acoes pode ser [].
- Não invente despesas/tarefas que o usuário não pediu.
- Não use emoji em excesso (no máximo 1).
- Números em reais com clareza (ex: R$ 1.200).`;

    const { texto, usage, provider } = await chamarIA({
      system: systemPrompt,
      user: mensagem,
      historico,
      maxTokens: 700,
      jsonMode: true,
      timeout: 28000
    });

    let parsed;
    try { parsed = parseJSON(texto); }
    catch (e) {
      return res.json({ resposta: texto || 'Não consegui formatar a resposta.', acoes: [], provider, usage });
    }

    const resposta = String(parsed.resposta || '').trim() || 'Beleza — me conta mais um detalhe pra eu agir.';
    const acoesExec = await executarAcoes(parsed.acoes);
    res.json({ resposta, acoes: acoesExec, snapshot: snap, provider, usage });
  } catch (err) {
    res.status(503).json({
      erro: mensagemGemini(err)
    });
  }
});

module.exports = router;
