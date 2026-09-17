# JARVIS Phase 6 Checkpoint — Project Registry

**Date:** 2026-09-17  
**Status:** IMPLEMENTED — awaiting production validation

## What shipped

1. **`lib/jarvis/projects/catalog.js`** — metadados: id, name, aliases, env, toolPrefixes, connector
2. **`lib/jarvis/projects/registry.js`**
   - `resolveProject` / `resolveProjectsFromMessage` (NL → id)
   - `loadAllProjectSnapshots` (connectors via registry)
   - `getRegistryStatus` / `getRegistryPromptBlock` (sem secrets)
   - `toolsForProject`
3. **Intent** usa registry p/ `projectHints` (cine, havok, attra, teushub, vortex…)
4. **Context pack** inclui `registry[]` lite
5. **Snapshot owner** carrega projetos pelo registry (não mais hardcode 4 requires)
6. Prompt lista registry com aliases; `/api/ia/status` → `projects`

## Projects

| id | aliases (amostra) |
|----|-------------------|
| approtina | rotina, atlas, hub |
| cinerush | cine, havok, kirvano, chatwoot |
| attracione | attra, ranking, coleta |
| socialhub | teushub, posts |
| clipper | vortex, clip |
| evolution | whatsapp, wa, zap |

## Validate

1. “quais módulos” / “status dos projetos” → lista via registry ON/off
2. “como tá o cine” / “havok” → intent projects + hint `cinerush`
3. `GET /api/ia/status` → array `projects` com `conectado`

## Next (Phase 7 candidate)

Mission + Planner (single-agent) — table + step state machine.

## Rollback

Voltar loader hardcode em `snapshotAssistente` + prompt antigo de módulos.
