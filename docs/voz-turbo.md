# Voz turbo — auditoria e melhorias da voz e da transmissão de tela

Revisão de desempenho de ponta a ponta do caminho de voz/tela do Project Club
(site, app de PC em Electron, app Android nativo, servidor de mídia mediasoup
no VPS Hostinger de 2 vCPU / 8 GB). Branch `voz-turbo`.

Regra seguida: nada que já existe foi removido; cada mudança é compatível com
clientes antigos (Android 1.33.x, builds antigos do app de PC) e com o servidor
de mídia antigo, tem chave pra desligar e tem teste.

---

## 1. O que a auditoria encontrou

Muita coisa já estava no lugar certo (ver a seção 4). Os problemas reais:

| # | Onde | Problema | Efeito pra quem usa |
|---|------|----------|---------------------|
| 1 | `micPipeline.js` / `mediasoupEngine.js` | O portão do microfone com **sensibilidade de entrada** era decidido num `setInterval` de 40 ms na thread principal, olhando um `Analyser` com janela de ~21 ms. Com a aba em segundo plano, o Chrome limita timers a ~1x/s; travadas da interface (React, GC) também atrasam. | A **primeira sílaba era comida** (40–60 ms com a aba na frente; até ~1 s com a aba escondida ou a interface ocupada). |
| 2 | recepção de áudio | O áudio recebido usava o buffer automático do navegador (NetEq). O NetEq cresce por *jitter*, não por *perda*. O servidor já retransmitia voz perdida (NACK/RTX do Opus), mas a retransmissão chega ~1 RTT depois — tarde demais pra um buffer de 20–40 ms. | Em wi-fi/4G com perda, **"picote"/voz robótica** mesmo com a retransmissão funcionando. |
| 3 | câmera/tela com simulcast | Todas as camadas (ex.: 1080p/60 + 540p/15) eram codificadas e enviadas **sempre**, mesmo com todo mundo vendo a tela em miniatura ou ninguém olhando. | CPU alta e upload cheio no PC de quem transmite → **tela travando**, ventoinha, a própria voz da pessoa sofrendo junto. |
| 4 | `_collectStats` | A cada 2 s, um `getStats()` **por consumer** (20 pessoas = 20 relatórios completos do WebRTC). | CPU/bateria à toa em PC fraco e celular. |
| 5 | `activeSpeakers` | Cada evento do servidor chamava `onRemoteSpeaking` pra **todo mundo** da sala (mudou ou não). | Trabalho de React à toa a cada 200 ms em salas cheias. |
| 6 | reconexão (site e Android) | Esperas fixas (1 s, 2 s, 4 s…) sem *jitter*. Quando o servidor reinicia uma sala (1012), todo mundo cai junto. | Rajada de reconexões no mesmo milissegundo no VPS de 2 vCPU. |
| 7 | `rooms.pickWorker` | Worker escolhido por "salas + pessoas". O custo de um SFU é o que ele encaminha (consumers ≈ pessoas²). | Duas salas grandes podiam cair no mesmo núcleo com o outro à toa. |
| 8 | anel de fala | O servidor só avisa quando o conjunto de quem fala MUDA; depois de uma queda, quem estava aceso podia ficar aceso. | Anel verde "preso". |
| 9 | protocolo | Sem versão nem lista de recursos no `welcome`. | Não dava pra ligar recurso novo só com servidor novo. |
| 10 | host | Sem `somaxconn`/`tcp_max_syn_backlog` altos e `vm.swappiness` padrão (60). | SYN descartado na rajada de reconexões; risco de página do worker ir pro swap. |

---

## 2. O que mudou e por quê

### 2.1 Servidor de mídia (`media-server/`)

- **Worker pela carga real** (`rooms.roomLoad`): cada sala pesa
  `1 + Σ (1 + producers + consumers)` das pessoas. Sala nova vai pro worker
  com menos carga real. (Com 2 vCPU são 2 workers — um por núcleo, como já era.)
