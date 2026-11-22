# Project Club em Rust — plano da reescrita

Pedido do dono: reescrever o Project Club **inteiro** em Rust.

Tudo isso fica no branch **`rust`** até o dono liberar (regra: coisa grande ou
arriscada fica em branch separado). Nada daqui vai pro ar sozinho.

## Tamanho (contado em 21/11/2026)

| Parte | Hoje | Linhas | Vira em Rust |
|---|---|---|---|
| API + sockets (`server/src`) | Node/Express/Prisma/Socket.IO | ~61 mil | Axum + SQLx (MySQL) + Redis + WebSocket próprio |
| Club Penguin (`server/waddle/src`) | TypeScript (Waddle Forever) | ~111 mil | servidor do jogo em Rust (protocolo XT/XML do CP) |
| Site (`client/src`) | React/Vite | ~126 mil | Leptos (Rust → WebAssembly) |
| App de PC (`desktop`) | Electron | ~12 mil | Tauri (Rust) |
| App Android (`android-nativo`) | Kotlin/Compose | ~22 mil | Tauri mobile (Rust + o mesmo front do site) |
| Voz (`media-server`) | Node + mediasoup | ~2,6 mil | crate `mediasoup` do Rust (mesmo motor) |

Total: ~335 mil linhas. O Flash do Club Penguin já roda no **Ruffle**, que é
Rust — isso não muda.

## Como fazer sem quebrar o site (substituição aos poucos)

Reescrever tudo de uma vez e trocar num dia só = semanas sem poder publicar
nada e um dia de troca com tudo quebrando junto. Em vez disso:

1. **Fase 1 — Gateway Rust na frente do Node** (`rust/pc-server`).
   O binário Rust escuta na porta do app; o Node passa pra uma porta interna.
   Rota já portada → Rust responde. Rota ainda não portada → o Rust repassa
   pro Node (HTTP e WebSocket, inclusive Socket.IO e o Club Penguin).
   O site e os apps não percebem diferença.
2. **Fase 2 — API rota por rota**, cada grupo com teste comparando a resposta
   do Rust com a do Node (mesmo banco, mesmo JSON). Ordem: system → auth/
   tokens → users → friends/scraps/testimonials → mensagens/conversas →
   comunidades/posts → economia/casas/figurinhas → staff/admin → o resto.
   Prisma sai; o banco MySQL e o Redis continuam os mesmos (sem migrar dado).
3. **Fase 3 — Tempo real**: Socket.IO → WebSocket em Rust (o cliente troca
   `socket.io-client` por um cliente WebSocket fino com os mesmos eventos).
4. **Fase 4 — Club Penguin** (servidor do jogo, arquivos, patches de SWF).
5. **Fase 5 — Voz** (`media-server` com a crate `mediasoup`).
6. **Fase 6 — Site em Leptos** (WASM), tela por tela, atrás de uma chave.
7. **Fase 7 — PC (Tauri) e Android (Tauri mobile)** usando o site novo.
8. Quando o Node não tiver mais rota nenhuma, ele sai e o Rust fica sozinho.

Cada fase é publicável sozinha, só quando o dono liberar.

## Status

