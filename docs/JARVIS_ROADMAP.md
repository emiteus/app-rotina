# JARVIS Roadmap — status

**Version:** 0.9.12  
**Date:** 2026-09-18

## Norte

Ver **[JARVIS_GAP_MAP_3.0.md](./JARVIS_GAP_MAP_3.0.md)** — gap por camada + plano **30/60/90**.

### Princípio

**Conexão real > atalhos NL.**

## Done (código)

- Fundação + missões + Milhão Railway
- Dev Agent + Research Agent (respostas curtas)
- Mission Mode polish (pings compactos + ultima_falha)
- **Orchestrator v1**
- **Write #1–2:** `dev_railway_redeploy` + `dev_railway_restart` (critical HITL)
- **Proativo:** Railway FAIL/CRASH → ping WA (cron 15min, dedupe, sem auto-ação)

## Etapa atual

Espera deploy do app-rotina. Smoke opcional: forçar fail num service de staging **ou** `POST /api/ia/proactive/sweep` e olhar notes `railway_deploy_fail`.

## Próximo

1. Smoke railway-watch (ou confiar no cron em prod)  
2. Vision v2 — PDF/screenshot → achados  
3. Segundo alerta proativo (fila editor / crédito Havok — já parcial no sweep)

## Not started

- Creative / TTS  
- Coding agent full (patch+test+deploy)  
