# JARVIS Roadmap — status

**Version:** 0.9.10  
**Date:** 2026-09-18

## Norte

Ver **[JARVIS_GAP_MAP_3.0.md](./JARVIS_GAP_MAP_3.0.md)** — gap por camada + plano **30/60/90**.

### Princípio

**Conexão real > atalhos NL.**

## Done (código)

- Fundação + missões + Milhão Railway
- Dev Agent + Research Agent (respostas curtas)
- Mission Mode polish (pings compactos + ultima_falha)
- **Orchestrator v1:** `agents/orchestrator.js` escolhe Dev/Research/Finance/Ops/Rotina + hint multi-braço
- **Write #1:** `dev_railway_redeploy` (`critical` — HITL sempre, inclusive WA)

## Etapa atual

Smoke redeploy no WA:

```
redeploy milhão
```

→ deve pedir **SIM** antes de chamar Railway. Depois: `diagnostica o milhão` / logs.

## Próximo

1. Smoke `dev_railway_redeploy` + SIM  
2. Mais write tools (restart service, env bump) com mesma regra critical  
3. Vision v2 / proatividade  

## Not started

- Creative / TTS  
- Coding agent full (patch+test+deploy)  
