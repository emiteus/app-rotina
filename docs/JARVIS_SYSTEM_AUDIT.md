# JARVIS System Audit

**Date:** 2026-09-17  
**Scope:** `app-rotina` (brain + interfaces) + connected project modules (CineRush, Attracione, SocialHub, Clipper, Evolution)  
**Mode:** Read-only architecture audit — no code changes in this phase  
**Author role:** Master Architect / CTO

---

## Executive Summary

JARVIS today is **not** a personal AI OS. It is a **high-capability personal chatbot** bolted onto App Rotina:

- One shared brain: `processarChat` in `routes/ia.js`
- Two interfaces: Web Assist (`/api/ia/chat`) and WhatsApp (Evolution webhook)
- Intelligence = **one fat system prompt** + **JSON action list** + **regex heuristics** + **hardcoded executors**
- Project ops (CineRush, Attracione, SocialHub, Clipper) are **owner-only HTTP clients**, not a tool registry
- Memory = last ~12 DB messages + prefs table + full lite snapshot every turn
- No planner, no missions, no agents, no approval workflow, no observability layer, no multimodal understanding

**Verdict:** Strong foundation for *personal ops via chat*. Weak foundation for *AI Operating System* without a deliberate core extraction. Evolution > rewrite is feasible if we extract a JARVIS Core behind adapters.

**Current maturity (0–5):**

| Layer | Score | Notes |
|-------|------:|-------|
| Interface (WhatsApp/Web) | 3 | Works; WA text-only; debounce latency |
| Reasoning (LLM) | 2 | Monolithic prompt; no gateway |
| Tools | 2 | Hardcoded `tipo` switch; works for Rotina |
| Memory | 1 | Chat history + prefs only |
| Agents / Missions | 0 | Absent |
| Permissions | 1 | Owner gate + WA whitelist; no risk levels |
| Observability | 1 | `console.log` / Railway logs |
| Security | 2 | Session auth OK; webhook secret optional; prompt injection unmitigated |

---

## Current Architecture

### What the product is

App Rotina is a **Node/Express monolith** (Postgres, session cookies, WebSocket, Electron shell, Railway deploy) for:

- Tasks, habits, ranking
- Personal finance + Open Finance (Pluggy)
- Goals, alarms, events, MEI DAS
- Multi-user (small, typically 2) with owner privileges

JARVIS is the **assistant layer** on top of that monolith, not a separate service.

### Runtime shape

```
┌─────────────────────────────────────────────────────────────┐
│  Railway: single Node process (API + crons + WS)            │
│  server.js                                                  │
├─────────────────────────────────────────────────────────────┤
│  Interfaces                                                 │
│   • Browser / Electron → public/js/assist.js → /api/ia/*    │
│   • Evolution WhatsApp → POST /api/whatsapp/evolution       │
├─────────────────────────────────────────────────────────────┤
│  Brain (coupled)                                            │
│   routes/ia.js → processarChat                              │
│   • snapshotAssistente (DB + project HTTP)                  │
│   • chamarIA (Gemini preferred / Anthropic if no Gemini)    │
│   • inferirAcoes + executarAcoes (≤8)                       │
│   • reconciliarRespostaComAcoes                             │
├─────────────────────────────────────────────────────────────┤
│  Data: Postgres (Neon/cloud) + connect-pg-simple sessions   │
│  Crons: node-schedule in-process (Pluggy, alarms, push…)    │
└─────────────────────────────────────────────────────────────┘
         │              │              │              │
         ▼              ▼              ▼              ▼
   Evolution API   CineRush ops   Attracione     SocialHub
   (approtina)     ADMIN_OPS_KEY  SCRAPER_TOKEN  OPS/CRON key
                                      Clipper (optional tunnel)
```

### Entrypoints

| Surface | Path | Role |
|---------|------|------|
| HTTP | `server.js` | Express 5 + WS |
| Electron | `electron-main.js` | Loads prod Railway URL |
| Static SPA | `public/` | Tabs + Assist panel |
| Health | `GET /health` | Public |

