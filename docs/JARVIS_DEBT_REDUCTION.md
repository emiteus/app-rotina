# JARVIS Debt reduction (item 3) — v0.8.0

**Date:** 2026-09-17  
**Status:** IMPLEMENTED

## Shipped

1. **Handlers extract** — `executarAcoesCorpo` → `lib/jarvis/tools/handlers.js` (~1k lines fora de `ia.js`)
2. **WA multi-user** — `WHATSAPP_PHONE_USERS=fone:login` (`lib/jarvis/whatsapp-users.js`); senão whitelist → owner
3. **Assist OS panel** — pills + “Detalhes” com cards projetos/sistema
4. **Missão batch** — `executa missão` / `roda tudo` com pings `⏳` no WA (`JARVIS_MISSION_PROGRESS`)
5. **CineRush Editor** — no registry como `wired: false` (explícito “não ligado”)

## Still later (não bloqueia)

- Split handlers por domínio (finance/ops/…)
- Dashboard Assist fullscreen
- Ligar editor de vídeo CineRush de verdade (quando API existir)

## Config

```
WHATSAPP_PHONE_USERS=5584XXXXXXXXX:teus,5584YYYYYYYYY:maria
JARVIS_MISSION_PROGRESS=1
```
