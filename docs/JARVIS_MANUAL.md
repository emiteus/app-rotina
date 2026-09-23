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
| `GITHUB_TOKEN` | Dev/coding: repos + **abrir PR** (scope `repo`) |
| `RAILWAY_TOKEN` | Dev agent: logs + **redeploy** (Account token) |
| `PROJETOS_ROOT` | Disco local pra `dev_apply_patch_local` / `dev_git_diff` (ex. `R:/Projetos`) |
| `BRAVE_SEARCH_API_KEY` / `SERPER_API_KEY` | Research: busca web (senão DuckDuckGo) |
| `RESEARCH_FETCH_ALLOWLIST` | Research/Browser: hosts permitidos (comma). `RESEARCH_FETCH_OPEN=1` só fora de prod; em prod exige `RESEARCH_FETCH_OPEN_FORCE=1` |
| `OPENAI_API_KEY` | **TTS** outbound + fallback de STT (o STT primário é Gemini) |
| `JARVIS_HITL=1` | Confirmação high-risk no **Assist web** (default on). **Não** afeta `critical`: redeploy/patch/PR pedem SIM sempre |
| `JARVIS_HITL_WHATSAPP=0` | Opt-out: WA volta a executar high sem SIM (default **on** desde 0.9.73) |
| `JARVIS_HITL_BUTTONS=1` | Opt-in: botões SIM/NÃO (default off — WA Web quebra) |
| `JARVIS_PROACTIVE_WA=0` | Desliga pings proativos no WhatsApp |
| `JARVIS_RAILWAY_WATCH=0` | Desliga watch de deploy FAIL/CRASH (default **on** se tem `RAILWAY_TOKEN`) |
| `JARVIS_VISION_MODEL` | Modelo Gemini Vision (default `gemini-2.5-flash`) |
| `JARVIS_VISION_MAX_BYTES` | Limite do anexo (default 12MB) |
| `JARVIS_OPS_WATCH=0` | Desliga watch Editor/Havok/Attracione (default on) |
| `JARVIS_EDITOR_QUEUE_WARN` | Fila Editor waiting ≥ N → alerta (default 8) |
| `JARVIS_HAVOK_CREDITS_WARN` | Créditos Havok < N → alerta (default 50) |
| `JARVIS_CINERUSH_PEND_WARN` | Pendentes provision ≥ N → alerta (default 3) |
| `JARVIS_TTS` | `off` (default) / `auto` (áudio-in ou “em áudio”) / `always` |
| `JARVIS_TTS_VOICE` | Voz OpenAI (default `nova`) |
| `JARVIS_TTS_MODEL` | Modelo TTS (default `tts-1`) |
| `JARVIS_STT_MODEL` | Modelo Gemini pra áudio (default `gemini-2.0-flash`) |
| `JARVIS_CREATIVE=0` | Desliga geração de imagem |
| `JARVIS_IMAGE_MODEL` | Modelo imagem (default `gemini-2.5-flash-image`; fallbacks 3.1 flash-lite/image) |
| `JARVIS_IMAGE_RETRIES` | Tentativas por modelo em 429/503 (default `2`) |
| `JARVIS_APPROVAL_TTL_MS` | Validade do SIM pendente (default 10min; expirado não executa) |

**Menos usadas, mas lidas pelo código:** `GH_TOKEN` e `RAILWAY_API_TOKEN` (aliases de `GITHUB_TOKEN`/`RAILWAY_TOKEN`), `RAILWAY_TOKEN_KIND`, `RAILWAY_PROJECT_ID`, `OPENAI_BASE_URL`, `JARVIS_TTS_KEY` / `JARVIS_WHISPER_KEY` (key OpenAI separada), `JARVIS_TTS_MAX_CHARS`, `JARVIS_IMAGE_ASPECT`, `JARVIS_TEST_TIMEOUT_MS`, `JARVIS_HOME`, `JARVIS_MISSION_PROGRESS`, `JARVIS_LLM_PLANNER`, `JARVIS_DAILY_CALL_BUDGET` / `JARVIS_DAILY_TOKEN_BUDGET`, `JARVIS_WA_TYPING`, `CRONS_ENABLED`.

