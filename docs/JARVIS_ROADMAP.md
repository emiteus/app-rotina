# JARVIS Roadmap — status

**Version:** 0.9.24  
**Date:** 2026-09-19

## Norte

Ver **[JARVIS_GAP_MAP_3.0.md](./JARVIS_GAP_MAP_3.0.md)** — gap por camada + plano **30/60/90**.

### Princípio

**Conexão real > atalhos NL.**

## Done (código)

- Hub completo + Creative + Coding v1/v2
- **Browser v1:** `browser_open` · `browser_links` (HTTP fetch SSRF-safe, sem Playwright)

## Etapa atual

Smoke browser:

```
abre https://example.com
lista links de https://example.com
```

(hosts fora da allowlist: `RESEARCH_FETCH_ALLOWLIST` ou `RESEARCH_FETCH_OPEN=1`)

## Próximo

1. Browser v2 (headless/JS) — sob pedido  
2. Missão “lançar produto” — sob pedido  
3. Deploy auto pós-PR — sob pedido  

## Not started

- Browser headless / SPA click  
- Missão “lançar produto” completa  
- Deploy automático pós-PR  
