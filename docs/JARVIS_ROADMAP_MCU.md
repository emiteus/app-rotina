# JARVIS Roadmap MCU

**Date:** 2026-09-22 · **Baseline:** v0.9.72
**Substitui como norte:** [JARVIS_GAP_MAP_3.0.md](./JARVIS_GAP_MAP_3.0.md) (plano 30/60/90 concluído)

## Norte

Chegar o mais perto possível do JARVIS do filme:

- interface própria no PC, sempre à mão
- conversa por voz, com resposta falada
- controle do PC e dos aparelhos da casa
- redes sociais operadas pelo próprio PC, com as contas já logadas
- tudo isso só quando o Mateus pedir ou aprovar

WhatsApp continua sendo um canal, não o centro. O cérebro continua no Railway; o PC ganha um **agente local** que executa o que a nuvem não alcança.

## Arquitetura alvo

```
            ┌──────────────── Railway (cérebro) ────────────────┐
            │ core · tools · memória · missões · HITL · agentes │
            └───────▲───────────────────▲───────────────▲───────┘
                    │ WhatsApp           │ Assist web     │ WebSocket de saída
                    │                    │                │ (PC conecta na nuvem,
                    │                    │                │  sem abrir porta)
                                                  ┌───────┴─────────────────┐
                                                  │ Jarvis Desktop (PC)     │
                                                  │ interface + voz         │
                                                  │ tools locais (pc_*)     │
                                                  │ navegador logado (soc_*)│
                                                  │ ponte Home Assistant    │
                                                  └───────┬─────────────────┘
                                                          │ rede local
                                                  Home Assistant → luzes, TV, tomadas…
```

Regra de ouro: **a nuvem decide, o PC executa, e o PC só aceita comando de tool registrada.** Nada de shell livre vindo da nuvem.

---

## Fase 1 · Aprender com erros e receitas ✅ 0.9.75

Termina o item #8 do plano 3.0 (memória operacional), que ficou pela metade: hoje `ultima_falha` guarda uma falha só por projeto e sobrescreve.

| # | Entrega | Aceite |
|---|---------|--------|
| 1.1 | **Lições**: tabela `jarvis_lessons` (tool, projeto, sintoma, causa, o que resolveu, contagem, resolvida?). Grava sozinha a cada falha de tool; marca resolvida quando a mesma coisa passa depois | falha repetida incrementa a lição em vez de duplicar |
| 1.2 | Lições relevantes entram no contexto do planner e do turno (recall por embedding que já existe) | missão que falhou por X não repete X na próxima |
| 1.3 | **Receitas**: missão concluída sem erro vira sequência salva de tools existentes | pedido parecido sugere a receita; você aceita ou não |
| 1.4 | "esquece essa lição" / "lista receitas" por NL | controle manual do que ele aprendeu |

**Fora de escopo:** Jarvis escrevendo tool nova sozinho. Tool nova só via `dev_github_pr` + revisão + SIM.

**Como ficou (0.9.75):** lições entram no contexto casadas por **tool e projeto** (não por embedding): previsível e sem custo de API; embedding fica pra quando houver volume. Receita só é reusada com os **mesmos projetos** no objetivo, senão os args apontariam pro projeto errado. Aceite da receita = a missão é criada parada; nada roda sem `executa missão`, e `refaz plano` descarta.

---

## Fase 2 · Jarvis Desktop (interface + voz no PC) ✅ 0.9.79

App novo no PC (Electron, Windows primeiro), separado do App Rotina.

| # | Entrega | Aceite |
|---|---------|--------|
| 2.1 | **Conexão**: WebSocket de saída pro host, pareamento com código de uso único, token de dispositivo revogável | PC aparece como "online" no `GET /api/ia/os`; revogar corta na hora |
| 2.2 | **Interface**: janela/overlay com atalho global, histórico, cards de ação, pendências | abre com atalho em qualquer app |
| 2.3 | **Aprovação na tela**: pedido de SIM vira botão no desktop (além do WA) | aprovar pelo PC executa; negar cancela |
| 2.4 | **Voz de entrada**: palavra de ativação local ("Jarvis"), STT com streaming, push-to-talk como fallback | fala "Jarvis, …" e ele entende sem clicar |
| 2.5 | **Voz de saída**: TTS com streaming, voz fixa do Jarvis, dá pra interromper falando por cima | resposta começa a tocar em menos de ~1,5 s |
| 2.6 | **Tools locais `pc_*`** (allowlist): abrir/fechar app, volume, mídia (play/pause/próxima), print da tela sob pedido, ler arquivo em pastas liberadas, lembrete local | cada tool com risco próprio na matriz |

Riscos por tool no PC:

| Tool | Risco |
|------|-------|
| volume, mídia, abrir app, status | low |
| print da tela, ler arquivo liberado | medium |
| fechar app, mover/renomear arquivo | high |
| apagar arquivo, instalar algo, desligar PC | critical (SIM sempre) |

---

## Fase 2.7 · Autonomia no PC ✅ 0.9.81

"Toca Matuê" (Spotify Premium via API oficial), "toca X no YouTube", "abre o Gmail", "o que tem na pasta Downloads?", "lê o README e me diz o que falta". Arquivos só leitura, nas pastas pessoais + R:\Projetos, com segredos sempre bloqueados.

## Fase 3 · Casa via Home Assistant

