# JARVIS Phase 2 Checkpoint — AI Gateway + Snapshot Cache

**Date:** 2026-09-17  
**Status:** IMPLEMENTED — awaiting production validation

## What shipped

1. **`lib/jarvis/ai-gateway.js`**
   - Gemini preferido; se saturado/timeout **e** `ANTHROPIC_API_KEY` existir → fallback Anthropic
   - Log estruturado `tag=jarvis.ai` (provider, model, durationMs, tokens)
   - Log de fallback `event=fallback` quando troca de provider
2. **`lib/jarvis/snapshot-cache.js`**
   - Cache in-memory de snapshots de projetos (**45s**, override `JARVIS_SNAPSHOT_CACHE_MS`)
   - `invalidateProjetosCache(userId)` após mutações (CineRush/Chatwoot/Attracione/SocialHub/Clipper)
3. **`routes/ia.js`**
   - `chamarIA` / `providerAtivo` / `mensagemGemini` vêm do gateway (sem duplicar)
   - Bloco `projetos` do snapshot usa `getCachedProjetos`

## What did NOT change

- Prompt, action types, Core façade, debounce WhatsApp
- Comportamento da API pública de chat

## Validate

1. Railway logs em pedido normal: `"tag":"jarvis.ai","provider":"gemini",...`
2. (Opcional) Sem Gemini / Gemini 429: linha `event":"fallback"` + reply via Anthropic
3. Duas mensagens WA seguidas pedindo status dos projetos: 2ª deve ser mais rápida (cache hit; sem re-bater 4 backends)
4. Após “provisionar assinante” / “disparar coleta”: próximo snapshot deve refetch (cache invalidado)

## Next (Phase 3 candidate)

Tool registry + missions — só depois deste checkpoint verde.

## Rollback

Reverter imports em `ia.js` para funções locais; apagar `ai-gateway.js` / `snapshot-cache.js` se necessário.