### Route map (high level)

Authenticated under `requireAuth` unless noted:

- `/api/auth`, `/api/tasks`, `/api/financeiro`, `/api/despesas`, `/api/receitas`, `/api/openfinance`, `/api/ia`, …
- **Public:** `POST /api/openfinance/webhook`, `POST /api/whatsapp/evolution`, `GET /api/whatsapp/status`

### Process flow (chat)

```
USER message
  → Interface (Web session | WA webhook)
  → processarChat(userId)
      → ensure conversa + save user msg
      → jarvis_prefs (infer + load)
      → snapshotAssistente(lite)  // includes projetos.* for owner
      → [greeting?] skip local infer
      → [fast path] local actions only → return
      → systemPrompt = identity + rules + JSON.stringify(snap)
      → Gemini/Anthropic JSON { resposta, acoes }
      → merge inferirAcoes + executarAcoes
      → reconciliar claims
      → save assistant msg
  → Interface (JSON | Evolution sendText)
```

---

## Existing Capabilities

### App Rotina (via JARVIS actions)

- Create/confirm expenses, revenues, tasks, goals, events, alarms, transactions
- Categorize / rename / merge categories; recategorize txs
- Mark habits (Academia), MEI DAS
- Sync banks (Pluggy) + reconcile expenses
- Answer questions from snapshot (tasks, finance, habits, plan — owner)

### Preferences

- Persist treatment (`chefe` / `Teus`) and short-greeting mode (`jarvis_prefs`)

### Channels

- Web Assist UI (per logged-in user)
- WhatsApp text (whitelisted phones → **always owner identity**)

### Project ops (owner only)

| Module | Read | Write |
|--------|------|-------|
| CineRush TV | summary, subscribers, Havok, Chatwoot load | provision, resend email, Chatwoot resolve/assign |
| Attracione | coleta status, ranking | coleta, backup, ranking by competition `n` |
| SocialHub | accounts, metrics, posts | schedule post, run publish cron |
| Clipper | health/streams/clips if URL set | create/retry clip |

### Explicit non-capabilities (today)

- Audio / image / PDF understanding
- Mission / multi-step planning with state
- Multi-agent orchestration
- Human-in-the-loop approvals for HIGH risk
- Durable job queue for long tools
- Tool discovery / registry
- Cross-user Jarvis (WA is owner-only)
- CineRush mass video editor (not wired)
- Streaming token responses to WhatsApp

---

## Existing Integrations

| Integration | Env | Auth | Used by |
|-------------|-----|------|---------|
| Gemini | `GEMINI_API_KEY` | API key | `chamarIA` (preferred) |
| Anthropic | `ANTHROPIC_API_KEY` | API key | Only if Gemini key absent |
| Evolution | `EVOLUTION_*` | apikey header | WA send + webhook |
| Pluggy | `PLUGGY_*` | OAuth/client | Open Finance (not Jarvis-direct) |
| CineRush | `CINERUSH_*` | Bearer OPS key | Jarvis snapshot/actions |
| Attracione | `ATTRACIONE_*` | X-Scraper-Token | Jarvis |
| SocialHub | `SOCIALHUB_*` | Bearer | Jarvis |
| Clipper | `CLIPPER_API_URL` | optional Bearer | Jarvis |
| Telegram | `TELEGRAM_*` | bot token | Cron alerts only |
| Web Push | `VAPID_*` | VAPID | Cron alerts |

---

## AI Architecture

### Model layer

- **No AI Gateway.** Direct axios/fetch in `routes/ia.js`.
- Provider selection: Gemini if key exists, else Anthropic. **No runtime fallback** Gemini→Anthropic when Gemini fails.
- Gemini model cascade on 404/429/503: `gemini-3.5-flash` → flash-latest → 2.5-flash → flash-lite.
- Chat: `jsonMode` (Gemini MIME JSON), `maxTokens: 2200`, `timeout: 28000`.
- History to model: last 10 messages, 4000 chars each.