**0.9.80 — TV LG direto pelo PC ✅ (código).** Com um aparelho só, HA em VM seria peso sem ganho: o Jarvis Desktop fala com a TV LG na rede local (tools `tv_*`, chave só no PC, Wake-on-LAN pra ligar). Falta parear com a TV ligada. O HA entra quando chegarem luz/tomada/etc.; aí `tv_*` pode passar a ir pelo HA sem mudar as frases.

Home Assistant faz a ponte com quase todo aparelho (Tuya, Sonoff, Philips Hue, TVs, Alexa/Google via integração). O Jarvis não fala com cada marca; fala com o HA.

| # | Entrega | Aceite |
|---|---------|--------|
| 3.1 | HA rodando (PC ou Raspberry) com os aparelhos da casa | aparelhos visíveis no painel do HA |
| 3.2 | Ponte no Jarvis Desktop (token do HA fica **só no PC**, nunca na nuvem) | nuvem pede, PC chama o HA |
| 3.3 | Tools `home_*`: listar, estado, ligar/desligar, cenas, com **allowlist de entidades** | "Jarvis, apaga a luz do quarto" funciona por voz |
| 3.4 | Cenas nomeadas ("modo cinema", "saindo de casa") como receitas | uma frase aciona várias ações |

Fechadura, alarme, portão e câmera = critical (SIM sempre). Luz, tomada, TV = low.

---

## Fase 4 · Redes sociais pelo PC

**4.1–4.2 ✅ 0.9.86 (código; falta o Mateus logar):** Instagram, TikTok, X e YouTube só leitura. 4.3 (escrever) é a próxima.

Em vez de API oficial (Meta travou `content_publish`), o Jarvis usa **o navegador do próprio PC com as contas já logadas**, só quando você pedir.

| # | Entrega | Aceite |
|---|---------|--------|
| 4.1 | Perfil de navegador **dedicado** (Playwright com contexto persistente), separado do Chrome pessoal. Você loga uma vez; o Jarvis nunca vê nem digita senha | sessão sobrevive a reinício do PC |
| 4.2 | Leitura (`soc_read_*`): métricas, comentários, DMs não lidas, resumo do dia | "Jarvis, como foi o post de ontem?" |
| 4.3 | Escrita (`soc_post`, `soc_reply`, `soc_dm`): **sempre critical** com preview (conta, texto, mídia, destino) antes do SIM | nada sai sem você ver exatamente o que vai sair |
| 4.4 | Receitas por rede (Instagram, TikTok, YouTube, X) com seletores isolados, fácil de consertar quando o site mudar | quebra de layout vira lição + aviso, não ação errada |
| 4.5 | Sessão caiu / pediu 2FA → Jarvis avisa e **você** loga | nunca tenta contornar login ou captcha |

Cuidados que valem pra fase inteira:

- **Risco de bloqueio da conta**: redes detectam automação. Ritmo humano, volume baixo, zero ação em massa (seguir/curtir em lote está fora).
- Conteúdo de DM e comentário é **conteúdo externo** (quarentena da 0.9.72): pedido escrito numa DM nunca vira ação.
- Log local de tudo que foi postado/enviado.

---

## Fase 5 · Polimento MCU

**5.1 e 5.2 ✅ 0.9.92:** avisos falados no PC (você no PC → fala e não vai pro WhatsApp; longe/silêncio → WhatsApp) e briefing do dia na primeira vez que você usa o PC.

| # | Entrega |
|---|---------|
| 5.1 | Proatividade por voz: "deploy do CineRush falhou", "vence o DAS amanhã" falado no PC (horário silencioso respeitado) |
| 5.2 | Briefing do dia falado ao ligar o PC (agenda, finanças, ops, redes) |
| 5.3 | 🟡 0.9.98 · Personalidade e voz consistentes em todos os canais: PC e celular já falam com a voz do WhatsApp (Charon); avisos e briefing também (0.9.99); falta só escolher a voz final quando houver TTS rápido |
| 5.4 | ✅ 0.9.93 · Contexto do que está na tela sob pedido ("Jarvis, o que tá errado aqui?") usando vision v2 |
| 5.5 | ✅ 0.9.96 · Celular como segundo dispositivo (mesmo pareamento da Fase 2): página instalada no iPhone, "segure pra falar", avisos por notificação |

---

## Princípios

1. **Evoluir, não reescrever.** Core, tools, HITL e memória atuais são a base de tudo.
2. **Uma fase por vez.** Fase só começa quando a anterior tem aceite.
3. **Allowlist sempre**: tools, pastas, entidades da casa, contas.
4. **Poder novo = risco na matriz** antes de existir. `check:tools` valida.
5. **Segredos ficam onde são usados**: token do HA e sessões das redes só no PC.
6. **Conteúdo externo nunca é instrução**: páginas, DMs, comentários, e-mails.

## Decisões em aberto

- ~~TTS~~ **OpenAI** (decidido 22/09/2026)
- ~~Palavra de ativação~~ **openWakeWord** (decidido 22/09/2026). O modelo pronto é "hey jarvis"; só "Jarvis" exige treinar um modelo próprio.
- Home Assistant no PC (só funciona com PC ligado) ou num Raspberry (sempre ligado)?
- Quais aparelhos existem hoje na casa?
- Quais redes entram primeiro na Fase 4?
