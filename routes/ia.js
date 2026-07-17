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

module.exports = router;