- **Dynacast** (`Room.layerNeedChanged`, `neededSpatialLayer`): pra cada
  producer de vídeo com simulcast, o servidor calcula a **maior camada que
  alguém está assistindo de fato** — consumer pausado (vídeo fora da tela,
  aba escondida) não conta; consumer sem camada preferida (cliente antigo,
  Android) conta como a camada mais alta — e manda pro **dono** do producer o
  evento `producerLayers { producerId, maxSpatialLayer }` (`-1` = ninguém
  assistindo). Subir é **na hora**; descer espera `MEDIA_DYNACAST_DOWN_MS`
  (3 s), pra não ficar liga-desliga quando alguém mexe no tamanho do vídeo.
  Producer sem simulcast (tela do Android) nunca recebe aviso.
- **Protocolo 2**: o `welcome` ganhou `protocol: 2` e `features: [...]`
  (`producerLayers` só aparece com o dynacast ligado). Só acréscimos.
- Novas variáveis: `MEDIA_DYNACAST` (padrão ligado; `0` desliga) e
  `MEDIA_DYNACAST_DOWN_MS` (padrão 3000). Documentadas no `.env.example`.
- **`scripts/tune-host.sh`** (novo, idempotente, `--dry-run`): escreve só
  `/etc/sysctl.d/91-projectclub-voz-turbo.conf` (`somaxconn` e
  `tcp_max_syn_backlog` 4096, `vm.swappiness` 10; os buffers UDP de 25 MB só
  se o `90-projectclub-voz.conf` do `vm-voz-robusta.sh` não existir) e confere
  o resto. **Não mexe** no `docker-compose.yml`, no `.env` nem no
  `vm-voz-robusta.sh`.
- `docker-compose.yml` e `vm-voz-robusta.sh` **não foram alterados** (o VPS tem
  mudanças locais neles — nada pra mesclar).

### 2.2 Site e app de PC (`client/src/voice/`)

- **Portão rápido do microfone** (`client/public/voice/voice-gate-worklet.js` +
  `micPipeline.js`): com a sensibilidade de entrada ligada, quem **abre** o
  portão é um AudioWorklet na thread de áudio. Ele mede o nível a cada bloco
  de 128 amostras (2,7 ms) na **mesma janela de ~21 ms** do Analyser antigo —
  mesmo limite em dB, mesma reação a teclado/ruído — e abre no mesmo bloco
  em que a voz passa do limite (rampa de 5 ms, sem estalo). Fechar continua
  como antes: segura de 300 ms **e** a thread principal concordando (lá ficam
  o piso de ruído automático e o VAD do RNNoise). Apertar-pra-falar, portão
  manual e "sem sensibilidade" continuam no GainNode de sempre (o worklet fica
  em *bypass*). Worklet não carregou → exatamente o comportamento antigo.
  Grafo: `mic → [RNNoise] → ganho → [portão rápido] → portão → envio`.
- **Buffer de recepção adaptativo** (`netAdapt.jitterTargetDecision` +
  `_adaptJitterBuffer`): por consumer de áudio, a cada leitura de estatísticas
  (2 s) mede a fração de áudio "inventado" (`concealedSamples −
  silentConcealedSamples` ÷ `totalSamplesReceived`). Com ≥ 3% → sobe
  `RTCRtpReceiver.jitterBufferTarget` pra **RTT + 40 ms** (entre 60 e 200 ms),
  o tempo da retransmissão chegar; com a rede limpa (< 0,5%) por 6 janelas
  (~12 s) → volta pro automático (latência mínima). Silêncio/DTX não decide
  nada. Navegador sem `jitterBufferTarget`: nada muda.
- **Dynacast no publicador** (`_onProducerLayers`): o evento `producerLayers`
  vira `Producer.setMaxSpatialLayer(n)` (API do mediasoup-client, que liga/
  desliga as `encodings` do simulcast). `-1` mantém a camada baixa no ar
  (barata; quem abrir o vídeo vê a imagem na hora enquanto a cheia religa).
  Falhou por corrida com outro `setParameters` → tenta de novo uma vez.
- **Um `getStats()` só** do transport de recepção pra todos os consumers
  (`netAdapt.matchInboundStats`, casando por `mid`/`trackIdentifier`);
  consumer que não casar cai no `getStats()` dele, como antes.
