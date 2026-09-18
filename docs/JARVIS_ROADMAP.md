# JARVIS Roadmap — status

**Version:** 0.9.7  
**Date:** 2026-09-18

## Norte

Ver **[JARVIS_GAP_MAP_3.0.md](./JARVIS_GAP_MAP_3.0.md)** — gap por camada + plano **30/60/90**.

### Princípio (v0.9.6+)

**Conexão real > atalhos NL.**  
Caminho canônico: `catalog → connector → snapshot → pack → TOOL_DEFS → LLM`.

## Done (código)

- Phases 1–11 + memória + honesty + ecossistema wired
- Conexão real (v0.9.6): tools no prompt, sem `formatar*` de projeto
- Projeto Milhão 24/7 no Railway
- **Mission Mode wrap (v0.9.7):** progresso N/M, steps `kind`, auto-continue após SIM, `ultima_falha` no planner/retry, proactive em missão falha, probe `--smoke-mission`

## Etapa atual do plano

**Wrap dias 1–30 → item 7 parcial (missões).**  
Próxima etapa do Gap Map: **escolher trilho 31–60** (Research Agent **ou** Dev/Ops Agent) — um só.

## Manual (você)

Ver **[JARVIS_MANUAL.md](./JARVIS_MANUAL.md)**.  
Smoke missão: `railway run node scripts/jarvis-wa-probe.js --smoke-mission`

## Not started / blocked

- Clipper — off até túnel  
- Research/Dev agents — dia 31–60  
- Orchestrator / Vision v2 / permission matrix doc — dia 61–90  
- Creative / Voice TTS — pós-90  
