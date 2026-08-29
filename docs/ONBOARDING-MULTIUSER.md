# Multi-usuário — onboarding

App Rotina agora suporta **2 usuários** com dados isolados e ranking diário compartilhado ("Ofensiva do dia").

## Deploy / migração

1. **Backup** do Postgres antes do deploy.
2. No boot, `lib/migrate-multiuser.js` roda automaticamente:
   - Cria tabela `usuarios`
   - Adiciona `user_id` nas tabelas de dados
   - Atribui dados existentes ao owner (`mateus` ou `OWNER_LOGIN`)
3. Opcional: rodar seed manualmente:
   ```bash
   cd app-rotina
   node scripts/seed-usuarios.js
   ```

## Variáveis de ambiente

| Variável | Descrição |
|----------|-----------|
| `OWNER_LOGIN` | Login do dono (default: `mateus`) |
| `OWNER_SENHA` / `APP_PASSWORD` | Senha inicial do owner na migração |
| `COLEGA_LOGIN` | Login do colega (default: `colega`) |
| `COLEGA_SENHA` | Senha temporária do colega |
| `COLEGA_NOME` | Nome exibido no ranking |
| `COLEGA_COR` | Cor no ranking (hex, default `#3b82f6`) |
| `MAX_USERS` | Limite de contas (default: `2`) |
| `REGISTRATION_CODE` | Código de convite pro cadastro (opcional) |
| `SKIP_AUTH=true` | Só dev — pula login, usa `SKIP_AUTH_USER_ID` |

## Onboarding do colega

**Opção A — self-service (recomendado):**
1. Envie só a **URL do app** (e o código de convite, se configurou `REGISTRATION_CODE`).
2. Colega abre o app → **Primeira vez? Criar conta** → escolhe usuário e senha.
3. Só funciona enquanto houver vaga (`MAX_USERS`, default 2).

**Opção B — seed manual:**
1. Rode `node scripts/seed-usuarios.js` com `COLEGA_LOGIN` / `COLEGA_SENHA`.
2. Passe login/senha temporária pro colega.

Depois do cadastro:
- App começa vazio (tarefas/financeiro zerados).
- Cada um conecta **seus bancos** no Open Finance separadamente.
- Card **Ofensiva do dia** mostra progresso dos dois.

## Login

- Campo **usuário** + **senha** no modal de login.
- Sessão guarda `userId`, `userName`, `userLogin`.
- Cadastro self-service: `POST /api/auth/register` (enquanto houver vaga).
- Status do cadastro: `GET /api/auth/cadastro` → `{ aberto, vagas, precisaCodigo }`.

## Ranking

- `GET /api/ranking/dia` — único endpoint cross-tenant (só leitura agregada).
- Atualiza via WebSocket `ranking-dia` ao concluir tarefa.

## Notas

- Bancos Pluggy do owner permanecem no `user_id` dele após migração.
- Streak pessoal continua em `/api/tasks/stats` (gráficos); card principal virou ranking.
- Recuperação de senha e convites por link **não** estão no escopo.