- [x] Plano e branch `rust`
- [x] Fase 1 — gateway (pronto no branch, ainda não está no ar)
- [ ] Fase 2 — API rota por rota
  - [x] banco (MySQL sem Prisma), token de acesso e `requireAuth`
  - [x] `GET /api/auth/me`
  - [x] `POST /api/auth/refresh` e `POST /api/auth/logout` (com o "lembrar login")
  - [x] `POST /api/auth/login` (senha, bloqueio, 2FA, aviso de aparelho novo)
  - [x] proteções globais do Node nas rotas do Rust (IP bloqueado, helmet, CORS, corpo)
  - [x] cadastro (410), verificação de e-mail, esqueci/redefinir senha,
        2FA (ativar, códigos de recuperação, desativar), trocar senha
  - [x] aparelhos conectados (listar, encerrar um, sair dos outros),
        desativar/excluir conta, troca rápida de conta
  - [x] entrar pelo QR Code (PC e celular) e entrada do app no WebView (app-handoff)
  - [x] chaves de acesso (passkeys): listar, cadastrar, apagar e entrar
  - [x] exportar meus dados (LGPD)
  - [x] entrar com Google, Discord e GitHub (OAuth)
  - [x] **Fase 2 (login e conta) completa**
  - [x] o que vale pra toda a API fora do login: limitadores de `/api`
        (leituras, escritas, "marcar como lido"), cache compartilhado
        apagado nas escritas e tempo real pela ponte `/api/internal/realtime`
  - [x] `/api/users` (parte): tema, layout, zooms, estilo de emoji, status,
        status personalizado, tag da comunidade, tirar a carteirinha, busca
  - [x] `/api/users`: configurações, jogos, atalhos, GIFs favoritos,
        emojis que posso usar, ignorar, notas e o perfil de outra pessoa
        (`GET /api/users/:id`) com as regras de privacidade
  - [x] `/api/users`: editar perfil, trocar a ClubTag, votar, conquistas
        exibidas, denúncia de perfil, mural, lista de desejos, atividade e
        estatísticas do perfil
  - [ ] falta em `/api/users`: resumo do perfil (depende de fãs, traços,
        enquetes e visitas) e os envios de imagem
  - [ ] próximo: amigos (`/api/friends`) e as partes do perfil (fãs,
        traços, enquetes, visitas, recados, depoimentos)
  - [ ] depois: amigos, mensagens, comunidades, economia, staff…

### Fase 1 — o que já tem

`rust/pc-server` (Axum):

- repassa pro Node tudo que não foi portado — HTTP (corpo inteiro, status e
  cabeçalhos) e WebSocket (Socket.IO, Club Penguin, voz) — sem mexer no
  `X-Forwarded-For` (o Node continua vendo o IP de verdade de cada pessoa);
- Node fora do ar → 502 (igual ao proxy da hospedagem hoje);
- cache no **mesmo Redis e mesmas chaves** do Node (`cache:<chave>`);
- rota portada: `GET /api/system/desktop-latest` (responde com
  `x-served-by: rust`).

Rodar e testar:

```sh
cd rust
cargo test                      # 12 testes (inclui HTTP e WebSocket passando pelo Rust)
PORT=3000 PC_NODE_UPSTREAM=http://127.0.0.1:3001 cargo run   # Node em PORT=3001
```

Variáveis novas: `PC_NODE_UPSTREAM` (onde o Node ficou; padrão
`http://127.0.0.1:3001`), `PC_LOG` (nível do log; padrão `info`),
`PC_DESKTOP_LATEST_URL` (só pra teste). O resto é o mesmo `.env` do Node.

Falta pra Fase 1 ir pro ar (quando o dono liberar): o CI compilar o binário
Linux e pôr no branch `deploy`, e o start do app subir o Node na porta
interna + o Rust na porta pública.

### Fase 2 — o que já tem

- `db.rs`: MySQL com as convenções do Prisma (datas em UTC no formato do
  JavaScript, `updatedAt` à mão, ids UUID v4, números como o JS escreve).
- `auth.rs`: o token de acesso é o **mesmo** do Node (HS256,
  `JWT_ACCESS_SECRET`) — testado nos dois sentidos (token do Node vale no
  Rust e vice-versa). O `requireAuth` faz o mesmo que o do Node, com as
  mesmas mensagens e códigos: sem token, token ruim, conta inexistente,
  banida (com motivo), suspensa, desativada, manutenção (só a staff passa,
  cache de 5 s) e o "usou hoje" (`UserActiveDay`).
- Máscara do "invisível" (`maskDeep` do Node) pronta pra todas as rotas.
- `GET /api/auth/me`: mesmos campos e mesma ordem do Node em produção
  (conferido em 21/11/2026), incluindo clã/ícone e pingente, número público
  gerado na hora, insígnias de idade da conta e status personalizado vencido.

Testes de banco: `PC_TEST_DATABASE_URL=mysql://root@127.0.0.1:3306 cargo test`
(cada teste cria um banco novo com `tests/fixtures/schema.sql`, gerado do
`schema.prisma`). No CI roda com MySQL 8.

