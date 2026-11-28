# Deploy otimizado (memória/CPU/rede)

## O problema que isso resolve
Em uso normal o Project Club gasta **~150–420 MB** de RAM. Os picos de **~1 GB de RAM e 96% de CPU** que apareciam
nos gráficos da Square Cloud eram o **`npm install` + `vite build` rodando dentro do container de produção** a cada
deploy — não o app. Isso derrubava a qualidade pra quem estava online e já estourou o heap antes.

## Como funciona agora
1. **`main`** continua sendo o branch de desenvolvimento (PRs, CI de testes/e2e).
2. A cada push na `main`, o workflow **`.github/workflows/deploy.yml`** compila o cliente no GitHub (com RAM de sobra),
   gera os assets **pré-comprimidos** (`.br` brotli + `.gz`) e publica **tudo + `client/dist`** no branch **`deploy`**
   (um commit órfão, leve).
3. A **Square Cloud fica vinculada ao branch `deploy`**. O `npm run deploy:start` chama `scripts/deploy.js`, que:
   - vê que o `client/dist` já veio pronto → **pula o build** e roda `npm ci --omit=dev` (só produção);
   - roda o `prisma:push`;
   - sobe o servidor com **`--max-old-space-size` ≈ 70% do container** (1092 MB em 1560 MB) e `--max-semi-space-size=32`,
     pra o V8 coletar lixo com folga em vez de deixar o heap crescer até o container matar o processo.
   - **Reserva:** se a hospedagem apontar pra `main` (sem dist), ele compila no container como antes — só que com teto de
     heap explícito (nunca mais "heap out of memory").

`node scripts/deploy.js --dry-run` mostra o plano sem executar.

## Rede
- **Assets pré-comprimidos**: `client/scripts/precompress.cjs` roda após o `vite build`. O servidor
  (`server/src/middleware/precompressed.js`) entrega o `.br`/`.gz` direto do disco — **zero CPU de compressão por request**,
  e brotli é ~15–20% menor que o gzip feito na hora. Resultado medido: **22,5 MB → 6,1 MB (73% menor)**;
  o `index.js` principal cai de 632 KB para 189 KB.
- Cache imutável (1 ano) nos assets com hash continua igual; `index.html` continua `no-cache`.

## Memória/CPU no servidor
- Logs de acesso (`morgan`) em produção **não registram mais** arquivos estáticos, polling do Socket.IO nem respostas 304
  (eram a maioria absoluta das linhas e cada uma é I/O síncrono). Requests da API seguem logadas.
- Cache do proxy de imagens: 80 MB → 48 MB (o navegador já guarda cada imagem por 1 ano).
- `automod.messageWindows` agora é podado (antes crescia pra sempre com cada par canal+usuário).
- `squarecloud.app`: `MEMORY=1560` (antes dizia 1024, divergindo do plano real).

## Se precisar voltar atrás
Vincular a Square Cloud de volta ao `main`: o `deploy.js` detecta a ausência do dist e compila no container (com teto de heap).
