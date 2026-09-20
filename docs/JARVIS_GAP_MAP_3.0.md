# JARVIS Gap Map — Hub operacional → OS 3.0

**Date:** 2026-09-17 · **Revisado:** 2026-09-20 (auditoria)  
**Baseline:** v0.9.64 (`R:\Projetos\Jarvis` → sync → app-rotina)  
**Target:** interface NL + memória + orquestrador + tools + agentes + missões

> Regra: **WhatsApp = boca/ouvido**. Cérebro e braços ficam no OS. Não reescrever o App Rotina.

---

## 1. Onde estamos (1 frase)

**Hub pessoal com 64 tools reais** (finanças, rotina, CineRush, Attracione, SocialHub, Editor, Chatwoot) + HITL + missões batch + research/dev/creative/browser + vision v2 + proativo.  
O trilho OS 3.0 mínimo (#1–#12) está fechado; o que falta é **profundidade** (subagentes isolados, copy real, séries de analytics), não a camada base.

---

## 2. Gap por camada

> Atualizado na auditoria de 2026-09-20. “Hoje” = verificado no código, não no plano.

| Camada | Hoje | Gap principal | Código âncora |
|--------|------|---------------|---------------|
| **Cérebro** | Turno + intent pack + LLM JSON + planner LLM + **higiene de histórico** | Embeddings / workers isolados | `core.js`, `context/`, `routes/ia.js` |
| **Research** | Busca (Brave/Serper) + fetch SSRF-safe + relatório | Sem síntese multi-fonte com citação | `tools/handlers/research.js` |
| **Dev** | 11 tools: diagnose, git, logs, read/patch, PR, testes, redeploy | Sem sandbox isolado; patch escreve no disco real | `tools/handlers/dev.js` |
| **Creative** | Geração de imagem (Gemini Flash Image) + outline de landing | Sem layout visual estruturado | `multimodal/creative.js`, `landing-copy.js` |
| **Memória** | Prefs + notas + projeto + falhas + recall temporal + **recall semântico lexical** | Embeddings reais (vector) | `memory/projects.js`, `episodic.js` |
| **Automation** | 64 tools + connectors | Só o que está plugado; criar assinante etc. faltam | `tools/`, `connectors/` |
| **Analytics** | Snapshots HTTP + watches (Railway/ops) | Sem séries históricas nem alerta genérico | registry snapshots, `events/bus.js` |
| **Vision** | Vision v2 findings + **reproduzir layout** (JSON blueprint) | SPA/browser headless pra capturar | `multimodal/ingress.js` |
| **Voice** | STT (Gemini, fallback Whisper) + TTS OpenAI | Sem conversa contínua | `ingress.js`, `multimodal/tts.js` |
| **Agents** | 6 personas + orquestrador + auto-missão + **toolPrefixes gate** | Workers isolados (subprocess) | `agents/registry.js`, `orchestrator.js`, `tools/index.js` |
| **Missions** | Heurística + LLM + batch + retry + landing copy + CAS lock | Workers isolados (subprocess) | `missions/` |
| **Permissions** | Risk + HITL + matriz documentada + TTL | HITL no WA só p/ critical (decisão, não gap) | `permissions/`, reconciler |

**Maturidade estimada: ~70% do blueprint 3.0** — base completa, profundidade em aberto.

---

## 3. Já existe (não reinventar)

- Core façade + AI gateway (Gemini→Anthropic) + budget  
- Tool registry + handlers por domínio + HITL canal-aware  
- Project registry + `manifest.json` + sync host  
- Missões (create / próximo / executa / batch)  
- Multimodal ingress (áudio/imagem)  
- Probe WA: `app-rotina/scripts/jarvis-wa-probe.js`  
- Repos: `emiteus/jarvis-os` (fonte) + `emiteus/app-rotina` (deploy)

---

## 4. Plano 30 / 60 / 90 dias

### Dias 1–30 — **fundação que paga**

Objetivo: Jarvis **conhece o ecossistema** e **não mente / não trava** em ops.

| # | Entrega | Aceite |
|---|---------|--------|
| 1 | **Memória de projetos** — store por `project_id` (stack, objetivo, status, decisões, links, “última falha”) | “como tá o Cutflix?” usa memória + registry |
| 2 | **Plugar 1 produto** (Cutflix) catalog+connector+`cutflix_status` | `quais módulos` mostra Cutflix ON/off + health |
| 3 | **Ops honesty** — reconciler fail-first; claim “Feito/liberei” coberto | smoke WA sem mentira |
| 4 | **CineRush: criar vs provisionar** — `cinerush_criar` documenta limite Kirvano | pedido “acesso novo” não vira provision cego |
| 5 | **Prompt/contexto** — registry única fonte de ON/off | módulos batem com `getRegistryStatus` |

**Fora do 30:** browser, coding agent, multi-agent pesado.

---

### Dias 31–60 — **primeiro braço novo**

Objetivo: 1 capacidade “MCU-like” de verdade.

Escolher **um** trilho (não dois):

**A) Research Agent (recomendado se o dia a dia é negócio)**  
- Tools: `web_search`, `fetch_url` (allowlist), `write_report`  
- Missão: “pesquisa concorrentes X → relatório no WA”  
- HITL: publish/share = approval  

