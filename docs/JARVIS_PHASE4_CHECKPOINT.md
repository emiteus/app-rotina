# JARVIS Phase 4 Checkpoint — Context & Memory v1

**Date:** 2026-09-17  
**Status:** IMPLEMENTED — awaiting production validation

## What shipped

1. **Context pack** (`lib/jarvis/context/`)
   - `detectIntent` — greeting / finance / tasks / habits / projects / status / mixed / general
   - `packContext(snap, msg, prefs)` — slim JSON for the LLM (full snap still used for local `inferirAcoes`)
   - Log `tag=jarvis.context` com `charsFull`, `charsPack`, `savedPct`
2. **Assist snapshot cache** — `getCachedAssistSnap` TTL **20s** (`JARVIS_ASSIST_CACHE_MS`)
   - Invalidado após qualquer tool ok (junto com projetos se `mutatesProjetos`)
3. **Episodic memory v1** (`lib/jarvis/memory/episodic.js`)
   - Notas em `jarvis_prefs.extras.notas` (“lembra que…”, “anota que…”)
   - Tom: `extras.tom` = `direto` | `detalhado`
   - Injetadas no system prompt + pack (`memoria.notas`)

## What did NOT change

- Action handlers / tool tipos
- Full snap shape for local inference
- HITL / missions (Phases 5 / 7)

## Validate

1. “oi” → `jarvis.context` com `intent":"greeting"` e `savedPct` alto
2. “quanto gastei esse mês” → `intent":"finance"`; resposta coerente
3. “lembra que o DAS vence todo dia 20” → confirma; depois “quando é o DAS?” usa a nota
4. Duas msgs rápidas sem mutação → 2ª pode hit assist cache (menos DB)

## Next (Phase 5 candidate)

Permission Engine + HITL para tools `needsApproval` (risk ≥ high).

## Rollback

Prompt voltar a `JSON.stringify(snap)`; remover pack/cache assist/memory requires.