### Prompt architecture

- Single monolithic template string per chat turn.
- Embeds **entire lite snapshot** as JSON (high token cost).
- Actions described as prose schemas in the prompt (not OpenAI-style tool schemas).
- Parallel: regex `inferirAcoesDaMensagem` can invent/merge actions without LLM.

### Tool / action architecture

- Actions are string `tipo` + ad-hoc fields.
- Execution: giant `if/else` in `executarAcoes` (max 8).
- Success narrative often rebuilt by `reconciliarRespostaComAcoes` (claim detection).
- **Not** a registry: adding a tool requires editing prompt + executor + reconciler + often snapshot client.

### Cost / performance (current)

- WhatsApp debounce: **2500 ms** before processing starts.
- Snapshot fans out to 0–4 external HTTP APIs for owner.
- No caching of project snapshots across turns.
- No model routing by task complexity.
- UNKNOWN: production token spend / monthly cost (needs Gemini/Anthropic billing export).

---

## Data Architecture

### Core stores

| Table | Role |
|-------|------|
| `usuarios` | Multi-tenant users |
| `assist_conversas` / `assist_mensagens` | Chat persistence |
| `whatsapp_sessoes` | phone → user_id + conversa_id |
| `jarvis_prefs` | treatment / greeting prefs |
| Domain tables | tasks, financeiro, despesas_mes, metas, … |
| `session` | connect-pg-simple |

### Migrations

- Boot-time `CREATE IF NOT EXISTS` + `ALTER ADD COLUMN` in `lib/db.js`
- `migrarMultiUsuario()` always runs
- No versioned migration runner (Flyway/Prisma migrate) — **technical debt**

### Multi-tenancy

- Row-level `user_id` on most tables
- Ranking intentionally cross-user (aggregated)
- WhatsApp always resolves to **owner**
- Some crons still query without `user_id` filter (UNKNOWN full impact in prod with 2 users)

---

## Security Assessment

### Strengths

- Session auth on `/api/ia`
- Password hashing (scrypt)
- Owner gates on project ops
- Phone whitelist for WhatsApp
- Ops keys for CineRush/SocialHub (not end-user JWT)

### Risks (prioritized)

| ID | Risk | Severity | Notes |
|----|------|----------|-------|
| S1 | Webhook secret optional | High | Empty `WHATSAPP_WEBHOOK_SECRET` → anyone can POST; whitelist mitigates processing |
| S2 | Prompt injection | High | Untrusted user text drives actions; no SYSTEM vs UNTRUSTED separation for tool outputs |
| S3 | WA = owner data plane | High | Any whitelisted phone mutates Mateus finance/ops |
| S4 | Destructive finance without approval | Medium | delete txs / bulk recategorize available to any app user |
| S5 | Secret in webhook query string | Medium | Setup puts `?secret=` in URL (logs/referrers) |
| S6 | Project snapshot over-exposure | Medium | Full ops payloads in prompt → leak via model response |
| S7 | Clipper unauthenticated if exposed | Medium | URL alone may be enough |
| S8 | Cross-tenant cron/push quirks | Low–Med | Global queries in some alerts |
| S9 | No audit trail of tool calls | Medium | Hard to answer “what did Jarvis do?” |
| S10 | SSRF via future browser/tools | Future | Must design allowlists early |

### Threat modeling status

**UNKNOWN / incomplete:** formal threat model not done. Indirect injection via Attracione/CineRush tool JSON into prompt is a real path.

---

## Technical Debt

