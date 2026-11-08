# Entrar com Google, Discord e GitHub

O Project Club aceita login (e inscrição) com Google, Discord e GitHub.
Cada provedor só aparece no site depois que as **duas** variáveis dele
estiverem configuradas no servidor. Sem nenhuma, nada muda: os botões
simplesmente não aparecem.

Código: `server/src/services/oauth.js` (regras), `server/src/controllers/oauthController.js`
(rotas), `client/src/components/auth/OAuthButtons.jsx` (botões),
`client/src/components/auth/ConnectedAccountsBlock.jsx` (Configurações → Segurança),
`desktop/oauthWindow.js` (app desktop).

## URLs de retorno (redirect / callback)

O servidor monta a URL de retorno a partir da **primeira** origem em
`CLIENT_ORIGIN` (a mesma variável que já monta os links dos e-mails de
redefinição de senha e de aprovação). Em produção ela deve ser
`https://projectclub.squareweb.app` (é o endereço que o app desktop e o
app Android abrem; `SUBDOMAIN=projectclub` em `squarecloud.app`).

Cadastre exatamente estas URLs em cada provedor:

| Provedor | URL de retorno |
|---|---|
| Google  | `https://projectclub.squareweb.app/api/auth/oauth/google/callback` |
| Discord | `https://projectclub.squareweb.app/api/auth/oauth/discord/callback` |
| GitHub  | `https://projectclub.squareweb.app/api/auth/oauth/github/callback` |

Se um dia o site mudar de domínio, troque `CLIENT_ORIGIN` **e** as URLs
cadastradas nos três provedores. Para testar localmente (Vite em
`http://localhost:5173`, que repassa `/api` pro servidor), cadastre também
`http://localhost:5173/api/auth/oauth/<provedor>/callback`.

## Variáveis de ambiente (Square Cloud)

No painel da Square Cloud → app **Project Club** → *Variáveis de ambiente*
(as mesmas onde já estão `DATABASE_URL`, `JWT_ACCESS_SECRET` etc.):

| Variável | De onde vem |
|---|---|
| `GOOGLE_CLIENT_ID` | Google Cloud Console → Credenciais → ID do cliente OAuth |
| `GOOGLE_CLIENT_SECRET` | idem, "Chave secreta do cliente" |
| `DISCORD_CLIENT_ID` | Discord Developer Portal → sua aplicação → OAuth2 → Client ID |
| `DISCORD_CLIENT_SECRET` | idem, Client Secret (Reset Secret pra gerar) |
| `GITHUB_CLIENT_ID` | GitHub → Settings → Developer settings → OAuth Apps → Client ID |
| `GITHUB_CLIENT_SECRET` | idem, "Generate a new client secret" |

Nada mais é necessário: os cookies de estado são assinados com o
`JWT_ACCESS_SECRET` que já existe. Depois de salvar as variáveis,
reinicie o app. `GET /api/auth/oauth/providers` mostra quais ficaram ativos.

Os segredos nunca vão pro navegador nem pro repositório.

## Criando os apps em cada provedor

### Google (Google Cloud Console)

1. Acesse <https://console.cloud.google.com/> e crie (ou escolha) um projeto.
2. **APIs e serviços → Tela de consentimento OAuth** (ou "Google Auth Platform → Branding"):
   tipo **Externo**, nome "Project Club", e-mail de suporte, logo opcional,
   domínio autorizado `squareweb.app`, link da política de privacidade
   `https://projectclub.squareweb.app/privacidade`.
3. Escopos: `openid`, `email`, `profile` (nenhum escopo sensível).
4. Publique o app (status "Em produção"); em "Teste", só os e-mails da lista de testadores conseguem entrar.
5. **Credenciais → Criar credenciais → ID do cliente OAuth → Aplicativo da Web.**
   - Origens JavaScript autorizadas: `https://projectclub.squareweb.app`
   - URIs de redirecionamento autorizados: `https://projectclub.squareweb.app/api/auth/oauth/google/callback`
