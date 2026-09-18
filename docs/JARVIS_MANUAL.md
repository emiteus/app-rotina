# JARVIS — O que é manual (faça você)

**OS home:** `R:\Projetos\Jarvis` (fonte de verdade).  
**Host:** App Rotina (`Approtina/app-rotina`) — sync com `npm run sync:host`.  
Código no deploy: **v0.9.6+**. Abaixo só o que depende de você / ambiente / produto externo.

**Norte:** conexão real (snapshot + tools + LLM). Sem atalhos de resposta por projeto.


---

## 1. Railway — secrets e flags

Confira / preencha no serviço **app-rotina**:

| Var | Pra quê |
|-----|---------|
| `GEMINI_API_KEY` | IA principal |
| `ANTHROPIC_API_KEY` | Fallback |
| `WHATSAPP_WEBHOOK_SECRET` | Obrigatório em production |
| `WHATSAPP_ALLOWED_PHONES` | Whitelist (DDI 55…) |
| `WHATSAPP_PHONE_USERS` | Opcional multi-user `5584…:teus,5584…:outro` |
| `EVOLUTION_*` | WA |
| `CINERUSH_*` / `CINERUSH_EDITOR_*` / `ATTRACIONE_*` / `SOCIALHUB_*` / `CLIPPER_*` | Projetos |
| `PROJETO_MILHAO_URL` | HTTP ops do Milhão em produção (`https://projeto-milhao-production.up.railway.app`) |
| `GITHUB_TOKEN` | Dev agent: ler repos privados / rate limit |
| `RAILWAY_TOKEN` | Dev agent: logs + **redeploy** (Account token) |
| `BRAVE_SEARCH_API_KEY` / `SERPER_API_KEY` | Research: busca web (senão DuckDuckGo) |
| `RESEARCH_FETCH_ALLOWLIST` | Research: hosts permitidos (comma); ou `RESEARCH_FETCH_OPEN=1` |
| `OPENAI_API_KEY` | Só se quiser Whisper no áudio |
| `JARVIS_HITL=1` | Confirmação high-risk no **Assist web** (default on) |
| `JARVIS_HITL_WHATSAPP=1` | Opt-in: high/medium no WhatsApp (default **off**) |
| `JARVIS_HITL_BUTTONS=1` | Opt-in: botões SIM/NÃO (default off — WA Web quebra) |
| `JARVIS_PROACTIVE_WA=0` | Desliga pings proativos no WhatsApp |
| `JARVIS_RAILWAY_WATCH=0` | Desliga watch de deploy FAIL/CRASH (default **on** se tem `RAILWAY_TOKEN`) |
| `JARVIS_VISION_MODEL` | Modelo Gemini Vision (default `gemini-2.5-flash`) |
| `JARVIS_VISION_MAX_BYTES` | Limite do anexo (default 12MB) |

Redeploy após mudar env.

**Milhão:** serviço próprio no Railway (24/7). `IG_FONTE=embed` (datacenter — ~6 posts/página). Não depende do PC.

### Matriz de risco (tools)

| Risk | Exemplo | WhatsApp (default) | Assist web |
|------|---------|--------------------|------------|
| low | `dev_railway_logs`, `dev_diagnose` | auto | auto |
| medium / high | sync bancos, mutações financeiras | auto (WA HITL off) | SIM se ≥ threshold |
| **critical** | `dev_railway_redeploy`, `dev_railway_restart` | **sempre SIM** | **sempre SIM** |

Critical ignora `JARVIS_HITL_WHATSAPP=0` — redeploy nunca roda sem confirmação (enquanto `JARVIS_HITL=1`).

---

## 2. Smoke test (5 min)

1. WA: `oi` → resposta curta  
2. WA (número fora da whitelist) → aviso de whitelist (não silêncio)  
3. WA: `quais módulos` → lista registry  
4. WA: `quantos posts no teushub hoje` → LLM lê `projetos.socialhub.hoje` (não atalho local)  
5. WA: após coleta Attracione → `atualiza o cache` / `snapshot_refresh` via tool  
6. Assist web: pills → **OS** (dashboard; version 0.9.6+)  
7. Railway logs: `jarvis.turn` / `jarvis.ai` / `jarvis.tool` / `provider` ≠ `local` em Q&A de projetos
8. WA: `redeploy milhão` → pede **SIM** (critical); depois confirma service/env
9. WA: `restart milhão` → pede **SIM**; reinicia sem rebuild
10. WA: manda print de erro (sem legenda) → achados Vision v2 (*Screenshot* + bullets)
11. WA: PDF curto ou print com legenda `o que está errado?` → achados + resposta curta

---

## 3. Ainda não dá pra “ligar no código” sem você

| Item | Por quê | O que fazer |
|------|---------|-------------|
| **Editor de vídeo CineRush em massa** | ✅ ligado (`cinerush_editor_*`) | Confere `CINERUSH_EDITOR_URL` + `CINERUSH_EDITOR_OPS_KEY` |
| **Projeto Milhão** | Precisa rede Railway→PC/túnel | Sobe Docker + seta `PROJETO_MILHAO_URL` |
| **Validar botões Evolution** | Depende da build da Evolution | Testa HITL; se botão não aparecer, texto SIM/NÃO já funciona |
| **Whisper** | Precisa da sua key OpenAI | Seta `OPENAI_API_KEY` se quiser fallback de áudio |
| **Multi-user WA** | Precisa logins reais | `WHATSAPP_PHONE_USERS=fone:login` |

---

## 4. Comandos úteis

```
missão: …
próximo passo
executa missão
status missão
retry passo
cancela missão
agente ops: status cinerush
agente research: pesquisa …
agente dev: diagnostica o milhão
/finance quanto gastei
lembra que …
atualiza o cache
quantos posts no teushub hoje
SIM a1b2c3d4 / NÃO a1b2c3d4
```

Missões: `executa missão` manda pings curtos (`Passo 2/4 · ok`); board completo em `status missão`.  
`JARVIS_MISSION_PROGRESS=0` desliga pings no WA.
API: `GET /api/ia/os` · `GET /api/ia/missions` · `GET /api/ia/status`

---

## 5. Docs de fase

- `docs/JARVIS_SYSTEM_AUDIT.md` — plano original  
- `docs/JARVIS_PHASE1_CHECKPOINT.md` … `PHASES_7_11` / `DEBT_REDUCTION.md`  
- Este arquivo = **só o manual**
