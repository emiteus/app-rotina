# Deploy no Railway — App Rotina

Guia passo a passo pra colocar o app na nuvem. Após o deploy, você acessa pelo navegador do celular ou de qualquer computador.

## O que continua igual

- **Electron desktop**: continua funcionando no PC (aponta pra `localhost:3000`).
- **Banco Neon**: já está na nuvem, não muda nada.

## O que muda

- Passa a existir uma **URL pública** (ex.: `https://app-rotina.up.railway.app`) que abre o app no navegador. Basta favoritar no cel.

---

## Passo a passo

### 1. Subir o código pro GitHub

Se ainda não tem repo:
```bash
cd C:\Users\mateu\app-rotina
git add .
git commit -m "prep: deploy Railway"
# Cria repo PRIVADO em github.com/new (importante: PRIVADO — o código toca teu dinheiro)
git remote add origin https://github.com/SEU_USER/app-rotina.git
git push -u origin main
```

⚠️ **Repositório privado**, sempre. O `.env` está no `.gitignore` (verificado), mas o resto do código também não precisa ser público.

### 2. Criar projeto no Railway

1. Vai em [railway.app](https://railway.app) → New Project → **Deploy from GitHub repo**
2. Autoriza o Railway a ler teu repo
3. Escolhe o repo `app-rotina`
4. Railway detecta Node.js sozinho e começa o build

### 3. Configurar variáveis de ambiente no Railway

No painel do projeto → **Variables** → adiciona (copia direto do teu `.env` local):

| Variável | Valor |
|---|---|
| `DATABASE_URL` | (a mesma do Neon que você já tem) |
| `APP_PASSWORD` | (senha do app — **considere trocar pra uma forte agora que fica público**) |
| `SESSION_SECRET` | (gera um novo, aleatório e longo — não usa o padrão) |
| `PLUGGY_CLIENT_ID` | (o teu) |
| `PLUGGY_CLIENT_SECRET` | (o teu) |
| `TELEGRAM_BOT_TOKEN` | (opcional, se for usar depois) |
| `TELEGRAM_CHAT_ID` | (opcional) |
| `NODE_ENV` | `production` |

⚠️ **NÃO precisa configurar `PORT`** — o Railway define sozinho.

### 4. Gerar domínio público

No painel do projeto → **Settings** → **Networking** → **Generate Domain**. Aparece uma URL tipo `app-rotina-xxxx.up.railway.app`. É a URL do teu app.

### 5. Testar

1. Abre a URL no navegador do PC → deve aparecer a tela de login → entra com a `APP_PASSWORD`
2. Se tudo funcionar, abre no celular
3. **Favorita** no cel (ou usa "Adicionar à tela inicial" pra parecer um app)

---

## Depois do deploy

- **Cada push pro `main`** faz redeploy automático (feature do Railway)
- **Logs**: no painel do Railway, aba "Deploy Logs"
- **Custo**: o Railway free tier normalmente dá pra um app pequeno como este. Se estourar, ~US$5/mês
- **Continua rodando 24/7** — o Railway não coloca pra dormir

## Segurança — checklist depois do deploy

- [ ] Trocar `APP_PASSWORD` por uma senha longa e única (ela é a única barreira agora que tá público)
- [ ] Gerar `SESSION_SECRET` novo aleatório (`openssl rand -base64 32` ou similar)
- [ ] Confirmar que o repo é **privado** no GitHub
- [ ] Rotacionar senha do Neon (opcional, mas boa prática) e atualizar `DATABASE_URL` no Railway

## Se algo der errado

Erro | Onde olhar
---|---
Página não carrega | Deploy Logs no Railway
Login não funciona / logout imediato | Confirma `NODE_ENV=production` e `SESSION_SECRET` configurados
Erro de banco | Confirma `DATABASE_URL` (a mesma do Neon)
Pluggy não conecta | Confirma `PLUGGY_CLIENT_ID` e `PLUGGY_CLIENT_SECRET`
