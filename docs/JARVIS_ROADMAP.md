# JARVIS Roadmap — status

**Version:** 0.9.91  
**Date:** 2026-09-22

## Norte

Ver **[JARVIS_ROADMAP_MCU.md](./JARVIS_ROADMAP_MCU.md)** (JARVIS do filme: PC, voz, casa, redes).
Plano anterior (30/60/90, concluído): [JARVIS_GAP_MAP_3.0.md](./JARVIS_GAP_MAP_3.0.md).

### Princípio

**Conexão real > atalhos NL.**  
**Capacidade geral > gambiarra de domínio**.

## Done

- **0.9.91**: pedido de SIM só com a pergunta ("Posso apagar a transação (Mercado)?"), sem instrução nem código — Mateus: poluía o WhatsApp. Continua pedindo SIM do mesmo jeito
- **0.9.90**: conversa de gente (Mateus, print "Não consegui **cinerush_editor_job_status**: job_id ou batch_id obrigatório"): `src/nl/humanize.js` com nome em português pra todos os 101 comandos, erro técnico → motivo humano (faltou dado → pergunta; offline/timeout/401/erro em inglês/lista de opções → frase), filtro final `humanizeReply` em toda resposta (core.runJarvisTurn) e no histórico; pedido de SIM em português ("Posso apagar a transação (Mercado)?"); prompt proíbe nome de comando/campo/JSON; app do PC mostra "Toquei no Spotify." / "Não deu pra abrir o site."
- **0.9.89**: redes com calma (Instagram deu 429 no 1º teste real com chamadas diretas à API): freio `desktop/src/social/limits.js` gravado em disco (30 páginas/dia por rede, 429 → pausa 6 h, verificação/challenge → 24 h, a maior vale), 45 s entre páginas, cache 15 min, bloqueio não entra no cache. Instagram agora abre o perfil/post como pessoa e lê o que a própria página carregou (captura via debugger, `igPostsFromCapture`/`igCommentsFromCapture`); nome da conta = 1 chamada guardada. Pegadinha: Network.enable trava em janela que nunca navegou → about:blank antes. Tempos: soc_* 130 s, resumo 280 s, Desktop espera 320 s
- **0.9.88**: Desktop abre com o Windows (chave Run do usuário, nome "Jarvis", direto na bandeja com --hidden; em dev = electron.exe + pasta do app) e interruptor "Abrir com o Windows" na bandeja
- **0.9.87**: Desktop comia ~48% da CPU do PC (Mateus notou com a Steam): onnxruntime do "Ei Jarvis" no padrão (1 thread por núcleo, girando entre execuções) = 312% de um núcleo e ainda atrasava → 1 thread, sem spinning = 3% (medido); Jarvis inteiro ~1% do PC. Janela por voz não aparece por cima de jogo/app em tela cheia (SHQueryUserNotificationState, `desktop/src/fullscreen.js`); ativação fraca só mostra a janela depois que o servidor confirma
- **0.9.86**: **Fase 4.1–4.2 MCU (redes, só leitura)**: tools `soc_status/login/posts/comments/inbox/summary`. Navegador do Jarvis (Electron, partição `persist:jarvis-social`, UA de Chrome, só domínios das redes/SSO, sem downloads/permissões, cookies cifrados via fuse EnableCookieEncryption) com leitores fixos: Instagram pela API interna do site (posts/reels, comentários, DMs), X e TikTok pelo DOM/estado da página; YouTube pela Data API (OAuth app de computador, youtube.readonly, sem search.list). 1 leitura por vez por rede, 12 s de intervalo, cache 3 min. Resposta sintetizada com `pergunta` e conteúdo como CONTEÚDO EXTERNO (`handlers/data-answer.js`, compartilhado com arquivos)
- **0.9.85**: "Jarvis" em português (J de "já"): modelo inglês pontua 0,16–0,49 (12 vozes pt-BR medidas; negativos 0,00–0,01) → ativação fraca ≥ 0,12 (espera 240 ms pra ver se vira forte) marcada `weak`; servidor só segue se a transcrição tiver o nome (`mentionsJarvis`), senão responde `ignored` em silêncio. Pré-gravação 1,2 s; fala antes da ativação ≥ 900 ms conta como pedido (português ativa no fim da frase). Piso de ruído desce rápido e sobe devagar (a própria voz inflava o piso)
- **0.9.84**: modo rápido (flash-lite) respondeu "tocar vidigal" sem ação, copiando o erro antigo do histórico → comando (`looksLikeCommand`) sem ação no modo rápido refaz com o 3.5-flash; linhas de falha ("Não consegui…", "No PC: … não rodou") saem do histórico da decisão
- **0.9.83**: voz mais rápida (medido): turno de PC/áudio em flash-lite sem pensamento com pedido reserva (`src/hedge.js`), ~0,7 s vs 3–10 s no 3.5-flash; STT com reserva escalonada (flash-lite, flash-lite, 3.5-flash) a cada 2 s, mediana 1,5 s vs 3,6–5 s; timeout do 1º continua indo direto pro Anthropic. Spotify: busca sem `market=from_token` (exige user-read-private)
- **0.9.82**: fix voz: "Jarvis, <pedido>" curto virava saudação local ("Tranquilo, senhor…") sem chamar o modelo; agora só é saudação se não sobrar pedido. Fim de fala relativo à voz (ruído de fundo não segura a gravação; 800 ms). Tempos por etapa no log (`jarvis.voice` timing no servidor; gravandoMs/servidorMs no Desktop)
- **0.9.81**: **Fase 2.7 MCU (autonomia no PC)**: Spotify tocando de verdade (Web API + PKCE, Premium; abre o app se fechado), 1º vídeo do YouTube, abrir sites (só http/https), arquivos só leitura (listar/procurar/ler com resposta à `pergunta`, conteúdo como CONTEÚDO EXTERNO; raízes pessoais + R:\Projetos com realpath, bloqueio de segredos) e abrir pasta/arquivo (nunca executável); marcadores de conteúdo externo saem da tela/fala do Desktop e do TTS
- **0.9.80**: **Fase 3 MCU (TV LG direto pelo PC)**: tools `tv_status/power/volume/media/key/open_app/input/notify/pair`; Desktop fala SSAP com a TV (wss 3001 com certificado LG ou TOFU, sem fallback pra ws em cert trocado), pareamento com "Permitir" na TV, chave cifrada só no PC, Wake-on-LAN pra ligar, reencontra a TV por UUID se o IP mudar; apps pelo nome do que está instalado; Home Assistant fica pra quando tiver mais aparelhos
- **0.9.79**: **Fase 2.6 MCU (comandos no PC)**: tools `pc_status/volume/media/open_app/close_app/lock/screenshot` na matriz (fechar app pede SIM); servidor → gateway → Desktop, que revalida com lista própria (sem shell livre; volume por Core Audio via DLL compilada 1x; teclas de mídia; apps só da lista, Explorer não fecha); interruptor local na bandeja; tudo que roda aparece na conversa
- **0.9.78**: **Fase 2.4/2.5 MCU (voz no Desktop)**: "hey jarvis" local (openWakeWord portado pra Node, testado com áudio real: positivos ~0,99, negativos ~0,00), gravação até a pausa, transcrição no servidor (`voice` no `/jarvis-device`), resposta falada (OpenAI; sem crédito → voz local do Windows), interromper falando por cima, atalho Alt+Shift+J. Correções: modelos Gemini desligados pelo Google (2.5/2.0/1.5-flash davam 404 → STT do WA, visão e compose estavam quebrados) trocados por 3.5-flash/3.5-flash-lite; `check:models` testa cada modelo de verdade; TTS com fallback Gemini + disjuntor quando a OpenAI fica sem crédito
- **0.9.77**: pareamento sem caracteres confundíveis (0/O 1/I 2/Z 5/S 6/G 8/B), validade calculada no banco, motivo da falha no log; embeddings `text-embedding-004` (desligado) → `gemini-embedding-001`
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

- **Fase 3 MCU**: parear a TV LG de verdade (TV ligada) e testar por voz; HA quando chegarem mais aparelhos
- **Fase 4.3 MCU**: escrever nas redes (postar/responder/DM) sempre critical com prévia exata + SIM

## Backlog (só sob pedido)

- Compose sharp estável  
- Sandbox Dev / pgvector  
- Mais adapters ops (Editor, Cutflix)  
- Playwright em prod (`JARVIS_BROWSER_HEADLESS=1`) — **feito em Railway**
