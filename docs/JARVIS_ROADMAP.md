# JARVIS Roadmap — status

**Version:** 0.9.56  
**Date:** 2026-09-20

## Norte

Ver **[JARVIS_GAP_MAP_3.0.md](./JARVIS_GAP_MAP_3.0.md)**.

### Princípio

**Conexão real > atalhos NL.**  
**Capacidade geral > gambiarra de domínio** (sem catálogo hardcode de times/marcas).

## Done

- **0.9.56**: Commons fetch resiliente (candidatos + retry 429 + sem half-pair) + erase white no compose
- **0.9.55**: compositor pixel (`compose.js`) — detect slots + sharp paste; Gemini só fallback
- **0.9.54**: `visual-assets` — resolve logo/crest por **busca Commons** (Nike, Palmeiras, …); remove catálogo de clubes
- **0.9.53–0.9.49**: layout reproduce (fidelidade + paste de assets)
- **0.9.48**: Vision blueprint JSON

## Smoke

WA: `reproduz layout com escudo do X e Y` → Commons (retry) → **compose paste**

## Backlog (só sob pedido)

- Browser headless / SPA  
- Deploy automático pós-PR  
- Embeddings reais / workers isolados  