1. **`routes/ia.js` god-file** — prompt + LLM + snapshot + actions + categorize + daily analysis.
2. **Actions as stringly-typed switch** — no schema validation (Zod) per tool.
3. **Schema migrations without versions**.
4. **DEPLOY.md outdated** (still mentions single APP_PASSWORD gate).
5. **`.env.example` incomplete** vs real Pluggy/VAPID/CRONS vars.
6. **In-memory WA debounce** — lost on restart; unsafe for multi-instance.
7. **Claim reconciler** fragile (false positives historically).
8. **Electron hardcodes prod URL** — coupling.
9. **No automated tests** for `processarChat` / webhook (UNKNOWN if any exist beyond scripts).
10. **SocialHub deploy** recently via `railway up` from dirty working tree — process risk.

---

## Bottlenecks

| Bottleneck | Effect |
|------------|--------|
| Debounce 2.5s | Perceived WA latency floor |
| Full snapshot every turn | Tokens + latency + cost |
| Sequential LLM then actions | No streaming; user waits for full plan+exec |
| Single Railway process | Crons compete with chat latency |
| External project HTTP in snapshot | Owner chat waits on slowest module |
| No cache | Repeat “como tá o CineRush?” re-fetches everything |

---

## Missing Capabilities (for JARVIS OS vision)

1. Decoupled **JARVIS Core** (interface-agnostic)
2. **AI Gateway** (providers, routing, cost, fallback)
3. **Tool Registry** + typed schemas + risk levels
4. **Permission / Approval Engine** (HITL)
5. **Memory system** (episodic/semantic/project retrieval — not full dump)
6. **Project Registry** as first-class metadata (not only HTTP clients)
7. **Mission + Planner + step state machine**
8. **Agent orchestrator** (specialists)
9. **Event bus / proactivity** (deploy fail, backlog, etc.)
10. **Observability** (structured runs, tool spans, token/cost)
11. **Multimodal pipeline** (audio STT, image vision, PDF)
12. **Validation loop** (execute → verify → repair)
13. **Durable async jobs** for long missions
14. **Safety layer** (untrusted data quarantining)

---

## Recommended Architecture (Target)

Evolve in place; extract core without big-bang rewrite.

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ WhatsApp     │  │ Web Assist   │  │ Future: API  │
│ Adapter      │  │ Adapter      │  │ Voice, etc.  │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       └────────────┬────┴─────────────────┘
                    ▼
            ┌───────────────┐
            │ JARVIS CORE   │
            │  Identity     │
            │  Conversation │
            │  Intent       │
            │  Planner      │
            │  Memory       │
            │  Permissions  │
            │  Orchestrator │
            └───────┬───────┘
                    │
     ┌──────────────┼──────────────┐
     ▼              ▼              ▼
┌─────────┐  ┌────────────┐  ┌────────────┐
│ AI      │  │ Tool       │  │ Agent      │
│ Gateway │  │ Registry   │  │ Registry   │
└─────────┘  └─────┬──────┘  └─────┬──────┘
                   │               │
                   ▼               ▼
            Execution Engine ←→ Mission Store
                   │
                   ▼
            Observability + Audit Log
