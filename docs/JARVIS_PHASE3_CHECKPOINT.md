# JARVIS Phase 3 Checkpoint — Tool Registry

**Date:** 2026-09-17  
**Status:** IMPLEMENTED — awaiting production validation

## What shipped

1. **`lib/jarvis/tools/definitions.js`** — catálogo de todos os `tipo`s atuais com:
   - `risk` (`low` | `medium` | `high` | `critical`)
   - `timeoutMs`
   - `ownerOnly` / `mutatesProjetos`
   - `description`
2. **`lib/jarvis/tools/registry.js`** — `getTool` / `listToolNames` / `getToolCatalog` / `needsApproval`
3. **`lib/jarvis/tools/index.js`** — `runToolBatch`:
   - max 8 tools/turn
   - timeout do batch = max(timeouts dos tools)
   - logs `tag=jarvis.tool` por tool + evento `batch`
   - invalida snapshot cache via flag `mutatesProjetos` (não mais Set hardcoded)
4. **`routes/ia.js`**
   - `executarAcoes` → `runToolBatch` → `executarAcoesCorpo` (handlers legados intactos)
   - `GET /api/ia/status` inclui `tools` count + `toolsHighRisk`

## What did NOT change

- Prompt, action payloads, UX WhatsApp/Web
- Corpo dos handlers (ainda if/else em `ia.js`) — extract gradual fica pra depois
- Sem HITL ainda (Phase 5); `needsApproval` só marca risco ≥ high

## Validate

1. Qualquer ação (ex.: concluir tarefa): Railway log `"tag":"jarvis.tool","tipo":"concluir_tarefa",...`
2. Fim do turn: `"event":"batch","count":N`
3. `GET /api/ia/status` → `tools` ≈ 35+, `toolsHighRisk` lista provisionar/coleta/etc.
4. Comportamento de ações = igual à Phase 2

## Next (Phase 4 candidate)

Context & Memory v1 — snapshot summarizer + prefs expansion (cache já existe).

## Rollback

`executarAcoes` voltar a chamar o corpo direto; apagar `lib/jarvis/tools/`.