**Imagem / Creative:** free tier Gemini costuma ter **limit 0** pra image gen → ativa billing no [AI Studio](https://aistudio.google.com/) no mesmo projeto da `GEMINI_API_KEY`.

Redeploy após mudar env.

**Milhão:** serviço próprio no Railway (24/7), com env própria (`IG_FONTE=embed` — datacenter, ~6 posts/página). Não depende do PC nem do env do Jarvis.

### Matriz de permissão (AUTO / APPROVAL / BLOCKED)

Fonte de verdade: `TOOL_DEFS` + `npm run check:tools`. Desde 0.9.73 o WA segue a mesma regra do Assist: high e critical pedem SIM (`JARVIS_HITL_WHATSAPP=0` desliga).

| Classe | Regra | WA (default) | Assist web | Tools |
|--------|-------|--------------|------------|-------|
| **AUTO** | abaixo de `JARVIS_APPROVAL_THRESHOLD` (default **high**) | low/medium executam | low/medium executam | leitura, `dev_diagnose`, `dev_git_*`, `dev_railway_logs`, `dev_deploy_checklist`, `research_web_search`, `research_fetch_url`, `browser_*`, `cinerush_buscar`, `cutflix_status`, rotina/finance **low** |
| **APPROVAL** | `risk=critical` **sempre** HITL (ignora `JARVIS_HITL_WHATSAPP=0`) | **SIM &lt;id&gt;** | **SIM &lt;id&gt;** | `dev_railway_redeploy`, `dev_railway_restart`, `dev_apply_patch_local`, `dev_github_pr` |
| **BLOCKED** | `ownerOnly` + user ≠ owner | erro `só owner` | idem | quase todo `dev_*`, `research_*`, `browser_*`, ops CineRush/Attracione/SocialHub/Clipper/Cutflix |

**PC 2.7 (0.9.81)**: `pc_spotify_play`, `pc_spotify_now`, `pc_youtube_play`, `pc_open_url`, `pc_files_list`, `pc_files_search`, `pc_files_read` = low; `pc_open_path` = medium. Arquivos só leitura nas pastas pessoais + R:\Projetos (bloqueio de .env/.ssh/chaves/AppData; nunca abre executável). Conteúdo de arquivo volta como CONTEÚDO EXTERNO; resposta sintetizada com `pergunta`. Spotify via Web API + PKCE (Premium), refresh token cifrado no PC.

**TV (0.9.80, Jarvis Desktop → TV LG na rede local)**: `tv_status`, `tv_volume`, `tv_media`, `tv_key`, `tv_open_app`, `tv_input`, `tv_notify`, `tv_pair` = low; `tv_power` = medium. ownerOnly; a chave da TV fica só no PC (cifrada), o PC revalida tool/args e só fala com a TV pareada (certificado conferido).

**PC (0.9.79, Jarvis Desktop)**: `pc_status`, `pc_volume`, `pc_media`, `pc_open_app` = low; `pc_lock`, `pc_screenshot` = medium; `pc_close_app` = **high** (SIM). Todas ownerOnly e executadas só no PC do próprio usuário, que revalida tool e argumentos (lista própria) e tem interruptor local na bandeja.

**High** (não critical): pedem SIM no Assist **e no WA** (threshold default high). Exemplos: `dev_run_tests`, `cinerush_criar`, `attracione_coleta`, `recategorizar`, `socialhub_publicar_agendados`.

**Medium**: executa direto nos dois canais, salvo `JARVIS_APPROVAL_THRESHOLD=medium`. Exemplos: `sincronizar_bancos`, `creative_generate_image`, `dev_propose_patch`, `research_write_report`.

Validação: `npm run check:tools` — falha se def sem handler, handler órfão, ou Manual sem listar os **critical**.  
`GET /api/ia/os` → `permissionMatrix.documented=true` + lista `tools.critical`.

`JARVIS_HITL=0` desliga HITL global (não recomendado). Proativo **nunca** dispara CRITICAL.

Proativo: Railway FAIL 15min · Ops (Editor/Havok/Attracione) 30min · sweep geral 3h — só aviso.

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
12. WA: manda áudio → transcrição (Gemini, só precisa `GEMINI_API_KEY`); com `JARVIS_TTS=auto` + `OPENAI_API_KEY` volta também voice note
13. WA: `gera imagem de um gato astronauta` → texto + foto no chat

---

## 3. Ainda não dá pra “ligar no código” sem você

| Item | Por quê | O que fazer |
|------|---------|-------------|
| **Editor de vídeo CineRush em massa** | ✅ ligado (`cinerush_editor_*`) | Confere `CINERUSH_EDITOR_URL` + `CINERUSH_EDITOR_OPS_KEY` |
| **Projeto Milhão** | Precisa rede Railway→PC/túnel | Sobe Docker + seta `PROJETO_MILHAO_URL` |
| **Validar botões Evolution** | Depende da build da Evolution | Testa HITL; se botão não aparecer, texto SIM/NÃO já funciona |
| **TTS (voice note)** | Precisa OpenAI key | `OPENAI_API_KEY` + `JARVIS_TTS=auto` (STT já roda no Gemini) |
| **Multi-user WA** | Precisa logins reais | `WHATSAPP_PHONE_USERS=fone:login` |

---

## 4. Comandos úteis

```
missão: …
prepara landing do cutflix
próximo passo
mete marcha / executa missão
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
lista lições / o que você aprendeu?
esquece a lição ab12cd
lista receitas
apaga a receita ab12cd
refaz plano
parear pc
meus dispositivos
desconecta o dispositivo ab12cd
```

**Desktop (0.9.76):** `parear pc` gera um código de 8 caracteres (10 min, uso único) pra digitar no Jarvis Desktop (`desktop/`, `npm start`, abre com **Alt+J**). Cada aparelho tem token próprio (só o hash fica no banco) e pode ser revogado a qualquer hora; revogar derruba a conexão na hora.

**Lições (0.9.75):** toda falha de tool vira lição (`jarvis_lessons`), agrupada por tool + projeto + erro normalizado; repetição soma. Quando a mesma tool passa no mesmo projeto, a lição fecha e guarda os args que funcionaram. Lições dos projetos citados entram no contexto do turno (`pack.licoes`) e no planner.
**Receitas (0.9.75):** missão concluída sem erro vira receita (`jarvis_recipes`). Missão nova com objetivo parecido **e os mesmos projetos** é montada pela receita (o board avisa); nada executa sem `executa missão`. `refaz plano` descarta a receita e planeja do zero.

Missões: `próximo passo` = 1 passo (`bora`/`continua` soltos só valem com missão viva de até 6h); `mete marcha` / `executa missão` = batch com pings (`Passo 2/4 · ok`); board em `status missão`.  
`prepara landing …` abre missão tipada sozinho (orquestrador) — research + **outline de copy** (`creative_landing_copy`) + checklist.  
`JARVIS_MISSION_PROGRESS=0` desliga pings no WA.
API: `GET /api/ia/os` · `GET /api/ia/missions` · `GET /api/ia/status`

---

## 5. Docs de fase

- `docs/JARVIS_SYSTEM_AUDIT.md` — plano original  
- `docs/JARVIS_PHASE1_CHECKPOINT.md` … `PHASES_7_11` / `DEBT_REDUCTION.md`  
- Este arquivo = **só o manual**