**B) Ops/Debug Agent (recomendado se o dia a dia é código)**  
- Tools read-only primeiro: `git_status`, `read_file` (paths allowlist), `tail_logs` (Railway/API)  
- Missão: “CineRush checkout quebrando → diagnóstico”  
- Write/deploy = APPROVAL  

| # | Entrega | Aceite |
|---|---------|--------|
| 6 | Agent real (A ou B) com tools próprias + timeout + audit log | 1 missão end-to-end no WA |
| 7 | Mission Mode v2 — steps tipados + progresso + pause em HITL | `missão: …` + `executa missão` estável |
| 8 | Memória operacional — “última tentativa falhou porque Y” | não repete o mesmo erro na missão seguinte |

---

### Dias 61–90 — **orquestração**

Objetivo: Orchestrator delega; você só dá a missão.

| # | Entrega | Aceite |
|---|---------|--------|
| 9 | Orchestrator escolhe agent(s) por intent (não só addendum de prompt) | ~~“prepara landing” → research→copy→…~~ **DONE 0.9.31** · copy real **0.9.36** (`creative_landing_copy`) |
| 10 | Vision v2 — PDF + screenshot → achados estruturados | ~~“o que está errado?” em print~~ **DONE** (ingress + smoke) |
| 11 | Proatividade útil — 1–2 alertas reais (deploy fail, fila editor, crédito Havok) | ~~ping WA sem auto-CRITICAL~~ **DONE 0.9.32** (cron 15m/30m + sweep 3h) |
| 12 | Permission matrix documentada (AUTO / APPROVAL / BLOCKED) por tool | ~~tabela no Manual~~ **DONE 0.9.33** (`check:tools` valida criticals) |

**Ainda depois do 90 (backlog consciente):** subagentes isolados, séries de analytics, quarentena de conteúdo externo (prompt injection), sandbox pro patch local.

> Creative/image gen, Voice TTS, coding agent (patch+test+PR+deploy), browser genérico e **copy de landing** **saíram do backlog** — já estão implementados.

---

## 5. Princípios (pra não descarrilar)

1. **Evolution > rewrite** — extrair tools/agents no `Jarvis/`, sync pro host.  
2. **1 braço por vez** — Research **ou** Dev no dia 60, não os dois.  
3. **Allowlist sempre** — paths, hosts, deploys.  
4. **HITL no write/deploy/financeiro destrutivo**; WA pode continuar trust-owner.  
5. **Medir:** `jarvis.turn` / `jarvis.tool` / missões done vs failed (já tem logs).

---

## 6. Próxima ação (esta semana)

