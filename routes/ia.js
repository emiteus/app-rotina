const express = require('express');
const axios = require('axios');
const { all } = require('../lib/db');

const router = express.Router();

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';

function temKey() {
  return !!process.env.ANTHROPIC_API_KEY;
}

router.get('/status', (req, res) => {
  res.json({ ok: true, disponivel: temKey(), model: MODEL });
});

// POST /api/ia/categorizar
// Body: { descricao (obrigatório), valor?, tipo?, banco?, exemplo? }
// Response: { categoria: "id", confianca: 0-100, motivo: "..." }
router.post('/categorizar', async (req, res) => {
  if (!temKey()) return res.status(400).json({ erro: 'ANTHROPIC_API_KEY não configurada.' });
  const desc = String((req.body && req.body.descricao) || '').trim();
  if (!desc) return res.status(400).json({ erro: 'descricao é obrigatória' });

  const valor = req.body?.valor;
  const tipo = req.body?.tipo;
  const banco = req.body?.banco;
  const exemplo = req.body?.exemplo;

  try {
    const cats = await all(`SELECT chave, label FROM categorias ORDER BY label`);
    if (cats.length === 0) return res.status(400).json({ erro: 'Nenhuma categoria cadastrada.' });

    const listaCategorias = cats.map(c => `- ${c.chave}: ${c.label}`).join('\n');

    const contexto = [
      `Descrição do usuário: "${desc}"`,
      exemplo ? `Descrição bruta do banco: "${exemplo}"` : null,
      valor != null ? `Valor: R$ ${Number(valor).toFixed(2).replace('.', ',')}` : null,
      tipo ? `Tipo: ${tipo}` : null,
      banco ? `Banco: ${banco}` : null
    ].filter(Boolean).join('\n');

    const systemPrompt = `Você é um classificador de transações financeiras pessoais em português brasileiro. Escolha EXATAMENTE UMA categoria da lista fornecida com base na descrição.

Categorias disponíveis (use o valor da esquerda como "categoria"):
${listaCategorias}

Regras:
- A resposta DEVE ser apenas um JSON válido, sem markdown, sem texto extra.
- Campo "categoria": um dos ids da lista acima.
- Campo "confianca": inteiro 0-100 (quão certo você está).
- Campo "motivo": explicação curta em 1 linha (máx 80 caracteres), em português.

Formato exato:
{"categoria":"id","confianca":85,"motivo":"..."}`;

    const anthropicResp = await axios.post(
      ANTHROPIC_URL,
      {
        model: MODEL,
        max_tokens: 200,
        system: systemPrompt,
        messages: [{ role: 'user', content: contexto }]
      },
      {
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        timeout: 15000
      }
    );

    const txt = (anthropicResp.data?.content?.[0]?.text || '').trim();
    let parsed;
    try {
      const jsonStr = txt.replace(/^```json\s*|\s*```$/g, '').trim();
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      return res.status(502).json({ erro: 'Resposta da IA em formato inválido', raw: txt });
    }

    const catExiste = cats.find(c => c.chave === parsed.categoria);
    if (!catExiste) {
      return res.status(502).json({ erro: `Categoria "${parsed.categoria}" não existe`, raw: txt });
    }

    res.json({
      categoria: parsed.categoria,
      label: catExiste.label,
      confianca: Math.max(0, Math.min(100, Number(parsed.confianca) || 0)),
      motivo: String(parsed.motivo || '').slice(0, 120),
      usage: anthropicResp.data?.usage
    });
  } catch (err) {
    const status = err.response?.status || 500;
    const msg = err.response?.data?.error?.message || err.message;
    res.status(status).json({ erro: msg });
  }
});

// POST /api/ia/metas/parse
// Body: { texto: "Quero cadeira gamer R$ 2500 até dez 2026" }
// Response: { nome, valor_total, prazo (YYYY-MM-DD|null), prioridade (1-5), motivo }
router.post('/metas/parse', async (req, res) => {
  if (!temKey()) return res.status(400).json({ erro: 'ANTHROPIC_API_KEY não configurada.' });
  const texto = String(req.body?.texto || '').trim();
  if (!texto) return res.status(400).json({ erro: 'texto é obrigatório' });

  const hoje = new Date().toISOString().slice(0, 10);
  const systemPrompt = `Você extrai dados estruturados de descrições de metas financeiras pessoais em português brasileiro. Hoje é ${hoje}.

Regras estritas:
- Responda APENAS com JSON válido, sem markdown, sem texto extra.
- Formato: {"nome":"...","valor_total":123.45,"prazo":"YYYY-MM-DD"|null,"prioridade":1-5,"motivo":"..."}

Campos:
- "nome": título curto da meta (3-40 chars). Ex: "Cadeira gamer", "Viagem pra Europa", "Reserva de emergência".
- "valor_total": número positivo em reais (R$ 1.500 → 1500, R$ 2,5 mil → 2500). Se não mencionado, retorne null.
- "prazo": data ISO YYYY-MM-DD. Se mencionar data específica ("até dezembro", "em 6 meses", "final de 2026"), calcule a partir de hoje. Se não mencionar prazo, null.
- "prioridade": inteiro 1 (baixa) a 5 (alta). Default 3. Palavras como "urgente", "prioritário" → 5. "quando puder" → 2.
- "motivo": frase curta em português explicando a extração (máx 80 chars).

Exemplos:
"quero cadeira gamer de 2500 até dezembro" → {"nome":"Cadeira gamer","valor_total":2500,"prazo":"2026-12-31","prioridade":3,"motivo":"prazo dezembro assumido como último dia"}
"juntar 10 mil pra viagem" → {"nome":"Viagem","valor_total":10000,"prazo":null,"prioridade":3,"motivo":"sem prazo mencionado"}
"reserva de emergencia urgente 5000" → {"nome":"Reserva de emergência","valor_total":5000,"prazo":null,"prioridade":5,"motivo":"marcado urgente"}`;

  try {
    const anthropicResp = await axios.post(
      ANTHROPIC_URL,
      {
        model: MODEL,
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: 'user', content: texto }]
      },
      {
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        timeout: 15000
      }
    );

    const txt = (anthropicResp.data?.content?.[0]?.text || '').trim();
    let parsed;
    try {
      const jsonStr = txt.replace(/^```json\s*|\s*```$/g, '').trim();
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      return res.status(502).json({ erro: 'Resposta da IA em formato inválido', raw: txt });
    }

    const nome = String(parsed.nome || '').trim();
    if (!nome || nome.length < 2) return res.status(502).json({ erro: 'IA não conseguiu extrair um nome válido', raw: txt });

    const valor = parsed.valor_total;
    if (valor !== null && (typeof valor !== 'number' || !isFinite(valor) || valor <= 0)) {
      return res.status(502).json({ erro: 'IA não extraiu um valor válido', raw: txt });
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
      usage: anthropicResp.data?.usage
    });
  } catch (err) {
    const status = err.response?.status || 500;
    const msg = err.response?.data?.error?.message || err.message;
    res.status(status).json({ erro: msg });
  }
});

module.exports = router;