- **Fala remota**: `onRemoteSpeaking` só pra quem mudou
  (`netAdapt.speakingChanges`); na queda da sessão, os anéis acesos apagam.
- **Reconexão com jitter** de ±30% (`netAdapt.jitteredDelay`). Reconexão
  "imediata" (rede mudou, internet voltou) continua imediata.
- `welcome.protocol`/`features` guardados em `engine.serverProtocol`/
  `engine.serverFeatures` (servidor antigo = protocolo 1, sem features).
- `getMicGateState()` ganhou `fastGate` (worklet decidindo agora) e
  `fastGateLoaded`.
- **Chave de emergência por aparelho** (sem deploy):
  `localStorage.setItem('pc:voz:desligar', 'portao-rapido,buffer-adaptativo,dynacast')`
  (qualquer subconjunto; vale na próxima entrada na call).

### 2.3 Android nativo (`android-nativo/.../voice/MediasoupEngine.kt`)

- Só parâmetro: reconexão com jitter de ±30% (`jitteredDelay` no companion),
  igual ao site. Nada no ciclo de vida dos objetos nativos
  (`detachLibraryTrack` e companhia intactos).
- Conferido e **mantido**: Opus do mic (mono, FEC, DTX, NACK, 64 kbps — igual ao
  site), prioridade alta da voz, AEC/NS de hardware (o WebRTC desliga o
  supressor de software quando o de hardware liga — sem supressão dupla).
- O app Android **ignora** o evento `producerLayers` (o `when` não tem `else`)
  e a tela dele é de 1 camada — o servidor nem manda aviso pra ele.

---

## 3. Impacto esperado

- **Começo da fala**: com sensibilidade de entrada, o portão abre em ~3–8 ms
  (antes 40–60 ms; até ~1 s com a aba escondida). Fim da "primeira palavra
  sumindo".
- **Tela/câmera**: com todo mundo vendo a tela em miniatura (ou ninguém
  olhando), quem transmite deixa de codificar a camada cheia — numa tela
  1080p/60 isso é a maior parte do trabalho do codificador e ~80% do upload
  (8 Mbps → ~2 Mbps). Também cai a entrada no VPS. Quando alguém amplia, a
  camada cheia volta em poucas centenas de ms (o vídeo segue na baixa nesse
  meio-tempo, sem tela preta).
- **Rede com perda**: a retransmissão de voz (que já existia) passa a chegar
  a tempo — menos picote em wi-fi/4G ruins, ao custo de +60–200 ms de atraso
  **só enquanto houver perda**. Rede boa: latência igual à de antes.
- **CPU no cliente**: 1 `getStats()` a cada 2 s em vez de N; callbacks de fala
  só nas mudanças.
- **Servidor**: salas distribuídas pelos 2 núcleos pela carga real;
  reconexões espalhadas no tempo depois de um reinício.

---

## 4. Conferido e mantido (com o motivo)

- **Opus**: mic mono, `useinbandfec`, `usedtx`, NACK (`opusNack` + consumer
  com `enableRtx`), 64 kbps (o mesmo padrão do Discord), ptime 20 (padrão).
  Som da tela: estéreo, 128 kbps, sem DTX. Nada a mudar.
- **RED (audio/red)**: **não dá**. O mediasoup 3.29 não suporta `audio/red`
  (não está em `getSupportedRtpCapabilities()`), e como o SFU não transcodifica,
  um Chrome mandando RED não seria ouvido por Firefox/Safari/Android. A
  proteção contra perda fica com FEC + NACK + o buffer adaptativo.
- **VP9 SVC / AV1 / H264 na tela**: o SFU não transcodifica, então o codec
  precisa ser decodificável por **todo** espectador (Safari/iOS antigos,
  Android com decodificador de hardware). VP8 com simulcast continua o padrão;
  VP9 e H264 seguem no roteador pra quem pedir. O dynacast pega a maior parte
  do ganho de CPU sem esse risco.
- **contentHint/degradationPreference**: já aplicados por fps (≤15 fps =
  `detail`/nitidez; 30+ = `motion`/fluidez). Quadro-chave: no máximo 1 pedido/s
  por producer (`keyFrameRequestDelay`) e pedido na hora quando um consumer
  retoma.