1. ~~Memória de projetos~~ **DONE**
2. ~~Ops honesty + Cutflix health~~ **DONE**
3. ~~Missions wrap~~ **DONE** (v0.9.7)
4. ~~Trilho 31–60: Dev/Ops Agent read-only~~ **DONE** (v0.9.8) — tools `dev_*`
5. ~~Smoke Research no WA~~ (curto + fontes sob demanda)
6. ~~Mission Mode polish~~ — progresso compacto + ultima_falha + HITL onProgress
7. Smoke: `missão: diagnostica o milhão` → `executa missão`
8. ~~Dia 61+: orchestrator~~ **DONE 0.9.31** (`prepara landing` auto-missão)
9. ~~Próximo: **#11 proatividade**~~ **DONE 0.9.32**
10. ~~Próximo livre / backlog sob pedido~~ Trilho 61–90 **completo** (#9–#12). Backlog sob pedido.
11. ~~Auditoria 2026-09-20~~ **DONE 0.9.35** — 7 achados corrigidos (HITL reuse/TTL/hard-gate, missão travada, SSRF redirect, honestidade no finance, working tree do host). Ver §8.
12. ~~Copy real na landing~~ **DONE 0.9.36** — `creative_landing_copy` (brief → hero/CTA/seções; fallback sem LLM).
13. ~~Quarentena conteúdo externo~~ **DONE 0.9.40** — wrap research/browser/vision + system hint.
14. ~~Gate central ownerOnly~~ **DONE 0.9.41** — `splitByOwner` + `snapshot_refresh`/`project_memory_set`.
15. ~~Lock de missões~~ **DONE 0.9.42** — `claimMissionRun` (CAS).
16. ~~§8 restante~~ **DONE 0.9.43** — realpath patch · redact logs · OPEN bloqueado em prod.
17. ~~Recall temporal~~ **DONE 0.9.44** — `recall_temporal` (semana passada / ontem / N dias) no pack.
18. ~~Histórico anti-contaminação~~ **DONE 0.9.45** — `sanitizeHistoricoForDecision` (topic switch + scrub externo).
19. ~~Recall semântico lexical~~ **DONE 0.9.46** — `recall_semantico` (overlap tokens; embeddings ainda depois).
20. ~~Agent toolPrefixes gate~~ **DONE 0.9.47** — `splitByAgentScope` (isolation lite; workers reais depois).
21. ~~Vision reproduzir layout~~ **DONE 0.9.48** — print → blueprint JSON (zonas/hierarquia/CTAs).
22. ~~Layout reproduce fidelidade~~ **DONE 0.9.49–0.9.54** — assets via **Commons search genérico** (sem catálogo de times).
23. ~~Compositor pixel~~ **DONE 0.9.55** — `compose.js` (bbox slots + sharp paste; Gemini fallback).
24. ~~Commons fetch resiliente~~ **DONE 0.9.56** — candidatos + retry 429 + bloqueia half-pair.
25. ~~Slots confiáveis no compose~~ **0.9.57–0.9.59** (compose experimental).
26. ~~Layout: Gemini-first de novo~~ **DONE 0.9.60** — template via modelo + assets Commons; compose só com `JARVIS_LAYOUT_COMPOSE=1`.
27. ~~Fidelidade de tratamentos~~ **DONE 0.9.61** — vision `tratamentos` + prompt exige stroke/sombra/glow do template.
28. ~~Follow-up de ajuste de layout~~ **DONE 0.9.62** — cache/quote + locked tweak (bloqueia creative solto).
29. ~~NL PT Unicode + create/stop intent~~ **DONE 0.9.63** — `nl/pt.js` (capacidade geral; atalhos usam isso).
30. ~~Confirmar pagamento vs “me confirma”~~ **DONE 0.9.64** — `hasConfirmPaymentIntent` + cinto; honestidade memória ≠ pause real.

---

## 8. Auditoria 2026-09-20 — status

Corrigido em 0.9.34–0.9.43. **§8 fechado.**

| Achado | Onde | Por que aceitamos |
|--------|------|-------------------|
| Conteúdo externo (research/browser/vision) volta pro LLM sem quarentena | `handlers/research.js`, `browser.js` | **DONE 0.9.40** — wrap `[CONTEÚDO EXTERNO]` + hint no system prompt |
| Sem gate central de `ownerOnly` — `snapshot_refresh` e `project_memory_set` abertos | `handlers.js`, `ops.js`, `memory.js` | **DONE 0.9.41** — `splitByOwner` em `runToolBatch` + flags nas defs |
| Missões sem lock — duas mensagens simultâneas podem corromper `steps` | `missions/store.js` | **DONE 0.9.42** — `claimMissionRun` CAS planned→running |
| Symlink pode escapar do `PROJETOS_ROOT` no patch | `handlers/dev.js` | **DONE 0.9.43** — `resolvePathUnderProject` + realpath |
| Logs do Railway podem conter segredo ao voltar pro WA | `handlers/dev.js` | **DONE 0.9.43** — `redactSecrets` nas lines |
| `RESEARCH_FETCH_OPEN=1` desliga a allowlist de hosts | `handlers/research.js` | **DONE 0.9.43** — bloqueado em prod sem `FORCE=1` |

---

## 7. Definition of Done — “OS 3.0 mínimo”

- [x] Memória de projeto responde fatos gravados (stack/status/notas) — temporal **0.9.44** + lexical **0.9.46**; embeddings ainda não  
- [x] ≥1 agent com tools próprias (não só persona) — **Dev** + **Research**  
- [x] ≥1 missão multi-sistema sem mentir sucesso — Mission Mode polish (smoke WA)  
- [x] Permission matrix publicada e respeitada — Manual + `npm run check:tools` + `os-status.permissionMatrix`  
- [x] WA continua só como canal  

*Enquanto isso não fechar, somos um **hub operacional excelente**, não o JARVIS do filme — e está ok.*