6. Copie o ID e a chave secreta para `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

O fluxo do Google usa PKCE (S256) além do segredo.

### Discord (Discord Developer Portal)

1. Acesse <https://discord.com/developers/applications> → **New Application** → "Project Club".
2. Menu **OAuth2**:
   - Copie o **Client ID**; em **Client Secret** clique em *Reset Secret* e copie.
   - **Redirects → Add Redirect**: `https://projectclub.squareweb.app/api/auth/oauth/discord/callback` → *Save Changes*.
3. Não precisa de bot nem de "Public Client". Escopos usados: `identify email`.
4. Preencha `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`.

### GitHub (OAuth Apps)

1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**
   (ou <https://github.com/settings/applications/new>; para uma organização,
   use as configurações da organização).
2. Application name: "Project Club"; Homepage URL: `https://projectclub.squareweb.app`;
   **Authorization callback URL**: `https://projectclub.squareweb.app/api/auth/oauth/github/callback`.
   Deixe "Enable Device Flow" desligado.
3. **Register application** → copie o Client ID → **Generate a new client secret** e copie.
4. Preencha `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`.

Escopos usados: `read:user user:email` (o e-mail vem do e-mail **primário verificado** da conta).

## Como funciona (regras)

- **Login**: `GET /api/auth/oauth/<provedor>/start` grava um cookie httpOnly
  assinado (10 min) com um `state` aleatório (e o verificador PKCE no Google)
  e manda pro provedor. No `callback` o `state` é conferido, o código é trocado
  **no servidor**, o perfil é lido e o token do provedor é descartado (nunca é
  salvo nem logado).
- **Conta já conectada** → entra com a **mesma** sessão do login com senha
  (cookie de refresh + access token, alerta de aparelho novo). Se a conta tem
  **2FA**, o login para numa etapa pendente (cookie assinado de 10 min) e a
  tela pede o código do app autenticador ou um código de recuperação
  (`POST /api/auth/oauth/2fa`). Conta banida, suspensa ou desativada é recusada.
- **E-mail (verificado pelo provedor) igual ao de uma conta existente, mas
  não conectada** → **não** conecta sozinho. A pessoa vê "entre com sua senha
  e conecte em Configurações → Segurança → Contas conectadas".
- **Sem conta** → vai pra inscrição já preenchida (nome, e-mail verificado,
  sugestão de ClubTag). A identidade fica num cookie assinado (30 min) e é
  guardada na inscrição (`MembershipApplication.oauthProvider/…`). A conta só
  é criada quando a **staff aprovar** — e aí a conta externa é conectada.
  A pessoa ainda cria uma senha.
- **Conectar/desconectar** pelas Configurações → Segurança → Contas conectadas.
  Uma conta externa só pode estar ligada a um membro; um membro tem no máximo
  uma conta de cada provedor.
- Rotas de OAuth têm limite de tentativas por IP (Redis), como o resto do login.

## App desktop e app Android

- **Desktop (Electron)**: Discord e GitHub abrem numa janelinha do próprio app
  (`desktop/oauthWindow.js`, com moldura, sem a ponte do preload, mesma sessão)
  e o login termina na janela principal. **O botão do Google fica escondido no
  app desktop**: o Google bloqueia login em navegadores embutidos
  (`Error 403: disallowed_useragent`). No desktop, quem usa Google entra pelo
  e-mail e senha (ou conecta Discord/GitHub). A janelinha só passa a existir
  depois de publicar uma versão nova do app desktop; até lá, nas versões antigas
  o Discord/GitHub abrem no navegador do sistema e o login não volta pro app.
- **Android (Capacitor)**: os botões ficam escondidos — links pra fora do site
  abrem no navegador do sistema e a sessão ficaria lá, não no app.

## Banco

`npm run prisma:push` (já roda no deploy) cria a tabela `OAuthAccount` e as
colunas `oauthProvider`, `oauthProviderUserId` e `oauthEmail` em
`MembershipApplication`. Nada é apagado.
