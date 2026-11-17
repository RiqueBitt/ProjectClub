# Project Club — guia pra quem (pessoa ou Claude) for mexer no projeto

Responda sempre em **português do Brasil**. Dono: RiqueBitt.

> Este repositório é **público**. Nunca coloque senhas, segredos, tokens ou
> chaves aqui (nem em commit, nem em comentário). Os segredos ficam nas
> variáveis de ambiente da Shard Cloud e no `.env` do servidor de mídia (VPS da Hostinger).

## Onde roda cada coisa

| Parte | Onde | Pasta |
|---|---|---|
| Site + API (Node/Express/Prisma) | Shard Cloud, app **ProjectClub** (`f9ba88be-b4b5-4c12-aa4a-699e94d41570`), https://projectclub.shardweb.app | `server/`, `client/` |
| Banco | MySQL e Redis da Shard Cloud (`DATABASE_URL`, `REDIS_URL` nas variáveis do app) | `server/prisma/` |
| Club Penguin (Praça) | dentro do mesmo app (Waddle Forever, TS → `dist` commitado) | `server/waddle/` |
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

Mudanças no Club Penguin (`server/waddle/src`): rode `npm run waddle:build`
na pasta `server/` e commite o `server/waddle/dist` junto.

## Testes

- Servidor: `cd server && node --test test/<arquivo>.test.js` (precisa de `npm ci` na raiz).
- Android: o CI "Android nativo" compila o APK.

## Voz (servidor de mídia)

As chaves ficam no **Painel da staff → Servidor de voz** (criptografadas no
Redis e com cópia no banco). Valores:

- URL: `wss://179-197-228-137.sslip.io`
- Segredo: o `MEDIA_SERVER_SECRET` de `/opt/projectclub/media-server/.env` na VPS da Hostinger
  (hPanel → VPS → **Console web**: `grep SECRET /opt/projectclub/media-server/.env`)
- TURN: `turn:179-197-228-137.sslip.io:3478?transport=udp,turn:179-197-228-137.sslip.io:3478?transport=tcp,turns:turn-179-197-228-137.sslip.io:443?transport=tcp`
- Segredo do TURN: o `TURN_SECRET` do mesmo `.env`

Mudou algo em `media-server/`? Na VPS da Hostinger (Console web):
`cd /opt/projectclub && git pull && cd media-server && docker compose up -d --build`.

## Regras do dono

- Nada de imagem gerada por IA: só arquivos originais do Club Penguin (CP Archives) ou arte do próprio dono.
- Coisas grandes ou arriscadas: em branch separado até o dono liberar.