### Sessões (refresh e logout)

- `iron.rs`: o selo do `iron-session` (formato `Fe26.2`) — o cookie
  `pcKeep` ("lembrar login") feito pelo Node abre no Rust e o do Rust abre
  no Node (testado nos dois sentidos).
- `session.rs` + `routes/session.rs`: o `refresh` do Node caso a caso —
  rotação (só uma requisição ganha), corrida de duas abas (30 s ou mesmo
  aparelho: só token de acesso, sem sessão nova), aparelho que perdeu o
  cookie novo (recupera, substituto vira `ABANDONED`), reuso de token velho
  (`THEFT`, encerra só aquela sessão), conta bloqueada (`ADMIN`), sessão
  encerrada, "lembrar login" (com "sair de todos os aparelhos" no Redis) e
  a promoção do dono a ADMIN. Cookies com o mesmo formato do Express.
- Redis de produção: certificado público (Let's Encrypt) — o Rust usa a
  lista de raízes embutida, e **não** manda o `CLIENT SETINFO` ao conectar
  (o Redis da Shard Cloud não responde esse comando e a conexão travava).
- MySQL de produção: fica atrás de um intermediário da Shard Cloud sem TLS
  que começa com `mysql_native_password` e troca de método no meio do
  login. O `sqlx` levava "acesso negado"; o servidor agora usa o
  `mysql_async` (o mesmo motor do Prisma), que entra normalmente. O `sqlx`
  ficou só pra montar os bancos de teste.
- `pc-server check [redis|mysql]` testa as duas conexões e
  `pc-server check diag` mostra cada etapa (TCP, TLS, PING, login no MySQL).

### Teste em produção (21/11/2026)

Binário da pré-versão `rust-dev` rodando **ao lado** do Node no servidor
da Shard Cloud (porta 3099, sem receber tráfego de ninguém, desligado no
fim), com as variáveis de verdade:

- Redis (TLS) e MySQL: conectam (`pc-server check`).
- `GET /api/auth/me` de 8 contas reais: resposta **idêntica** à do Node,
  campo por campo.
- `GET /api/system/desktop-latest`: idêntica. Sem login: o mesmo 401.
- Repasse pro Node: `/api/health`, a página do site (mesmos bytes) e o
  WebSocket do Socket.IO funcionando através do Rust.

### Login

- `routes/login.rs`: o `login` do Node caso a caso — limite de 15 tentativas
  em 10 min por IP **no mesmo contador do Redis** (`ratelimit:login:<ip>`,
  mesmo script do `rate-limit-redis`), conta trava 15 min no 10º erro,
  bcrypt sempre (até sem conta; senhas do `bcryptjs` valem), banida/suspensa
  (com token de revisão), desativada, 2FA (`totp.rs`, igual ao `otplib`,
  sem reuso do mesmo código) ou código de recuperação (uso único),
  reativação de conta desativada pela pessoa.
- Aviso de aparelho novo: o Rust pede pro Node pela rota interna
  `POST /api/internal/login-alert` (`server/src/routes/internal.js`), com
  segredo `HMAC(JWT_ACCESS_SECRET, 'pc-internal-v1')`. Sem o segredo: 404.
  O Rust também dá 404 pra `/api/internal` vindo de fora.
- `web.rs`: o que o Node faz em toda requisição, agora também nas rotas do
  Rust — IP bloqueado (rotas-isca) → 503, cabeçalhos do helmet e do CORS
  (os mesmos de produção), corpo JSON até 5 MB, compressão; método que o
  Rust não tem (ex.: OPTIONS) vai pro Node.
- Diferença conhecida: JSON quebrado dá 400 nos dois, mas a mensagem do
  Node vem do V8 (`Expected property name…`) e a do Rust é `JSON inválido (…)`.

Produção (21/11/2026, depois do login): `POST /api/auth/login` (corpo vazio
e conta inexistente) e `GET /api/auth/me` sem login — mesmo código, mesmo
corpo e os mesmos cabeçalhos de segurança/CORS que o Node.

### Conta (cadastro, e-mail, senha, 2FA)

- `routes/account.rs`: cadastro direto desativado (410, igual ao Node),
  verificação de e-mail (só o último código vale), "esqueci a senha"
  (sempre 200, só o hash do link no banco, link novo invalida os antigos),
  redefinir senha (destrava a conta, conta como e-mail verificado, derruba
  todas as sessões e o "lembrar login"), 2FA (segredo + QR Code igual ao
  `otplib`/`qrcode` do Node — o teste lê o QR de volta —, confirmação com
  10 códigos de recuperação, desativar com senha + código) e trocar senha
  (derruba as OUTRAS sessões e mantém esta).
- Limitadores `auth` (50/15 min, cabeçalhos `X-RateLimit-*`) e `code`
  (20/10 min, cabeçalhos `RateLimit-*`), no mesmo contador do Node; ao
  estourar, o mesmo texto do express-rate-limit.
- E-mails pela ponte com o Node (`POST /api/internal/email`).
- Transações (`db::transaction`) onde o Node usa `prisma.$transaction`.

Produção (21/11/2026, depois das rotas de conta): `register` (410),
`forgot-password` com e-mail inexistente (200), `verify-email/send` sem
login (401), `reset-password` com link inválido e sem corpo (400) e
`GET 2fa/recovery-codes` de 8 contas reais — tudo idêntico ao Node.

### Aparelhos, conta e troca rápida

- `GET /api/auth/sessions`, `DELETE /api/auth/sessions/other` e
  `DELETE /api/auth/sessions/{id}` — nome do aparelho e IP mascarado com as
  mesmas regras do Node (`describeDevice`/`maskIp`), encerra a família
  inteira da sessão (inclusive um filho nascendo numa rotação) e grava o
  `SecurityLog` (só o hash do IP).
- `POST /api/auth/deactivate` e `POST /api/auth/delete-account` — senha,
  transação, derruba o "lembrar login" e os sockets abertos pela ponte nova
  `POST /api/internal/kick` (o Socket.IO continua no Node).
- `POST /api/auth/switch/remember`, `/switch` e `/switch/forget` — até 10
  contas salvas por pessoa, 90 dias, a sessão atual do aparelho sai antes de
  entrar na outra.

Produção (21/11/2026): `GET /api/auth/sessions` de 8 contas reais (com
aparelhos de verdade na lista) — idêntico ao Node. As rotas que mudam algo
(encerrar, desativar, excluir, trocar) só nos testes, pra não mexer em
conta de ninguém.

### Entrar pelo QR Code e app-handoff

- `POST /api/auth/qr/start|poll|exchange` (PC, sem login) e
  `/qr/scan|approve|deny` (celular logado, com e-mail confirmado e cookie de
  sessão viva desta conta). Mesma máquina de estados, mesmos erros
  (`{ error, code }`) e os 4 limitadores do Node (`qr-start`, `qr-poll`,
  `qr-exchange` por IP e `qr-phone` por conta, `u:<id>`). O QR sai com
  260 px e margem 1, como o `qrcode` do Node; o teste lê o QR de volta.
- `POST /api/auth/app-handoff` e `GET /api/auth/app-handoff/{code}` — código
  de uso único de 2 minutos guardado na memória (como no Node: as duas rotas
  passam juntas pro Rust), sessão nova pro WebView e redirecionamento só pra
  caminho do próprio site.
- Redis fora do ar não trava mais o pedido: 3 tentativas com prazo de 3 s e
  depois 500, como o ioredis do Node (`maxRetriesPerRequest: 3`).

### Chaves de acesso (passkeys)

- `GET /api/auth/passkeys`, `POST /passkeys/register/options|verify`,
  `DELETE /passkeys/{id}`, `POST /passkeys/login/options|verify`.
- Conferência do WebAuthn escrita em Rust (`src/webauthn.rs`, com `ring` e
  `ciborium`), seguindo o `@simplewebauthn/server` 13.3.3 passo a passo:
  `id === rawId`, tipo, desafio, origem, hash do site, presença do usuário,
  contador (repetição recusada) e assinatura. A chave pública é guardada nos
  mesmos bytes que o Node guarda: chave criada num entra pelo outro.
- O teste usa respostas geradas com chaves de verdade e aprovadas pelo
  próprio `@simplewebauthn` do Node (`tests/fixtures/gerar_webauthn.cjs`):
  ES256, Ed25519 e RS256, atestado `none` e `packed`.
- Diferença conhecida: o atestado `packed` com certificado e o `fido-u2f`
  têm a assinatura conferida, mas não as regras do certificado; `tpm`,
  `android-key`, `android-safetynet` e `apple` são recusados. Como o site
  pede `attestation: 'none'`, os navegadores mandam `none` — a única chave
  de acesso em produção hoje é ES256.

### Exportar meus dados

- `GET /api/auth/export-data` — o mesmo arquivo do Node: linhas inteiras no
  formato do Prisma (`src/prisma_json.rs`, com a ordem dos campos lida do
  próprio `schema.prisma` embutido na compilação), sem os segredos, amigos
  só com id e nome, mensagens com anexos, JSON com 2 espaços e o mesmo nome
  de arquivo.

Produção (21/11/2026): `GET /api/auth/passkeys` e `GET /api/auth/export-data`
de 6 contas reais (as com mais mensagens e a que tem chave de acesso; o
maior arquivo com 176 KB) — byte a byte igual ao Node, tirando o
`exportedAt`. A primeira rodada achou os campos da conta fora de ordem
depois de tirar os segredos; corrigido e conferido de novo.

### Entrar com Google, Discord e GitHub

- `GET /api/auth/oauth/providers`, `/{provider}/start`, `/{provider}/callback`,
  `POST /{provider}/link`, `POST /oauth/2fa`, `GET|DELETE /oauth/signup`,
  `GET /oauth/accounts`, `DELETE /oauth/accounts/{provider}`.
- Cookies assinados no mesmo formato do Node: o teste confere que o cookie
  da inscrição feito pelo Rust é idêntico, byte a byte, ao que o
  `oauth.signPayload` do Node gera (o `applicationsController` do Node lê ele).
- O teste usa um provedor falso (token e perfil) e cobre: PKCE do Google,
  estado trocado ou sem cookie, cancelar no provedor, inscrição
  pré-preenchida, inscrição já pendente, e-mail que já tem conta (não vincula
  sozinho), conta ligada, banida, 2FA depois do provedor, conectar e
  desconectar, e conta do provedor já ligada em outra pessoa.
- Em produção nenhum provedor está configurado hoje (faltam as variáveis
  `GOOGLE_CLIENT_ID`/`_SECRET` etc.), então as telas mostram "indisponível"
  — igual no Rust.

### Cabeçalhos iguais aos do Express

Comparando os cabeçalhos (e não só o corpo), apareceram três diferenças nas
rotas do Rust, já corrigidas em todas:
- `Content-Type: application/json; charset=utf-8` (o axum mandava sem charset);
- `ETag` fraco como o `app.set('etag', 'weak')` e resposta 304 quando o
  navegador manda `If-None-Match` igual;
- `Vary: Origin, Accept-Encoding` na mesma ordem.
O redirecionamento segue o `res.redirect` do Express 5 (corpo por `Accept`).

Produção (22/11/2026): 44 respostas comparadas com status, `Location`,
`Content-Type`, `Cache-Control`, `ETag`, `Vary`, cookies e corpo — rotas
do OAuth (início, callback, inscrição, contas) e `me`, `sessions`,
`passkeys`, `2fa/recovery-codes` de 6 contas: 44 de 44 iguais. Repetidas
as de antes: exportação e chaves de acesso (6 de 6) e aparelhos (8 de 8).

### Fase 3 — começo (`/api/users` e o que vale pra toda a API)

- Os três limitadores de `app.use('/api', ...)` do Node valem nas rotas do
  Rust fora de `/api/auth` (e de `/api/platform/status`), na mesma ordem
  (antes do login) e com as mesmas chaves no Redis: leituras (`reads`,
  GET, 4000/15 min por IP), escritas (`writes`, 400/15 min pela conta
  quando o token é válido, senão pelo IP) e "marcar como lido"
  (`readmarks`, 3000).
- `invalidateOnWrite`: escrita 2xx em `/users`, `/community`, `/admin`…
  apaga as chaves `cache:shared:*` (as mesmas do Node).
- Tempo real: o Socket.IO continua no Node. O Rust manda os emits por
  `POST /api/internal/realtime` (lista processada em ordem + presença), e
  os pedidos saem numa fila única, pra dois avisos seguidos nunca
  chegarem invertidos. Os emits passam pela mesma máscara do "invisível".
- Achado na conferência: o `contains` do Prisma no MySQL não escapa `_`
  nem `%` (a busca por "a_" acha "D3kam"); o Rust faz igual.

Produção (22/11/2026): busca de pessoas com 10 textos diferentes
(inclusive `_`, `%`, `@`, vazio, `self=1`) em 4 contas e as 8 recusas das
preferências (tema, layout, zoom, emoji, status, status personalizado) —
49 de 49 iguais ao Node, cabeçalhos e limitador incluídos. As 44 de antes
continuam iguais.

### `/api/users` — segunda parte

- Configurações (`GET/PATCH /me/settings`, `POST /me/settings/reset`) com
  as mesmas regras de cada campo, preferências extras e de layout,
  volume de cada pessoa na chamada e horário de silêncio. O fuso aceita o
  mesmo que o `Intl` do Node 24 (nome IANA sem diferença de maiúsculas e
  `±HH`, `±HHMM`, `±HH:MM`), conferido no próprio Node de produção.
  Ler as configurações não mexe no `updatedAt` (conferido no Node).
- Jogos, atalhos, GIFs favoritos, emojis que a pessoa pode usar (com os da
  loja dos criadores), ignorar e notas particulares.
- Perfil de outra pessoa: privacidade (todos / amigos / amigos e clã /
  ninguém), amigos em comum, "amigos desde", votos e ups, insígnias,
  conquistas exibidas, nível (lido do `levelsCatalog.js`), atividade (do
  Redis) e modpack em destaque.
- `src/js.rs`: o que o JavaScript faz e muda o resultado — ordem das chaves
  de objeto (índices numéricos primeiro), `1.0` vira `1`,
  `Number.isInteger`.

Produção (22/11/2026): configurações, jogos, atalhos, GIFs e emojis de 8
contas e 4 recusas de escrita — 44 de 44 iguais; perfil de 11 pessoas
(inclusive com perfil privado e com insígnias) visto por 4 contas, mais
lista de ignorados e as recusas de nota/ignorar a si mesmo — 50 de 50
iguais.

### `/api/users` — terceira parte

- `PATCH /me` (editar perfil) com as mesmas regras: só os campos
  permitidos, links ganham `https://`, enquadramento do banner, ordem das
  seções, cores (respeitando "cores_perfil" desligado pela staff), vitrine
  de jogos. Tipo errado num campo dá 500 como no Prisma. Pedido sem nada
  válido não grava (o `updatedAt` fica igual, conferido no Node).
- `PATCH /me/username` (ClubTag: regras, nomes reservados, 7 dias entre
  trocas, data no horário de Brasília), `POST /:id/vote`,
  `PATCH /me/displayed-achievements`, `POST /:id/report` (com o
  limitador `profile-report`).
- Extras do perfil: `GET /:id/extras` (mural, lista de desejos só pra
  amigos, atividade dos últimos 30 dias com "Novo jogador"/"Retornando
  após N meses", estatísticas e nota), `PUT /me/widgets`,
  `GET|POST /me/wishlist`.
- Ponte nova `POST /api/internal/after`: serviços do Node que o Rust ainda
  não tem, disparados depois da ação (recalcular os ups, conferir
  conquistas, avisar os amigos que o perfil mudou). Só aceita essas três.

Produção (22/11/2026): extras de 11 perfis vistos por 4 contas, lista de
desejos e 11 pedidos recusados ou sem efeito (ClubTag curta, reservada e
igual à atual; votar em si; voto inválido; denunciar a si; motivo
inválido; item inválido; conquistas inválidas; perfil sem mudança) —
59 de 59 iguais ao Node.
