# JARVIS Roadmap — status

**Version:** 0.9.9  
**Date:** 2026-09-18

## Norte

Ver **[JARVIS_GAP_MAP_3.0.md](./JARVIS_GAP_MAP_3.0.md)** — gap por camada + plano **30/60/90**.

### Princípio

**Conexão real > atalhos NL.**

## Done (código)

- Fundação 1–30 + missões wrap (v0.9.7)
- Milhão 24/7 Railway
- **Dev/Ops Agent (v0.9.8):** tools `dev_*` + agente `dev`
- **Research Agent (v0.9.9):** tools `research_*` + agente `research` (respostas curtas no WA)
- **Mission Mode polish:** progresso compacto no WA, steps tipados, `ultima_falha` no advance/retry, HITL resume com `onProgress`

## Etapa atual

**Mission Mode polish** — smoke WA:

```
missão: diagnostica o milhão
status missão
executa missão
```

Espera: pings `Passo k/n · ok · \`dev_diagnose\`` (não board spam); board só no fim / status.

## Próximo

1. Smoke missão no WA  
2. Dia 61+: orchestrator (escolhe Dev vs Research por intent)  
3. Write/deploy tools (sempre APPROVAL)

## Not started

- Vision v2 / TTS / Creative  
- Orchestrator multi-agent  
- Coding agent full (patch+test+deploy)  
