const express = require('express');
const axios = require('axios');
const { all } = require('../lib/db');

const router = express.Router();

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';

// gemini-2.5-flash-lite tem free tier mais amplo (15 RPM / 1k RPD / 250k TPM).
// Pra este uso (classificar + parse + resumir), a qualidade é equivalente ao 2.0-flash.
const GEMINI_MODEL = 'gemini-2.5-flash-lite';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

function providerAtivo() {
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return null;
}

// Helper único: chama Gemini (grátis) ou Anthropic (fallback) e devolve
// { texto: string, usage: object }. jsonMode=true força resposta em JSON.
async function chamarIA({ system, user, maxTokens = 300, jsonMode = false }) {
  const prov = providerAtivo();
  if (!prov) throw new Error('Nenhuma API key configurada (GEMINI_API_KEY ou ANTHROPIC_API_KEY).');

  if (prov === 'gemini') {
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: maxTokens,
        ...(jsonMode ? { responseMimeType: 'application/json' } : {})
      }
    };
    const resp = await axios.post(
      `${GEMINI_URL}?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`,
      body,
      { headers: { 'content-type': 'application/json' }, timeout: 20000 }
    );
    const texto = (resp.data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    return { texto, usage: resp.data?.usageMetadata, provider: 'gemini', model: GEMINI_MODEL };
  }

  // Anthropic (fallback)
  const resp = await axios.post(
    ANTHROPIC_URL,
    {
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }]
    },
    {
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      timeout: 20000
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

module.exports = router;
