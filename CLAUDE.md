# Project Club — guia pra quem (pessoa ou Claude) for mexer no projeto

Responda sempre em **português do Brasil**. Dono: RiqueBitt.

> Este repositório é **público**. Nunca coloque senhas, segredos, tokens ou
> chaves aqui (nem em commit, nem em comentário). Os segredos ficam nas
> variáveis de ambiente da Shard Cloud e no `.env` do servidor de mídia (VPS da Hostinger).

## Onde roda cada coisa

| Parte | Onde | Pasta |
|---|---|---|
| Site + API (Node/Express/Prisma) | Shard Cloud, app **ProjectClub** (`f9ba88be-b4b5-4c12-aa4a-699e94d41570`), https://projectclub.shardweb.app | `server/`, `client/` |
| Servidor em Rust (na frente do Node) | dentro do mesmo app: fica na porta do app, responde as rotas já portadas e repassa o resto pro Node (porta interna 3001). Ver "Rust na frente do Node" abaixo | `rust/`, `scripts/rustGateway.js` |
| Banco | MySQL e Redis da Shard Cloud (`DATABASE_URL`, `REDIS_URL` nas variáveis do app) | `server/prisma/` |
| Servidor de voz/vídeo/tela (mediasoup + TURN) | VPS da **Hostinger** `srv2072093` (179.197.228.137), código em `/opt/projectclub/media-server`. `wss://179-197-228-137.sslip.io` (saúde: `https://179-197-228-137.sslip.io/health`) | `media-server/` |
| VPS `projectclub-voz` (`7830da54-…`, 38.92.41.54) | IA Pingu (Ollama) e vigia de deploy — **pode estar desligada** | `scripts/deploy-watch.sh` |
| App do PC | Electron | `desktop/` |
| App Android | Kotlin/Compose nativo | `android-nativo/` |

## Publicar uma mudança

1. Commit e push em `main` (commits como `RiqueBitt <riquebittgonz@gmail.com>`).
2. O CI (`.github/workflows/test.yml` e `deploy.yml`) testa, compila o `client/dist`
   e publica tudo pronto no branch `deploy`.
3. O `deploy.yml` chama `POST /api/system/deploy` e o app se atualiza sozinho.
   Se não atualizar, rode dentro do container (console da Shard Cloud):
   `cd /app && curl -fsSL https://raw.githubusercontent.com/RiqueBitt/ProjectClub/<sha-do-deploy>/scripts/self-update.sh | sh -s <sha-do-deploy>`
   e reinicie o app.
4. Confira: `curl https://projectclub.shardweb.app/api/system/deployed` mostra o SHA no ar.

O Club Penguin (Praça e Mini-Jogos) foi **removido** em nov/2026 — só as emojis `:cp_*:`
ficaram (`client/public/emoji-sets/clubpenguin`, `server/src/services/cpEmotes.js`).
As tabelas dele no banco (`Plaza*`, `WaddlePenguin`…) ficaram (o `db push` roda sem
`--accept-data-loss`); a mídia antiga no disco é apagada no boot (`server/src/services/cpCleanup.js`).

## Rust na frente do Node

A reescrita em Rust vai entrando aos poucos (plano e o que já foi portado: `rust/PLANO.md`).
O CI compila o binário (`rust/bin/pc-server`, só no branch `deploy`) e o `scripts/deploy.js` sobe
o Node numa porta interna e o Rust na porta do app. Rota portada → o Rust responde (a resposta
sai com `x-served-by: rust`); o resto → Node.

- Está no ar? `curl https://projectclub.shardweb.app/api/system/rust` (no Node puro dá 404).
- **Mudou uma rota que já está em Rust? Tem que mudar nos dois** (Node em `server/src`, Rust em
  `rust/pc-server/src/routes`) — senão o site continua com o comportamento antigo. As rotas
  portadas estão em `rust/pc-server/src/lib.rs`.
- Desligar uma parte sem publicar nada: variável `PC_RUST_SKIP` com os começos de caminho que
  devem ir direto pro Node (ex.: `/api/economy,/api/friends`) e reiniciar o app.
- Desligar tudo: variável `PC_RUST=0` (ou um arquivo vazio `/app/.pc-rust-off`) e reiniciar o app.
- Proteções automáticas: leitura (GET) que der erro interno no Rust é respondida pelo Node; se o
  Rust cair 3 vezes em 2 minutos, o app volta sozinho pro Node puro até a próxima publicação.
- Testes do Rust: `cd rust && ./verificar.sh` (precisa de MySQL e Redis locais; o CI roda igual).

## Testes

- Servidor: `cd server && node --test test/<arquivo>.test.js` (precisa de `npm ci` na raiz).
- Android: o CI "Android nativo" compila o APK.

## Voz (servidor de mídia)

As chaves ficam no **Painel da staff → Servidor de voz** (criptografadas no
Redis e com cópia no banco). Valores:

- URL: `wss://179-197-228-137.sslip.io/ws` (com o `/ws` no fim — sem ele a call não conecta)
- Segredo: o `MEDIA_SERVER_SECRET` de `/opt/projectclub/media-server/.env` na VPS da Hostinger
  (hPanel → VPS → **Console web**: `grep SECRET /opt/projectclub/media-server/.env`)
- TURN: `turn:179-197-228-137.sslip.io:3478?transport=udp,turn:179-197-228-137.sslip.io:3478?transport=tcp,turns:turn-179-197-228-137.sslip.io:443?transport=tcp`
- Segredo do TURN: o `TURN_SECRET` do mesmo `.env`

Mudou algo em `media-server/`? Na VPS da Hostinger (Console web):
`cd /opt/projectclub && git pull && cd media-server && docker compose up -d --build`.

## Regras do dono

- Nada de imagem gerada por IA: só arquivos originais do Club Penguin (CP Archives) ou arte do próprio dono.
- Coisas grandes ou arriscadas: em branch separado até o dono liberar.
