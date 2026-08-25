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
  const acaoTipos = new Set([
    'recategorizar', 'criar_categoria', 'renomear_categoria', 'fundir_categorias',
    'confirmar_despesa', 'confirmar_receita', 'criar_receita', 'depositar_meta', 'concluir_tarefa', 'criar_evento', 'criar_alarme',
    'criar_transacao', 'deletar_transacao', 'corrigir_data_tx', 'marcar_das',
    'criar_despesa', 'criar_tarefa', 'criar_meta', 'marcar_habito'
  ]);
  const finOk = oks.filter(a => acaoTipos.has(a.tipo));
  const claim = /criei|movi|categorizei|recategoriz|organizei|prontinho|renomeei|renomear|unifiquei|fundi|confirm|paguei|depositei|conclu[ií]|agendei|alarme|ajustei|já (está|esta|ficou|paguei)|alterei|atualizei|deletei|apag|corrig/i.test(String(resposta || ''));

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
      } else if (a.tipo === 'fundir_categorias') {
        const fontes = (a.de || []).join(', ') || 'as categorias';
        partes.push(`Unifiquei **${fontes}** em **${a.label || a.categoria}** (${a.qtd || 0} txs).`);
      } else if (a.tipo === 'confirmar_despesa') {
        partes.push(a.ja
          ? `**${a.titulo}** já estava paga.`
          : `Marquei **${a.titulo}** como paga.`);
      } else if (a.tipo === 'confirmar_receita') {
        partes.push(a.ja
          ? `**${a.titulo}** já estava recebida.`
          : `Marquei **${a.titulo}** como recebida.`);
      } else if (a.tipo === 'criar_receita') {
        partes.push(`Registrei receita **${a.titulo}** de **R$ ${Number(a.valor).toFixed(2)}**.`);
      } else if (a.tipo === 'depositar_meta') {
        partes.push(`Depositei **R$ ${Number(a.valor).toFixed(2)}** em **${a.meta}**${a.concluida ? ' (meta concluída!)' : ''}.`);
      } else if (a.tipo === 'concluir_tarefa') {
        partes.push(a.ja
          ? `**${a.titulo}** já estava concluída.`
          : `Concluí **${a.titulo}**.`);
      } else if (a.tipo === 'criar_evento') {
        partes.push(`Agendei **${a.titulo}** em **${a.data}**${a.hora ? ` às ${a.hora}` : ''}.`);
      } else if (a.tipo === 'criar_alarme') {
        partes.push(`Alarme **${a.hora}** — ${a.mensagem}.`);
      } else if (a.tipo === 'criar_transacao') {
        partes.push(`Lancei ${a.sentido} de **R$ ${Number(a.valor).toFixed(2)}** (${a.descricao}).`);
      } else if (a.tipo === 'deletar_transacao') {
        partes.push(`Apaguei **${a.qtd || 0}** transação(ões).`);
      } else if (a.tipo === 'corrigir_data_tx') {
        partes.push(`Corrigi a data de **${a.qtd || 0}** tx(s) pra **${a.data}**.`);
      } else if (a.tipo === 'marcar_das') {
        partes.push(a.pago ? `DAS **${a.ym}** marcado como pago.` : `DAS **${a.ym}** desmarcado.`);
      } else if (a.tipo === 'criar_despesa') {
        partes.push(`Despesa **${a.titulo}** registrada.`);
      } else if (a.tipo === 'criar_tarefa') {
        partes.push(`Tarefa **${a.titulo}** criada.`);
      } else if (a.tipo === 'criar_meta') {
        partes.push(`Meta **${a.nome}** criada.`);
      } else if (a.tipo === 'marcar_habito') {
        partes.push(a.ja ? `**${a.titulo}** já estava marcado.` : `**${a.titulo}** marcado.`);
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
    id: t.id || null,
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
    receitas,
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
      `SELECT id, titulo, concluida, prioridade, hora, concluida_em, categoria, data_reset
       FROM tasks WHERE data_reset::date = $1
       ORDER BY concluida, prioridade, hora NULLS LAST LIMIT 50`,
      [hoje]
    ).catch(() => []),
    all(
      `SELECT id, titulo, concluida, prioridade, hora, concluida_em, categoria
       FROM tasks WHERE data_reset::date = $1
       ORDER BY concluida, prioridade LIMIT 30`,
      [ontem]
    ).catch(() => []),
    all(
      `SELECT id, titulo, concluida, prioridade, hora, categoria
       FROM tasks WHERE data_reset::date = $1
       ORDER BY prioridade, hora NULLS LAST LIMIT 30`,
      [amanha]
    ).catch(() => []),
    all(
      `SELECT id, titulo, concluida, prioridade, hora, categoria, data_reset
       FROM tasks
       WHERE data_reset::date > $1::date AND data_reset::date <= $2::date
       ORDER BY data_reset, prioridade LIMIT 40`,
      [hoje, fim14]
    ).catch(() => []),
    all(
      `SELECT id, titulo, prioridade, hora, data_reset
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
      `SELECT id, titulo, valor_esperado, dia_vencimento, categoria, status, pago_em, confirmado_por
       FROM despesas_mes WHERE ym = $1
       ORDER BY CASE status WHEN 'atrasado' THEN 0 WHEN 'pendente' THEN 1 WHEN 'pago' THEN 2 ELSE 3 END,
                dia_vencimento NULLS LAST
       LIMIT 60`,
      [ym]
    ).catch(() => []),
    all(
      `SELECT id, titulo, valor_esperado, valor_recebido, dia_previsto, tipo, chave, status, recebido_em, origem, notas
       FROM receitas_mes WHERE ym = $1
       ORDER BY CASE tipo WHEN 'fixa' THEN 0 ELSE 1 END,
                CASE status WHEN 'atrasado' THEN 0 WHEN 'pendente' THEN 1 WHEN 'recebido' THEN 2 ELSE 3 END,
                dia_previsto NULLS LAST
       LIMIT 40`,
      [ym]
    ).catch(() => []),
    all(
      `SELECT m.id, m.nome, m.valor_total, m.prazo, m.concluida,
              COALESCE((SELECT SUM(valor) FROM metas_depositos d WHERE d.meta_id = m.id),0) AS guardado
       FROM metas m
       ORDER BY m.concluida ASC, m.prazo NULLS LAST
       LIMIT 20`
    ).catch(() => []),
    all(`SELECT id, hora, mensagem, ativo FROM alarmes ORDER BY ativo DESC, hora LIMIT 20`).catch(() => []),
    listarHabitos().catch(() => ({ habitos: [] })),
    all(
      `SELECT titulo, prioridade, categoria, frequencia, dias_semana, ativa
       FROM tarefas_recorrentes WHERE ativa = true
       ORDER BY titulo LIMIT 30`
    ).catch(() => []),
    all(
      `SELECT id, titulo, tipo, data, hora, cor
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
  const rec = receitas || [];

  const resumoDesp = desp.reduce((acc, d) => {
    if ((d.categoria || '') === 'faturas') return acc;
    const v = brlNum(d.valor_esperado);
    acc.esperado += v;
    if (d.status === 'pago') acc.pago += v;
    else if (d.status === 'atrasado') acc.atrasado += v;
    else if (d.status !== 'ignorado') acc.pendente += v;
    return acc;
  }, { esperado: 0, pago: 0, pendente: 0, atrasado: 0 });

  const resumoRec = rec.reduce((acc, r) => {
    if (r.tipo === 'fixa') {
      const v = brlNum(r.valor_esperado);
      acc.piso += v;
      if (r.status === 'recebido') acc.recebido += brlNum(r.valor_recebido ?? r.valor_esperado);
      else if (r.status === 'atrasado') acc.atrasado += v;
      else acc.pendente += v;
    } else {
      const v = brlNum(r.valor_recebido ?? r.valor_esperado);
      acc.variavel += v;
      if (r.status === 'recebido') acc.recebido += v;
    }
    return acc;
  }, { piso: 0, recebido: 0, pendente: 0, atrasado: 0, variavel: 0 });

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
        id: t.id || null,
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
        id: d.id,
        titulo: d.titulo,
        valor: brlNum(d.valor_esperado),
        dia: d.dia_vencimento,
        status: d.status,
        categoria: d.categoria,
        pago_em: d.pago_em ? String(d.pago_em).slice(0, 10) : null
      }))
    },
    receitas_mes: {
      resumo: {
        piso: brlNum(resumoRec.piso),
        recebido: brlNum(resumoRec.recebido),
        pendente: brlNum(resumoRec.pendente),
        atrasado: brlNum(resumoRec.atrasado),
        variavel: brlNum(resumoRec.variavel)
      },
      itens: rec.map(r => ({
        id: r.id,
        titulo: r.titulo,
        tipo: r.tipo,
        chave: r.chave,
        valor_esperado: brlNum(r.valor_esperado),
        valor_recebido: r.valor_recebido != null ? brlNum(r.valor_recebido) : null,
        dia_previsto: r.dia_previsto,
        status: r.status,
        recebido_em: r.recebido_em ? String(r.recebido_em).slice(0, 10) : null
      })),
      renda_fixa: (plano.rendaFixa || []).map(r => ({ chave: r.chave, nome: r.nome, valor: r.valor, dia: r.dia })),
      tipos_variavel: (plano.rendaVariavelTipos || []).map(t => ({ chave: t.chave, label: t.label }))
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
      id: m.id,
      nome: m.nome,
      total: brlNum(m.valor_total),
      guardado: brlNum(m.guardado),
      falta: brlNum(Number(m.valor_total) - Number(m.guardado)),
      prazo: m.prazo,
      concluida: !!m.concluida
    })),
    alarmes: (alarmes || []).map(a => ({
      id: a.id || null,
      hora: a.hora,
      msg: a.mensagem,
      ativo: a.ativo !== false
    })),
    eventos_proximos: (eventos || []).map(e => ({
      id: e.id || null,
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
    if (existe) {
      // Se pediram label novo e a chave já existe, atualiza o label
      if (labelHint && labelHint !== existe.label) {
        await run(`UPDATE categorias SET label = $1 WHERE chave = $2`, [labelHint, existe.chave]);
        return { chave: existe.chave, label: labelHint, criada: false };
      }
      return { chave: existe.chave, label: existe.label, criada: false };
    }
    const lab = label || chave;
    await run(
      `INSERT INTO categorias (chave, label, criado_por_usuario) VALUES ($1,$2,true)
       ON CONFLICT (chave) DO NOTHING`,
      [chave, lab]
    );
    return { chave, label: lab, criada: true };
  }

  async function resolverCategoriaRef(ref) {
    const raw = String(ref || '').trim();
    if (!raw) return null;
    const chaveTry = /^[a-z0-9_]+$/i.test(raw) ? raw.toLowerCase() : normalizarChave(raw);
    let row = await get(`SELECT chave, label FROM categorias WHERE chave = $1`, [chaveTry]);
    if (!row) row = await get(`SELECT chave, label FROM categorias WHERE lower(label) = lower($1)`, [raw]);
    if (!row) {
      row = await get(
        `SELECT chave, label FROM categorias
         WHERE label ILIKE $1 OR chave ILIKE $2
         ORDER BY length(label) ASC LIMIT 1`,
        [`%${raw}%`, `%${chaveTry}%`]
      );
    }
    return row;
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
          // "Apostas - Amigo" → apostasamigo vs chave apostasamigos
          if (!row && chaveNovo.length >= 6) {
            row = await get(
              `SELECT chave, label FROM categorias
               WHERE chave LIKE $1 OR $2 LIKE (chave || '%')
               ORDER BY ABS(length(chave) - length($3)) ASC, length(chave) DESC
               LIMIT 1`,
              [`${chaveNovo}%`, chaveNovo, chaveNovo]
            );
          }
          if (!row && /amigo/i.test(novoLabel)) {
            row = await get(
              `SELECT chave, label FROM categorias
               WHERE chave ILIKE '%amigo%' OR label ILIKE '%amigo%'
               ORDER BY length(label) ASC LIMIT 1`
            );
          }
          if (!row && /aposta/i.test(novoLabel)) {
            row = await get(
              `SELECT chave, label FROM categorias
               WHERE chave ILIKE '%aposta%' OR label ILIKE '%aposta%'
               ORDER BY CASE WHEN chave = 'apostas' THEN 1 ELSE 0 END, length(label) ASC
               LIMIT 1`
            );
          }
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
            `SELECT chave, label FROM categorias WHERE lower(label) = lower($1)`,
            [novoLabel]
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
            `SELECT chave, label FROM categorias WHERE lower(label) = lower($1)`,
            [novoLabel]
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
          await run(`UPDATE categorias SET label = $1 WHERE chave = $2`, [lab, alvo.chave]);
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
           WHERE categoria = ANY($2::text[])`,
          [alvo.chave, chavesOrigem]
        );
        await run(
          `UPDATE categoria_regras SET categoria = $1 WHERE categoria = ANY($2::text[])`,
          [alvo.chave, chavesOrigem]
        ).catch(() => {});
        await run(
          `UPDATE despesas_mes SET categoria = $1 WHERE categoria = ANY($2::text[])`,
          [alvo.chave, chavesOrigem]
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
          await run(`DELETE FROM categorias WHERE chave = $1`, [c]).catch(() => {});
        }

        await run(`UPDATE categorias SET label = $1 WHERE chave = $2`, [lab, alvo.chave]);

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
        if (id) row = await get(`SELECT id, titulo, status FROM despesas_mes WHERE id = $1`, [id]);
        if (!row && titulo) {
          row = await get(
            `SELECT id, titulo, status FROM despesas_mes
             WHERE ym = $1 AND status IN ('pendente','atrasado')
               AND (lower(titulo) = lower($2) OR titulo ILIKE $3)
             ORDER BY CASE WHEN lower(titulo) = lower($2) THEN 0 ELSE 1 END, dia_vencimento NULLS LAST
             LIMIT 1`,
            [acao.ym || ym, titulo, `%${titulo}%`]
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
           WHERE id = $2`,
          [pagoEm, row.id]
        );
        feitos.push({ tipo, ok: true, titulo: row.titulo, id: row.id, pago_em: pagoEm });
      } else if (tipo === 'confirmar_receita') {
        const ymRec = String(acao.ym || ym).slice(0, 7);
        const titulo = String(acao.titulo || acao.nome || '').trim();
        const chave = String(acao.chave || '').trim() || null;
        const id = acao.id ? String(acao.id) : null;

        const countRec = await get(`SELECT COUNT(*)::int AS n FROM receitas_mes WHERE ym = $1`, [ymRec]);
        if (!countRec?.n) {
          for (const item of plano.rendaFixa || []) {
            const dia = item.dia != null ? Number(item.dia) : null;
            await run(
              `INSERT INTO receitas_mes
                (id, ym, titulo, valor_esperado, valor_recebido, dia_previsto, tipo, chave, status, recebido_em, origem)
               VALUES ($1,$2,$3,$4,NULL,$5,'fixa',$6,'pendente',NULL,'plano')`,
              [uuid(), ymRec, item.nome, item.valor, dia, item.chave]
            );
          }
        }

        let row = null;
        if (id) row = await get(`SELECT * FROM receitas_mes WHERE id = $1`, [id]);
        if (!row && chave) {
          row = await get(
            `SELECT * FROM receitas_mes WHERE ym = $1 AND chave = $2 AND status IN ('pendente','atrasado')
             ORDER BY CASE tipo WHEN 'fixa' THEN 0 ELSE 1 END LIMIT 1`,
            [acao.ym || ymRec, chave]
          );
        }
        if (!row && titulo) {
          row = await get(
            `SELECT * FROM receitas_mes
             WHERE ym = $1 AND status IN ('pendente','atrasado')
               AND (lower(titulo) = lower($2) OR titulo ILIKE $3)
             ORDER BY CASE WHEN lower(titulo) = lower($2) THEN 0 ELSE 1 END, dia_previsto NULLS LAST
             LIMIT 1`,
            [ymRec, titulo, `%${titulo}%`]
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
           WHERE id = $3`,
          [valor, recebidoEm, row.id]
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
            (id, ym, titulo, valor_esperado, valor_recebido, dia_previsto, tipo, chave, status, recebido_em, notas, origem)
           VALUES ($1,$2,$3,$4,$5,$6,'variavel',$7,'recebido',$8,$9,'assistente')`,
          [
            id,
            ymRec,
            titulo,
            valor,
            valor,
            recebidoEm ? Number(String(recebidoEm).slice(8, 10)) : null,
            chave,
            recebidoEm,
            acao.notas ? String(acao.notas).trim() : null
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
        if (acao.id) meta = await get(`SELECT id, nome, valor_total, concluida FROM metas WHERE id = $1`, [acao.id]);
        const nome = String(acao.nome || acao.titulo || acao.meta || '').trim();
        if (!meta && nome) {
          meta = await get(
            `SELECT id, nome, valor_total, concluida FROM metas
             WHERE lower(nome) = lower($1) OR nome ILIKE $2
             ORDER BY CASE WHEN lower(nome) = lower($1) THEN 0 ELSE 1 END, concluida ASC
             LIMIT 1`,
            [nome, `%${nome}%`]
          );
        }
        if (!meta) {
          feitos.push({ tipo, ok: false, erro: 'meta não encontrada' });
          continue;
        }
        await run(
          `INSERT INTO metas_depositos (meta_id, valor, descricao) VALUES ($1,$2,$3)`,
          [meta.id, valor, acao.descricao || 'via assistente']
        );
        const soma = await get(`SELECT COALESCE(SUM(valor),0) AS s FROM metas_depositos WHERE meta_id = $1`, [meta.id]);
        let concluidaAgora = false;
        if (Number(soma.s) >= Number(meta.valor_total) && !meta.concluida) {
          await run(`UPDATE metas SET concluida = true WHERE id = $1`, [meta.id]);
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
        if (id) row = await get(`SELECT id, titulo, concluida FROM tasks WHERE id = $1`, [id]);
        if (!row && titulo) {
          row = await get(
            `SELECT id, titulo, concluida FROM tasks
             WHERE data_reset::date = $1::date AND concluida = false
               AND (lower(titulo) = lower($2) OR titulo ILIKE $3)
             ORDER BY CASE WHEN lower(titulo) = lower($2) THEN 0 ELSE 1 END
             LIMIT 1`,
            [dataAlvo, titulo, `%${titulo}%`]
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
          `UPDATE tasks SET concluida = true, concluida_em = COALESCE(concluida_em, CURRENT_TIMESTAMP) WHERE id = $1`,
          [row.id]
        );
        persistirHistoricoDia(hojeStr()).catch(() => {});
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
          `INSERT INTO eventos (id, titulo, descricao, data, hora, tipo, cor)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [id, titulo, acao.descricao || '', data, acao.hora || null, acao.tipo_evento || acao.tipo || 'evento', acao.cor || 'blue']
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
        await run(`INSERT INTO alarmes (id, hora, mensagem) VALUES ($1,$2,$3)`, [id, hora, mensagem]);
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
          `INSERT INTO financeiro (id, tipo, valor, descricao, data, categoria, fonte, categoria_confirmada)
           VALUES ($1,$2,$3,$4,$5,$6,'manual',true)`,
          [id, sentido, valor, desc, data, cat]
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
        await run(`DELETE FROM financeiro WHERE id = ANY($1::text[])`, [ids]);
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
        await run(`UPDATE financeiro SET data = $1::date WHERE id = ANY($2::text[])`, [novaData, ids]);
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
        await run(
          `INSERT INTO mei_das (ym, valor, pago, data_pagamento)
           VALUES ($1, $2, $3, CASE WHEN $3 THEN CURRENT_DATE ELSE NULL END)
           ON CONFLICT (ym) DO UPDATE
             SET valor = COALESCE(EXCLUDED.valor, mei_das.valor),
                 pago = EXCLUDED.pago,
                 data_pagamento = CASE WHEN EXCLUDED.pago THEN CURRENT_DATE ELSE NULL END`,
          [ymDas, Number.isFinite(valor) ? valor : null, pago]
        );
        feitos.push({ tipo, ok: true, ym: ymDas, pago, valor: Number.isFinite(valor) ? valor : null });
      } else {
        feitos.push({ tipo: tipo || 'desconhecido', ok: false, erro: 'tipo não suportado' });
      }
    } catch (e) {
      feitos.push({ tipo, ok: false, erro: e.message });
    }
  }
  return feitos;
}

/** Se a IA esquecer de emitir acao, inferimos pedidos claros de rename/fundir. */
function inferirAcoesDaMensagem(mensagem, snap, acoesParsed) {
  const acoes = Array.isArray(acoesParsed) ? acoesParsed.filter(Boolean) : [];
  const msg = String(mensagem || '').replace(/\s+/g, ' ').trim();
  if (!msg) return acoes;

  // Não inventa ação em "desfaz"
  if (/\b(desfaz|desfaça|desfaca|undo|voltar atrás|voltar atras)\b/i.test(msg)) return acoes;

  const cats = (snap && snap.financeiro && snap.financeiro.categorias) || [];
  const norm = (s) => String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');

  const temFundir = acoes.some(a => a.tipo === 'fundir_categorias');
  const pedeFundir = /\b(unific|fund|junt[ae]|mescl|soma\b|apenas\s*1|só\s*1|so\s*1)\b/i.test(msg)
    || /deix[ae].{0,20}1\s*categoria/i.test(msg);

  if (pedeFundir && !temFundir) {
    let label = null;
    const mParens = msg.match(/\(([^)]{2,60})\)\s*$/);
    const mPra = msg.match(/(?:em|pra|para|pro)\s+[\"“']?([^\"”'\n.!?]{2,60})\s*$/i);
    const mApenas = msg.match(/(?:categoria|chama[dr]?|nome)\s+[\"“']?([^\"”'\n.!?]{2,60})/i);
    label = ((mParens && mParens[1]) || (mPra && mPra[1]) || (mApenas && mApenas[1]) || '').trim();
    if (/pai/i.test(msg) && /m[aã]e/i.test(msg) && !label) label = 'Pai e Mãe';

    const fontes = [];
    // tokens conhecidos do catálogo mencionados
    for (const c of cats) {
      const chave = c.chave || c.id;
      const lab = c.label || '';
      if (!chave) continue;
      const reChave = new RegExp(`\\b${chave.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (reChave.test(msg) || (lab.length >= 3 && msg.toLowerCase().includes(lab.toLowerCase()))) {
        fontes.push(chave);
      }
    }
    // pai / mae explícitos
    if (/\bpai\b/i.test(msg)) fontes.push('pai');
    if (/\bm[aã]e\b/i.test(msg)) fontes.push('mae');

    // duplicatas com mesmo label
    if (label) {
      for (const c of cats) {
        if (String(c.label || '').toLowerCase() === label.toLowerCase()) fontes.push(c.chave || c.id);
      }
    }

    const uniq = [...new Set(fontes.filter(Boolean))];
    if (uniq.length >= 2 || (label && uniq.length >= 1)) {
      acoes.push({
        tipo: 'fundir_categorias',
        de: uniq.length ? uniq : undefined,
        categoria_label: label || undefined
      });
    }
  }

  const temRename = acoes.some(a => a.tipo === 'renomear_categoria');
  // "muda alimentacao para mercado" / "ajusta o nome pra X"
  const mMuda = msg.match(/\b(?:mud[aeo]|renome[ia]|troc[ae]|alter[ae]|ajust[ae])\s+(?:o\s+nome\s+(?:da\s+categoria\s+)?)?(?:da\s+categoria\s+)?[\"“']?([a-z0-9_À-ú\s-]{2,40})[\"”']?\s+(?:pra|para|pro|=)\s+[\"“']?([^\"”'\n.!?]+)/i);
  const pedeRename = !!mMuda
    || /(?:ajust|renome).{0,40}(?:nome|categoria).{0,20}(?:pra|para)/i.test(msg);

  if (pedeRename && !temRename && !pedeFundir) {
    let de = mMuda ? mMuda[1].trim() : null;
    let novo = mMuda ? mMuda[2].trim() : null;
    if (!novo) {
      const m2 = msg.match(/(?:pra|para|pro)\s+[\"“']?([^\"”'\n.!?]+)/i);
      novo = m2 ? m2[1].trim() : null;
    }
    novo = (novo || '').replace(/^["“']+|["”']+$/g, '').trim();
    // evita engolir "e unifica..." no label
    if (novo) novo = novo.split(/\s+e\s+unific/i)[0].trim();

    if (novo && novo.length >= 2 && novo.length <= 60) {
      if (!de) {
        // tenta achar categoria mencionada que não é o destino
        const nNovo = norm(novo);
        de = (cats.find(c => {
          const k = c.chave || c.id;
          return k && msg.toLowerCase().includes(k) && norm(k) !== nNovo && norm(c.label) !== nNovo;
        }) || {}).chave;
      }
      acoes.push({
        tipo: 'renomear_categoria',
        de: de || undefined,
        categoria_label: novo
      });
    }
  }

  // Se a IA renomeou 2+ categorias pro MESMO label, vira fundir (evita 2x "Pai e Mãe")
  const renames = acoes.filter(a => a && a.tipo === 'renomear_categoria');
  const porLabel = {};
  for (const a of renames) {
    const lab = String(a.categoria_label || a.label || '').trim().toLowerCase();
    if (!lab) continue;
    (porLabel[lab] = porLabel[lab] || []).push(a);
  }
  for (const [lab, list] of Object.entries(porLabel)) {
    if (list.length < 2) continue;
    const fontes = list.map(a => a.de || a.categoria || a.chave).filter(Boolean);
    // remove renames duplicados
    for (let i = acoes.length - 1; i >= 0; i--) {
      if (list.includes(acoes[i])) acoes.splice(i, 1);
    }
    acoes.push({
      tipo: 'fundir_categorias',
      de: fontes,
      categoria_label: list[0].categoria_label || list[0].label
    });
  }

  // "recebi Laranjeira" / "caiu o Tylty"
  if (!acoes.some(a => a.tipo === 'confirmar_receita')) {
    const mRec = msg.match(/\b(?:recebi|caiu|entrou)\s+(?:a\s+|o\s+)?(.+?)(?:\s+hoje|\s+ontem)?$/i)
      || msg.match(/\bconfirm[ao]\s+(?:receita|pagamento)\s+(?:d[aeo]\s+)?(.+)$/i);
    if (mRec) {
      const titulo = mRec[1].replace(/[.!?]+$/, '').trim();
      if (titulo.length >= 2 && titulo.length <= 80) {
        const chaves = { laranjeira: 'laranjeira', tylty: 'tylty', lucastylty: 'tylty' };
        const chave = chaves[norm(titulo)] || null;
        acoes.push(chave ? { tipo: 'confirmar_receita', chave } : { tipo: 'confirmar_receita', titulo });
      }
    }
  }

  // "ganhei 4000 no corte" / "receita de infoproduto 1200"
  if (!acoes.some(a => a.tipo === 'criar_receita')) {
    const mVar = msg.match(/\b(?:ganhei|recebi|faturei|vendi)\s+(?:r\$\s*)?(\d+(?:[.,]\d+)?)\s+(?:no|na|em|de|com)\s+(.+)$/i)
      || msg.match(/\breceita\s+(?:de\s+)?(.+?)\s+(?:r\$\s*)?(\d+(?:[.,]\d+)?)$/i);
    if (mVar) {
      let valor;
      let raw;
      if (/^\d/.test(String(mVar[1] || '').trim())) {
        valor = Number(String(mVar[1]).replace(',', '.'));
        raw = String(mVar[2] || '');
      } else {
        raw = String(mVar[1] || '');
        valor = Number(String(mVar[2] || '').replace(',', '.'));
      }
      raw = raw.replace(/[.!?]+$/, '').trim().toLowerCase();
      let chave = 'outro';
      if (/corte|competi|attracione/i.test(raw)) chave = 'cortes';
      else if (/infoprod|curso|ebook|produto/i.test(raw)) chave = 'infoproduto';
      else if (/\bpj\b|mei|servi[cç]o/i.test(raw)) chave = 'pj';
      if (Number.isFinite(valor) && valor > 0) {
        acoes.push({ tipo: 'criar_receita', valor, chave, titulo: raw });
      }
    }
  }

  // "já paguei Netflix" / "paguei a luz"
  if (!acoes.some(a => a.tipo === 'confirmar_despesa')) {
    const mPago = msg.match(/\b(?:j[aá]\s+)?paguei\s+(?:a\s+|o\s+)?(.+?)(?:\s+hoje|\s+ontem)?$/i)
      || msg.match(/\bconfirm[ao]\s+(?:pagamento\s+(?:d[aeo]\s+)?)?(.+)$/i);
    if (mPago) {
      const titulo = mPago[1].replace(/[.!?]+$/, '').trim();
      if (titulo.length >= 2 && titulo.length <= 80) {
        acoes.push({ tipo: 'confirmar_despesa', titulo });
      }
    }
  }

  // "guardei 200 na viagem" / "depositei 50 na meta X"
  if (!acoes.some(a => a.tipo === 'depositar_meta')) {
    const mDep = msg.match(/\b(?:guardei|depositei|botei|coloquei)\s+(?:r\$\s*)?(\d+(?:[.,]\d+)?)\s+(?:na|no|em)\s+(?:meta\s+)?(.+)$/i);
    if (mDep) {
      const valor = Number(String(mDep[1]).replace(',', '.'));
      const nome = mDep[2].replace(/[.!?]+$/, '').trim();
      if (Number.isFinite(valor) && valor > 0 && nome.length >= 2) {
        acoes.push({ tipo: 'depositar_meta', nome, valor });
      }
    }
  }

  // "concluí X" / "terminei a tarefa X"
  if (!acoes.some(a => a.tipo === 'concluir_tarefa')) {
    const mConc = msg.match(/\b(?:conclu[ií]|terminei|fiz)\s+(?:a\s+)?(?:tarefa\s+)?(.+)$/i);
    if (mConc && !/\bacademia\b/i.test(msg) && !/\bpaguei\b/i.test(msg)) {
      const titulo = mConc[1].replace(/[.!?]+$/, '').trim();
      if (titulo.length >= 2 && titulo.length <= 80 && !/^(hoje|ontem|isso)$/i.test(titulo)) {
        acoes.push({ tipo: 'concluir_tarefa', titulo });
      }
    }
  }

  // "DAS pago" / "paguei o DAS"
  if (!acoes.some(a => a.tipo === 'marcar_das')) {
    if (/\bdas\b/i.test(msg) && /\b(paguei|pago|marquei|confirmei)\b/i.test(msg)) {
      acoes.push({ tipo: 'marcar_das', ym: (snap && snap.agora && snap.agora.mes) || undefined, pago: true });
    }
  }

  return acoes;
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
- Finanças: financeiro.d7/d30/mes_atual, ultimas_transacoes (com id), categorias, gastos_por_categoria_30d, saldos_contas, plano_financeiro, despesas_mes, receitas_mes.
- Receita ≠ entrada do banco: receitas_mes é manual (Laranjeira, Tylty, cortes, infoproduto). Entradas do extrato NÃO são receita.
- Confirmações ("já paguei X"): despesas_mes. ("recebi Laranjeira"): confirmar_receita. Receita variável: criar_receita.
- Produtividade: tarefas (hoje, atrasadas, próximos), stats_7d/30d, streak_dias_completos, historico_tarefas_recentes, recorrentes, consistencia_horario (horário médio e desvio por tarefa).
- Agenda: eventos_proximos, alarmes.
- Hábitos: só Academia (feito_hoje, semana e mês).
- Confirmações ("já paguei X"): diga o status em despesas_mes ou nas transações; se não achar, diga que não encontrou.

Ações (quando o usuário pedir pra fazer algo no app — VOCÊ executa; NÃO mande ele ir na tela manualmente):
- registrar pendência/dívida/despesa/tarefa/meta → criar_*
- "já paguei X" / confirmar conta → confirmar_despesa
- "recebi Laranjeira/Tylty" / confirmar renda fixa → confirmar_receita
- registrar receita variável (corte, infoproduto, PJ) → criar_receita
- "guardei R$Y na meta Z" → depositar_meta
- "concluí a tarefa X" → concluir_tarefa
- "fui na academia" → marcar_habito
- criar evento/alarme → criar_evento / criar_alarme
- lançar entrada/saída manual → criar_transacao
- apagar tx / corrigir data de tx → deletar_transacao / corrigir_data_tx
- DAS pago → marcar_das
- criar/renomear/unificar/recategorizar categorias → ações de categoria
- Preferir ids do contexto (despesas_mes.itens[].id, receitas_mes.itens[].id, metas[].id, tarefas.*.id, ultimas_transacoes[].id)
- Se faltar dado essencial, pergunte e NÃO emita ação

Responda APENAS um JSON válido completo:
{"resposta":"texto em markdown simples (máx 160 palavras). Use **negrito** em números-chave.","acoes":[]}

Tipos de ação:
- {"tipo":"criar_despesa","titulo":"...","valor_esperado":123.45,"dia_vencimento":15,"categoria":"contas_fixas|moradia|outros"}
- {"tipo":"confirmar_despesa","titulo":"Netflix"} ou {"tipo":"confirmar_despesa","id":"..."}
- {"tipo":"confirmar_receita","titulo":"Laranjeira"} ou {"tipo":"confirmar_receita","chave":"tylty","valor":1000}
- {"tipo":"criar_receita","titulo":"Attracione","valor":4000,"chave":"cortes","recebido_em":"YYYY-MM-DD"}
- {"tipo":"criar_tarefa","titulo":"...","prioridade":"alta|media|baixa","data_reset":"YYYY-MM-DD"}
- {"tipo":"concluir_tarefa","titulo":"..."} ou {"tipo":"concluir_tarefa","id":"..."}
- {"tipo":"criar_meta","nome":"...","valor_total":1000,"prazo":"YYYY-MM-DD"|null}
- {"tipo":"depositar_meta","nome":"Viagem","valor":200}
- {"tipo":"marcar_habito","titulo":"Academia"}
- {"tipo":"criar_evento","titulo":"...","data":"YYYY-MM-DD","hora":"HH:MM"|null}
- {"tipo":"criar_alarme","hora":"07:30","mensagem":"..."}
- {"tipo":"criar_transacao","tipo_tx":"entrada|saida","valor":50,"descricao":"...","data":"YYYY-MM-DD","categoria":"outros"}
- {"tipo":"deletar_transacao","ids":["uuid"]} ou com "filtros"
- {"tipo":"corrigir_data_tx","data":"YYYY-MM-DD","ids":["uuid"]} ou com "filtros"
- {"tipo":"marcar_das","ym":"2026-08","pago":true,"valor":null}
- {"tipo":"criar_categoria","categoria_label":"Apostas - Amigos"}
- {"tipo":"renomear_categoria","de":"alimentacao","categoria_label":"Mercado"}
- {"tipo":"fundir_categorias","de":["pai","mae"],"categoria_label":"Pai e Mãe"}
- {"tipo":"recategorizar","categoria_label":"...","ids":["uuid"]} ou "filtros":{"data":"YYYY-MM-DD","valores":[250],"contem":["ERIK"]}

Regras:
- "resposta" é o texto que o usuário lê — nunca JSON cru. Confirme o que foi feito.
- NUNCA diga que fez se não emitir a ação em "acoes".
- "unifica/funde" → fundir_categorias (não renomear as duas pro mesmo label).
- "já paguei / confirmo pagamento" → confirmar_despesa.
- "recebi / caiu (Laranjeira, Tylty…)" → confirmar_receita. NÃO use criar_transacao entrada pra isso.
- receita variável (corte, infoproduto) → criar_receita.
- Use ids do contexto quando existir.
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
    const acoesMerged = inferirAcoesDaMensagem(mensagem, snap, parsed && parsed.acoes);
    const acoesExec = await executarAcoes(acoesMerged);
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