- **ICE/TURN**: o mediasoup é ICE-lite com WebRtcServer (UDP + TCP numa porta
  por worker); o backend ordena as URLs TURN UDP → TCP → TLS e há TURN na 443
  (caddy-l4). `iceTransportPolicy: 'relay'` como reserva não é necessário: com
  `all`, os candidatos relay já entram na disputa. ICE restart antes de refazer
  a sessão já existia (2,5 s de folga, até 2 restarts, 8 s cada). O STUN
  público de reserva é inútil com servidor ICE-lite, mas inofensivo.
- **Bitrate**: `initialAvailableOutgoingBitrate` 1,5 Mbps e
  `MEDIA_MAX_INCOMING_BITRATE` 12 Mbps estão bons. Só a tela **1440p/60**
  (10 Mbps + camada baixa 2,5 Mbps + mic) passa de 12 Mbps — se esse preset for
  usado com frequência, suba pra `16000000` no `.env`.
- **Supressão de ruído**: com o RNNoise ligado o supressor do navegador fica
  desligado (sem supressão dupla); AudioContext a 48 kHz `interactive`; RNNoise
  em quadros de 480 (10 ms) sem alocação no worklet.
- **Reprodução**: cada faixa num `<audio>` próprio (o único caminho em que o
  cancelamento de eco do Chromium funciona). Diminuir `jitterBufferTarget` não
  reduz latência (é um **mínimo**), por isso o ajuste só sobe com perda.
- **`ignoreDtx`** no consumer: não ajuda (o receptor trataria o silêncio como
  perda). **pipeToRouter**: desnecessário com 2 vCPU (uma sala cabe num
  núcleo). **io_uring** (liburing do mediasoup): o seccomp padrão do Docker
  pode bloquear e o mediasoup cai sozinho no libuv; liberar exigiria afrouxar o
  seccomp do container — não vale o risco.
- **Electron**: `backgroundThrottling` já é desligado durante a chamada.
- **Worker morto**: já recria e os clientes reconectam (1012).

---

## 5. Compatibilidade

| Combinação | Resultado |
|---|---|
| Cliente **novo** × servidor **antigo** | Igual a hoje: sem `producerLayers` (todas as camadas ligadas), `protocol` = 1. O portão rápido e o buffer adaptativo são só do cliente. Testado (`e2e-compat-servidor-antigo.mjs`). |
| Cliente **antigo** (Android 1.33.x, builds antigos) × servidor **novo** | Campos novos do `welcome` e o evento `producerLayers` são ignorados. Consumers deles contam como "camada mais alta" no dynacast (nunca ficam sem a camada cheia). |
| Navegador sem AudioWorklet / worklet não carregou | Portão antigo (GainNode), como hoje. |
| Navegador sem `jitterBufferTarget` | Buffer automático, como hoje. |

---

## 6. Testes

- `media-server`: `npm test` → **39/39** (novo `test/turbo.test.js`: carga do
  worker, `neededSpatialLayer`, `welcome` com protocolo 2, dynacast de ponta a
  ponta com servidor de verdade — sobe na hora, desce depois da folga, pausa,
  saída do espectador, producer de 1 camada — e o `tune-host.sh --dry-run`).
- `media-server/test/e2e-webrtc.mjs` (WebRTC de verdade, 2+ Chromium) → **tudo
  passou**, com os passos novos: worklet carregado, sensibilidade abrindo e
  fechando na thread de áudio, dynacast desligando/religando a camada cheia da
  tela. `e2e-compat-servidor-antigo.mjs` → **tudo passou** (inclusive sem o
  worklet servido: cai no portão antigo).
  Rodar numa máquina sem o navegador do Playwright:
  `PW_CHROMIUM=/caminho/do/chrome node media-server/test/e2e-webrtc.mjs`.
- `client`: `npm run test:unit` → **116/116** (novos
  `voice-net-adapt.test.js` e `voice-gate-worklet.test.js`, que roda o arquivo
  do worklet num `vm`); `npx vite build` ok (o worklet sai em `dist/voice/`).
  Playwright das telas de voz (`voice-prefs`, `voice-settings`,
  `voice-server`, `screenshare-tracks`, PC e celular) → 18/18.
