# JARVIS Roadmap — status

**Version:** 0.9.35  
**Date:** 2026-09-20

## Norte

Ver **[JARVIS_GAP_MAP_3.0.md](./JARVIS_GAP_MAP_3.0.md)**.

### Princípio

**Conexão real > atalhos NL.**

## Done

- Trilho 61–90 **fechado**: #9 orchestrator · #10 Vision · #11 proativo · **#12 permission matrix**
- Matrix AUTO / APPROVAL / BLOCKED no Manual; `npm run check:tools` valida criticals listados
- **Auditoria 0.9.34–0.9.35**: reuse de aprovação trocava a ação errada · TTL agora vale no `SIM <id>` ·
  `JARVIS_HITL=0` não desliga mais `critical` · missão não trava em `running` quando a tool lança ·
  redirect revalidado no `enrichHits` · finance não esconde falha de sync · GAP_MAP §1–2 atualizado.
  Risco aceito documentado no GAP_MAP §8.

## Smoke

Local: `npm run smoke` (16 checks) · `npm run check:tools`  
Isolados (mockam `require('host')`): `npm run smoke:approvals` · `node scripts/smoke-mission-fail.js`

WA: `prepara landing do cutflix` → `mete marcha`

## Backlog (só sob pedido)

- Browser headless / SPA  
- Deploy automático pós-PR  
- Extrair reconciler WA  
- Vision JSON schema Gemini  
