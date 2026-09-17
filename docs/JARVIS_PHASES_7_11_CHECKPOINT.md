# JARVIS Phases 7–11 Checkpoint

**Date:** 2026-09-17  
**Status:** IMPLEMENTED — awaiting production validation

## Phase 7 — Mission + Planner

- Tabela `jarvis_missions` + status machine
- Comandos: `missão: …`, `status missão`, `próximo passo`, `cancela missão`, `lista missões`
- Planner heurístico (sync bancos, reconciliar, coleta, backup, SocialHub, academia…)
- HITL ainda vale nos passos high-risk
- API: `GET /api/ia/missions`

## Phase 8 — Multimodal

- `lib/jarvis/multimodal/ingress.js` — áudio/imagem → texto (Gemini Vision/STT)
- WhatsApp webhook passa `media` → Core → ingress
- Fallback: pede texto se não conseguir ler

## Phase 9 — Agents

- Personas: `default`, `finance`, `ops`, `research`, `rotina`
- Explícito: `agente ops: …` ou `/finance …`
- Auto-pick por intent

## Phase 10 — Proactivity

- Event bus `jarvis.event`
- Sweep a cada 3h: aprovação pendente / missão / env parcial
- Só notifica WA em `warn` — **nunca** executa tool HIGH
- Manual: `POST /api/ia/proactive/sweep`
- `JARVIS_PROACTIVE_WA=0` desliga WA

## Phase 11 — OS polish

- `GET /api/ia/os` — dashboard JSON (phases, tools, projects, agents, budget)
- Budget diário in-memory (`JARVIS_DAILY_CALL_BUDGET` / `TOKEN`)
- Gateway respeita budget (HTTP 429)

## Validate (smoke)

1. `missão: sincronizar bancos e reconciliar` → cria passos → `próximo passo`
2. Foto no WA com legenda → log `jarvis.multimodal`
3. `agente finance: quanto gastei` → agent finance no turn log
4. `GET /api/ia/os` autenticado → `phases.* = true`
5. Aprovação pendente + cron → aviso WA (se warn)

## Roadmap residual (não bloqueante)

- Planner LLM (não só heurística)
- STT dedicado (Whisper) se Gemini áudio falhar
- Budget persistido em Postgres
- UI dashboard no Assist web
- Botões Evolution p/ HITL

## Rollback

Feature flags: `JARVIS_PROACTIVE_WA=0`, budgets `0`, não usar comandos de missão.
