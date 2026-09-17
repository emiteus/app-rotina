# JARVIS — O que é manual (faça você)

**OS home:** `R:\Projetos\Jarvis` (fonte de verdade).  
**Host:** App Rotina (`Approtina/app-rotina`) — sync com `npm run sync:host`.  
Código no deploy: **v0.8.3+**. Abaixo só o que depende de você / ambiente / produto externo.


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
| `CINERUSH_*` / `ATTRACIONE_*` / `SOCIALHUB_*` / `CLIPPER_*` | Projetos |
| `OPENAI_API_KEY` | Só se quiser Whisper no áudio |
| `JARVIS_HITL=1` | Confirmação high-risk no **Assist web** (default on) |
| `JARVIS_HITL_WHATSAPP=1` | Opt-in: também pede SIM no WhatsApp (default **off**) |
| `JARVIS_HITL_BUTTONS=1` | Opt-in: botões SIM/NÃO (default off — WA Web quebra) |

Redeploy após mudar env.

---

## 2. Smoke test (5 min)

1. WA: `oi` → resposta curta  
2. WA: `quais módulos` → lista registry  
3. WA: ação high-risk (ex. provisionar / recategorizar) → **SIM `<id>`** / **NÃO `<id>`** (botão ou texto)  
4. WA: `missão: sincronizar bancos e reconciliar` → `executa missão`  
5. Assist web: abrir chat → pills → **OS** (dashboard)  
6. Railway logs: `jarvis.turn` / `jarvis.ai` / `jarvis.tool`

---

## 3. Ainda não dá pra “ligar no código” sem você

| Item | Por quê | O que fazer |
|------|---------|-------------|
| **Editor de vídeo CineRush em massa** | ✅ ligado (`cinerush_editor_*`) | Confere `CINERUSH_EDITOR_URL` + `CINERUSH_EDITOR_OPS_KEY` |
| **Validar botões Evolution** | Depende da build da Evolution | Testa HITL; se botão não aparecer, texto SIM/NÃO já funciona |
| **Whisper** | Precisa da sua key OpenAI | Seta `OPENAI_API_KEY` se quiser fallback de áudio |
| **Multi-user WA** | Precisa logins reais | `WHATSAPP_PHONE_USERS=fone:login` |

---

## 4. Comandos úteis

```
missão: …
próximo passo
executa missão
cancela missão
agente ops: status cinerush
/finance quanto gastei
lembra que …
SIM a1b2c3d4 / NÃO a1b2c3d4
```

API: `GET /api/ia/os` · `GET /api/ia/missions` · `GET /api/ia/status`

---

## 5. Docs de fase

- `docs/JARVIS_SYSTEM_AUDIT.md` — plano original  
- `docs/JARVIS_PHASE1_CHECKPOINT.md` … `PHASES_7_11` / `DEBT_REDUCTION.md`  
- Este arquivo = **só o manual**
