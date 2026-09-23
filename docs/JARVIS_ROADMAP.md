# JARVIS Roadmap — status

**Version:** 0.9.76  
**Date:** 2026-09-22

## Norte

Ver **[JARVIS_ROADMAP_MCU.md](./JARVIS_ROADMAP_MCU.md)** (JARVIS do filme: PC, voz, casa, redes).
Plano anterior (30/60/90, concluído): [JARVIS_GAP_MAP_3.0.md](./JARVIS_GAP_MAP_3.0.md).

### Princípio

**Conexão real > atalhos NL.**  
**Capacidade geral > gambiarra de domínio**.

## Done

- **0.9.76**: **Fase 2.1–2.3 MCU**: pareamento de aparelho (`parear pc` → código de uso único → token com hash no banco), canal WebSocket `/jarvis-device` (turno por aparelho em fila, limite por minuto, revogação derruba na hora) e app `desktop/` (Electron: Alt+J, bandeja, aprovação por botão, token cifrado com DPAPI). App Rotina: WebSocket agora autenticado pela sessão e eventos só pro dono (antes qualquer um conectava e recebia alarmes/eventos de todos)
- **0.9.75**: **Fase 1 MCU**: lições (`jarvis_lessons`, falha vira lição e sucesso resolve; entram no turno e no planner) + receitas (`jarvis_recipes`, missão ok vira receita, objetivo parecido com mesmos projetos reusa) + comandos `lista lições`/`esquece a lição`/`lista receitas`/`apaga a receita`/`refaz plano`. Lote 3: tool sem registro bloqueada, LIKE escapado, ensureTable 1x por processo, chave Gemini no header, prompt usa o nome do usuário
- **0.9.74**: auditoria lote 2: fila por número no WA (sem turno paralelo) e silêncio pra número desconhecido; regra de dados de terceiros (PIX/clientes/suporte) no prompt; missão parada em running vira failed honesto e "bora"/"continua" soltos só valem com missão recente; agente browser in-process (sessão headless sobrevive); timeout do Gemini vai direto pro fallback; budget grava incrementos (worker contabilizado); reindex de embedding só do trecho que mudou, fora do turno
- **0.9.73**: auditoria lote 1: atalhos NL não gravam em pergunta/frase solta (só item real, com id); áudio do usuário não é mais "conteúdo externo"; SIM de outro pedido não conclui passo de missão; timeouts ≥ conectores + worker não re-executa lote já iniciado ("sem confirmação"); SSRF (faixas reservadas, redirect validado por salto, guarda de rede no headless); `/api/whatsapp/status` só logado; WA pede SIM em high
- **0.9.72**: HITL e quarentena: marcador externo neutralizado; `dev_run_tests` pede SIM após patch local; "pode" solto não aprova; pedido novo = id novo; critical não passa com `JARVIS_HITL=0`
- **0.9.71**: resolve TeuHub/teuhub (token match; alias real) + `pausa` NL
- **0.9.70**: SocialHub ops flags live (`crons` → publish + refresh-tokens)
- **0.9.69**: MCU — subagentes fork + séries analytics + voice contínua
- **0.9.68**: embeddings Gemini; adapter Approtina; browser headless
- **0.9.67**: NL infer pause/retoma ops flags
- **0.9.66–0.9.60**: ops flags, NL, layout

## Próximo

- **Fase 2.4/2.5 MCU**: voz no Desktop (openWakeWord "hey jarvis" + STT no servidor + TTS OpenAI)

## Backlog (só sob pedido)

- Compose sharp estável  
- Sandbox Dev / pgvector  
- Mais adapters ops (Editor, Cutflix)  
- Playwright em prod (`JARVIS_BROWSER_HEADLESS=1`) — **feito em Railway**
