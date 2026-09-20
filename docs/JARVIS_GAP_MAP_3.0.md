# JARVIS Gap Map — Hub operacional → OS 3.0

**Date:** 2026-09-17  
**Baseline:** v0.8.3 (`R:\Projetos\Jarvis` → sync → app-rotina)  
**Target:** interface NL + memória + orquestrador + tools + agentes + missões

> Regra: **WhatsApp = boca/ouvido**. Cérebro e braços ficam no OS. Não reescrever o App Rotina.

---

## 1. Onde estamos (1 frase)

**Hub pessoal com tools reais** (finanças, rotina, CineRush, Attracione, SocialHub, Editor) + HITL + missões v1 + multimodal leve.  
**Ainda não** é um OS que pesquisa a web, debuga código ou coordena subagentes de verdade.

---

## 2. Gap por camada

| Camada | Hoje | Gap principal | Código âncora |
|--------|------|---------------|---------------|
| **Cérebro** | Turno + intent pack + LLM JSON | Planner frágil; histórico contamina decisões | `core.js`, `context/`, `routes/ia.js` |
| **Research** | — | Sem web/browser/relatório | *(novo)* `tools` + agent |
| **Dev** | — | Sem git/logs/arquivos/deploy | *(novo)* sandbox + agent |
| **Creative** | — | Sem imagem/layout | *(novo)* |
| **Memória** | Prefs + notas curtas | Sem memória de projeto / episódios ricos | `memory/episodic.js` |
| **Automation** | 38 tools + connectors | Só o que está plugado; criar assinante etc. faltam | `tools/`, `connectors/` |
| **Analytics** | Snapshots HTTP | Sem séries/alertas genéricos | registry snapshots |
| **Vision** | Gemini image + STT | PDF/doc fraco; sem “reproduzir layout” | `multimodal/ingress.js` |
| **Voice** | STT | Sem TTS / conversa contínua | ingress |
| **Agents** | Personas de prompt | Não há workers isolados | `agents/registry.js` |
| **Missions** | Heurística + LLM + batch | Mission Mode “lançar produto” incompleto | `missions/` |
| **Permissions** | Risk + HITL (WA off por default) | Calibragem + não mentir sucesso | `permissions/`, reconciler |

**Maturidade global estimada: ~35% do blueprint 3.0** (automation ~55%, resto puxa a média pra baixo).

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
| 9 | Orchestrator escolhe agent(s) por intent (não só addendum de prompt) | ~~“prepara landing” → research→copy→…~~ **DONE 0.9.31** (auto-missão stub) |
| 10 | Vision v2 — PDF + screenshot → achados estruturados | ~~“o que está errado?” em print~~ **DONE** (ingress + smoke) |
| 11 | Proatividade útil — 1–2 alertas reais (deploy fail, fila editor, crédito Havok) | ~~ping WA sem auto-CRITICAL~~ **DONE 0.9.32** (cron 15m/30m + sweep 3h) |
| 12 | Permission matrix documentada (AUTO / APPROVAL / BLOCKED) por tool | tabela no Manual |

**Ainda depois do 90 (backlog consciente):** Creative/image gen, Voice TTS, coding agent full (patch+test+deploy), browser genérico, “lançar produto” mission completa.

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
10. Próximo livre / backlog sob pedido
---

## 7. Definition of Done — “OS 3.0 mínimo”

- [x] Memória de projeto responde fatos gravados (stack/status/notas) — “semana passada” ainda depende de episodic/time  
- [x] ≥1 agent com tools próprias (não só persona) — **Dev** + **Research**  
- [x] ≥1 missão multi-sistema sem mentir sucesso — Mission Mode polish (smoke WA)  
- [x] Permission matrix publicada e respeitada — Manual + `npm run check:tools` + `os-status.permissionMatrix`  
- [x] WA continua só como canal  

*Enquanto isso não fechar, somos um **hub operacional excelente**, não o JARVIS do filme — e está ok.*