- `server`: `npm test` → 463/464 (a falha é a conhecida `perf2.test.js`
  markRead, sem o Prisma client local).
- `desktop`: `npm test` → 35/35.
- Android: não compila aqui; a mudança é uma função pura no companion — o CI
  compila.

---

## 7. Deploy no VPS (passo a passo)

O VPS roda o repositório em `/opt/projectclub`, com `docker compose` dentro de
`media-server/` e `COMPOSE_FILE=docker-compose.yml:docker-compose.turn443.yml`
no `.env`. Esta revisão **não toca** em `media-server/docker-compose.yml` nem em
`media-server/scripts/vm-voz-robusta.sh` (os dois arquivos com mudanças locais
no VPS) — então atualizar o código não conflita com elas.

A ordem entre site e servidor de mídia não importa (as duas combinações são
compatíveis). Reiniciar o `media` derruba as chamadas por ~2–5 s (os clientes
reconectam sozinhos, código 1012) — prefira um horário calmo.

```bash
# 0) entrar na pasta e conferir que só as mudanças locais conhecidas existem
cd /opt/projectclub
git status --short          # esperado: M media-server/docker-compose.yml e M media-server/scripts/vm-voz-robusta.sh
git fetch origin

# 1a) depois do merge na main (recomendado):
git pull --ff-only origin main
# 1b) OU testar o branch antes do merge (só a pasta do servidor de mídia):
#     git checkout origin/voz-turbo -- media-server/src media-server/scripts/tune-host.sh media-server/test media-server/.env.example
#     (volta com: git checkout HEAD -- media-server/src media-server/test media-server/.env.example && rm media-server/scripts/tune-host.sh)

# 2) ajuste do host (idempotente; primeiro só olha)
cd media-server
sudo bash scripts/tune-host.sh --dry-run
sudo bash scripts/tune-host.sh

# 3) (opcional) testes do servidor no próprio VPS, num container descartável
#    (a imagem de produção não leva test/; node_modules num volume à parte)
docker run --rm -v "$PWD":/app -v pc-ms-test-nm:/app/node_modules -w /app node:22-bookworm-slim \
  sh -c "npm ci --no-audit --no-fund && node --test test/*.test.js"

# 4) recompilar e subir SÓ o servidor de mídia (o COMPOSE_FILE do .env já inclui o turn443)
docker compose build media
docker compose up -d media

# 5) conferir
docker compose ps
curl -fsS https://179-197-228-137.sslip.io/health; echo
docker compose logs --tail=50 media      # "2 worker(s) mediasoup prontos · WebRtcServer UDP/TCP em 40000, 40001"
```

Site/app de PC: deploy normal do site (o `client` compilado leva
`dist/voice/voice-gate-worklet.js` junto). O app de PC carrega o site, então
pega a mudança sem nova versão do instalador.

**Voltar atrás** (do mais leve ao mais forte):

1. Só o dynacast: `MEDIA_DYNACAST=0` no `.env` e `docker compose up -d media`.
2. Num aparelho só: `localStorage.setItem('pc:voz:desligar', 'portao-rapido,buffer-adaptativo,dynacast')`
   no console do site/app e entrar de novo na call.
3. Código: `git revert` dos commits do branch (ou `git checkout <commit-anterior> -- media-server/src`)
   e `docker compose build media && docker compose up -d media`. O arquivo
   `/etc/sysctl.d/91-projectclub-voz-turbo.conf` pode ficar (ou
   `sudo rm` + `sudo sysctl --system`).

**Diagnóstico** depois do deploy: `curl -H "x-media-secret: $MEDIA_SERVER_SECRET"
"http://127.0.0.1:4443/stats?deep=1"` mostra por consumer `paused`, `score` e
bytes; no console do navegador/app, a telemetria
`[voz] telemetria do engine: { type: 'jitter-buffer' … }` aparece quando o
buffer adaptativo age (e `dynacast-failed` se o publicador não conseguir trocar
de camada). `getMicGateState()` do engine (usado no harness de e2e) mostra
`fastGate`/`fastGateLoaded`.