```

### Mapping to today

| Target component | Seed from today |
|------------------|-----------------|
| Conversation Engine | `processarChat` + assist tables |
| Context Engine | `snapshotAssistente` (must shrink + retrieve) |
| Tool Registry | `executarAcoes` tipos → registered tools |
| Project Registry | `lib/cinerush|attracione|socialhub|clipper` + metadata |
| Memory (prefs) | `jarvis_prefs` → expand |
| Identity | `usuarios` + WA whitelist + owner |
| AI Gateway | extract `chamarIA` |
| WhatsApp Adapter | `whatsapp-evolution.js` |
| Web Adapter | `assist.js` + `/api/ia/chat` |

### What NOT to build in Phase 1

- Full multi-agent Iron Man fantasy
- Autonomous production deploys
- Unlimited terminal/browser without sandbox
- Rewriting App Rotina domain routes

---

## Migration Risks

| Risk | Mitigation |
|------|------------|
| Break WhatsApp while refactoring | Keep adapter thin; feature-flag Core |
| Break finance actions | Golden tests on action tipos |
| Token cost explosion with agents | Budget + cheap model for routing |
| Over-permission tools | Risk levels + HITL from day one of Tool Registry |
| Dual-write chaos | Single execution path; migrate tools one-by-one |
| Multi-instance WA debounce | Redis or Evolution-side coalescing |

**Strategy:** EVOLUTION > REWRITE — extract interfaces around `processarChat` until Core can live in `lib/jarvis/` (or later a service) without changing WA/Web contracts.

---

## Quick Wins (≤1–2 days each)

1. **Require** `WHATSAPP_WEBHOOK_SECRET` in production (fail closed).
2. Reduce WA debounce to ~1000 ms (or adaptive).
3. Cache project snapshots 30–60s per owner.
4. Compress snapshot (send summaries, not full payloads).
5. Runtime Gemini→Anthropic fallback.
6. Structured log line per chat: `{conversaId, provider, tokens, actions, ms}`.
7. Zod validate action objects before execute.
8. Document env completely in `.env.example`.

---

## Architecture Diagram (current — textual)

```
[User Phone]--WhatsApp-->[Evolution approtina]
                              |
                              | webhook MESSAGES_UPSERT
                              v
                     [/api/whatsapp/evolution]
                              |
                     whitelist + debounce
                              |
                              v
                     [processarChat(owner)] <---- [/api/ia/chat] <-- [Assist UI]
                              |
              +---------------+---------------+
              |               |               |
              v               v               v
        [Postgres]      [Gemini/Claude]  [Project HTTP]
        rotina data      JSON plan         CineRush/...
        chat history
              |
              v
        [Evolution sendText] / [HTTP JSON response]
