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
- [ ] Fase 2 — API rota por rota (próximo: auth/tokens)

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
