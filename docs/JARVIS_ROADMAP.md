# JARVIS Roadmap — status

**Version:** 0.9.48  
**Date:** 2026-09-20

## Norte

Ver **[JARVIS_GAP_MAP_3.0.md](./JARVIS_GAP_MAP_3.0.md)**.

### Princípio

**Conexão real > atalhos NL.**

## Done

- Trilho 61–90 **fechado** + auditoria HITL (0.9.34–0.9.35)
- Landing copy real (0.9.36–0.9.39)
- Quarentena externo · owner gate · mission CAS (0.9.40–0.9.42)
- **0.9.48**: Vision “reproduz esse layout” → blueprint JSON (zonas / hierarquia / CTAs)
- **0.9.47**: agent `toolPrefixes` gate — research/dev/browser/creative não vazam tools fora do escopo
- **0.9.46**: recall semântico lexical → `pack.recall_semantico` (overlap; sem embeddings)
- **0.9.45**: higiene de histórico — topic switch + scrub `[CONTEÚDO EXTERNO]` antes da decisão
- **0.9.44**: recall temporal (`semana passada` / ontem / últimos N dias) → `pack.recall_temporal`
- **0.9.43**: fecha §8 — realpath no patch · redact logs Railway · `RESEARCH_FETCH_OPEN` bloqueado em prod

## Smoke

Local: `npm run smoke` · `npm run check:tools`

WA: print + `reproduz esse layout` → blueprint; `prepara landing do cutflix` → `mete marcha`

## Backlog (só sob pedido)

- Browser headless / SPA  
- Deploy automático pós-PR  
- Extrair reconciler WA  
- Embeddings reais / workers isolados (subprocess)  
