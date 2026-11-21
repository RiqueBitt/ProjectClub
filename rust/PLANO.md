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
  - [ ] próximo: login (senha, bloqueio por tentativas, 2FA, aviso de aparelho novo)

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