```

---

## Problems (architectural)

1. Interface and brain coupled through one file and one prompt.
2. Tools are prompt prose + switch, not capabilities.
3. Context strategy = dump everything (anti-pattern for OS scale).
4. No mission/plan state — only single-turn actions.
5. No permission risk model — binary owner/not.
6. Observability insufficient for trust.
7. Multimodal gap vs WhatsApp reality (users send audio/images).
8. Single process = availability/latency coupling with crons.
9. Security of webhook and injection under-specified.
10. “Jarvis” brand ahead of system maturity — risk of overpromising.

---

## Opportunities

1. Extract Tool Registry **without** UX change (wrap existing `tipo`s).
2. WA + Web already share brain — adapters pattern is half-done.
3. Project clients already exist — promote to Project Registry entries.
4. Prefs table is seed of User Preference memory.
5. CineRush/Attracione/SocialHub ops keys = good machine-auth pattern to standardize.
6. Owner-only hub is fine for v1 Personal OS (single user of power tools).

---

## Target Roadmap (phases)

> Detailed task backlog should live in `docs/JARVIS_BACKLOG.md` after Phase 0 approval.  
> Order is **adapted to this codebase**, not the generic list.

### PHASE 0 — Audit & Contracts (this document)

- Freeze understanding; agree first implementation step.

### PHASE 1 — JARVIS Core extraction (minimal)

- Move `processarChat` orchestration behind `lib/jarvis/core` (or equivalent) with clear ports: `ChatRequest` → `ChatResult`.
- Keep WA/Web adapters as thin callers.
- **Why first:** everything else hangs off a stable core API.

### PHASE 2 — AI Gateway + Observability baseline

- Provider interface, fallback, usage logging, latency metrics.
- **Why:** cost/control before adding more LLM calls (planner/agents).

### PHASE 3 — Tool Registry (wrap existing actions)

- Register current Rotina + project actions with schema + risk_level + timeout.
- Executor dispatches by name; remove growth of if/else over time.
- **Why:** enables planner/agents without rewriting tools later.

### PHASE 4 — Context & Memory v1

- Snapshot summarizer + cache; prefs expansion; optional episodic retrieval of past decisions.
- **Why:** fixes token/latency bottleneck; enables “remember last deploy issue”.

### PHASE 5 — Permission Engine + HITL

- Risk levels; approval messages on WhatsApp/Web for HIGH/CRITICAL.
- **Why:** required before browser/code/deploy tools.

### PHASE 6 — Project Registry

- Metadata catalog (id, name, envs, docs links) + existing clients as connectors.
- **Why:** natural language “Atlas/CineRush/Attracione” resolution.

### PHASE 7 — Mission + Planner (single-agent first)

- Mission table + plan steps + status machine; still one “JARVIS” executor using tools.
- **Why:** multi-step goals without multi-agent complexity yet.

### PHASE 8 — Multimodal ingress

- Audio STT, image vision, document text — into same Core as text.
- **Why:** WhatsApp users already try this.

### PHASE 9 — Agents (optional specialists)

- Research / Coding / Data agents as tool-using personas under orchestrator.
- **Why:** only after tools + missions + permissions exist.

### PHASE 10 — Proactivity & Events

- Subscribe to deploy/health/finance events; notify; never auto-CRITICAL.
- **Why:** OS feel; needs observability + permissions.

### PHASE 11 — JARVIS OS polish

- Dashboards, cost budgets, multi-interface API, hardened sandboxes.

---

## First Implementation Step (ONLY)

### JARVIS-001 — Extract JARVIS Core façade (no behavior change)

**Objective:** Create a stable, interface-agnostic entrypoint for chat without changing product behavior.

**Do:**

1. Add `lib/jarvis/core.js` (or `src/jarvis/core.ts` if TS adopted later) exporting:
   - `runJarvisTurn({ userId, message, conversaId, channel, historico })`
2. Move `processarChat` body behind that function (re-export from `routes/ia.js` for compatibility).
3. Make WhatsApp call `runJarvisTurn({ channel: 'whatsapp', ... })`.
4. Make `/api/ia/chat` call `runJarvisTurn({ channel: 'web', ... })`.
5. Add structured log: `channel, userId, conversaId, durationMs, provider, actionTypes, ok`.

**Do not yet:** tool registry, planner, new DB tables (except maybe none), prompt rewrite, debounce change.

**Acceptance criteria:**

- WhatsApp and Web still answer as today
- Finance/project actions still work
- One log line per turn in Railway
- No public API contract break

**Rollback:** re-point routes to previous `processarChat` inline.

**Why this first:** Without a Core boundary, every later phase rewrites `ia.js` again. This is the smallest cut that enables Tool Registry / Gateway / Missions safely.

---

## Open Questions (priority-grouped)

### P0 — need your call before Phase 1 coding

1. **Single-user power tools forever?** Keep WA→owner only for the Personal OS, or plan multi-user Jarvis later?
2. **TypeScript now or later?** Core extract in JS first (faster) vs TS strict (cleaner long-term)?

### P1 — before Tool Registry / HITL

3. Which actions must always require explicit approval? (candidates: `deletar_transacao`, CineRush revoke, Attracione limpar-disco, SocialHub publish)
4. Preferred approval UX on WhatsApp: reply `SIM`/`NÃO` with action id, or buttons if Evolution supports?

### P2 — before Missions / Agents

5. Should long missions run async with progress pings on WhatsApp, or only sync short turns for now?
6. Hosting: keep Core inside `app-rotina` process for 6+ months, or split service earlier?

### UNKNOWN (to discover with metrics, not guesses)

- Exact monthly LLM cost
- p50/p95 latency breakdown (debounce vs snapshot vs model)
- Whether Railway will run >1 replica (impacts in-memory debounce)

---

## Document Control

| Field | Value |
|-------|-------|
| Status | PHASE 1 STARTED — Core façade shipped (see `JARVIS_PHASE1_CHECKPOINT.md`) |
| Next doc | `docs/JARVIS_ROADMAP.md` + `docs/JARVIS_BACKLOG.md` after you approve Phase 1 scope |
| Related code | `routes/ia.js`, `routes/whatsapp-evolution.js`, `lib/*` project clients |

---

*End of audit. No implementation performed in this step.*
