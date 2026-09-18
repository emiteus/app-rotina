# JARVIS Roadmap — status

**Version:** 0.9.6  
**Date:** 2026-09-18

## Norte

Ver **[JARVIS_GAP_MAP_3.0.md](./JARVIS_GAP_MAP_3.0.md)** — gap por camada + plano **30/60/90**.

### Princípio (v0.9.6+)

**Conexão real > atalhos NL.**  
Caminho canônico: `catalog → connector → snapshot → pack → TOOL_DEFS → LLM`.  
Não empilhar `formatar*` / regex de resposta pra projeto. Guardas de honesty (ex. contagem≠coleta) ok; FAQ de comandos não.

## Done (código)

- Phases 1–11 (Core → polish)
- HITL canal-bound; WA sem confirmação por default
- Host bridge + probe WA
- Memória de projetos + briefs ecossistema
- Ops honesty + CineRush criar≠provision + Cutflix health
- Attracione/Editor/SocialHub `hoje` no **snapshot** (contrato estável)
- Cache bypass pós-coleta + `snapshot_refresh` (tool, não atalho de resposta)
- `toolsPromptBlock()` — descriptions das tools no prompt (fonte única)
- Pack sempre inclui wired set (incl. cutflix)
- Removidos early-returns `formatar*` de projeto no host

## Próximo (conexão)

1. Reachability: `PROJETO_MILHAO_URL` / Clipper túnel (env, não código)
2. Smoke WA honesty sem `provider: local` em Q&A de projetos
3. Cutflix ops quando API admin existir
4. Research agent (dia 31–60)

## Manual (você)

Ver **[JARVIS_MANUAL.md](./JARVIS_MANUAL.md)**.  
Envs: `CUTFLIX_API_URL`, `PROJETO_MILHAO_URL` (túnel → `:4410`).

## Not started / blocked

- Clipper — off até túnel  
- Research/Dev agents — dia 60  
- Creative / Voice TTS — pós-90  
