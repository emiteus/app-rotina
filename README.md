# App Rotina 📅

Dashboard pessoal para gerenciar rotina diária, financeiro e alarmes com notificações via Telegram.

## Começar rápido

```bash
# Instalar dependências
npm install

# Criar arquivo .env
cp .env.example .env

# Preencher TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID (opcional)

# Iniciar servidor
npm start
```

Acesso em: http://localhost:3000

## Features

### Rotina Diária
- [ ] Academia
- [ ] Attracione — produzir 5 vídeos
- [ ] Laranjeira — produzir 10 vídeos
- [ ] Gerar 10 vídeos de filmes

**Reseta todo dia às 00:01**

### Financeiro
- Entradas e saídas
- Saldo em tempo real
- Histórico de transações

### Alarmes
- Define hora + mensagem
- Dispara via Telegram
- Notificação automática

## API Endpoints

```
GET    /api/tasks           # Lista tarefas do dia
POST   /api/tasks           # Criar tarefa
PATCH  /api/tasks/:id       # Marcar concluída
DELETE /api/tasks/:id       # Deletar tarefa

GET    /api/financeiro           # Lista + saldo
POST   /api/financeiro           # Criar transação
DELETE /api/financeiro/:id       # Deletar transação

GET    /api/alarmes        # Lista alarmes
POST   /api/alarmes        # Criar alarme
DELETE /api/alarmes/:id    # Deletar alarme
```

## Configurar Telegram Bot

1. Fale com [@BotFather](https://t.me/botfather) no Telegram
2. Copie o token
3. Coloque em `.env` como `TELEGRAM_BOT_TOKEN`
4. Seu chat ID vai para `TELEGRAM_CHAT_ID`

## Próximos passos

- [ ] PWA setup (modo offline + notificações push)
- [ ] Deploy Railway
- [ ] Gráficos de financeiro
- [ ] Integração com Google Calendar
