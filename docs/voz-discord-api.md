# Voz "igual ao Discord" — API do motor e como o app usa

Referência das peças novas da voz própria (servidor de mídia mediasoup). O
`VoiceContext.jsx` já está ligado em tudo abaixo; esta página serve pra
manter (e pra quem for mexer no Android/PC).

## 1. Engine web (`client/src/voice/mediasoupEngine.js`)

### Métodos novos

| Método | O que faz | Quem chama no VoiceContext |
|---|---|---|
| `join({ ..., startMuted, startDeafened })` | Entra já mudo (mic publicado **pausado**) e/ou ensurdecido (o servidor nem manda o áudio dos outros). | `connectEngine`: `startMuted = muted \|\| deafened`, `startDeafened = deafened` (persistem entre canais). |
| `setPushToTalk(on, { releaseDelayMs = 200 })` | Liga o apertar-pra-falar: portão fechado até `setPttPressed(true)`. | `applyEngineMicConfig` (preferências `pushToTalkEnabled` e `pushToTalkReleaseMs` — "Atraso ao soltar a tecla", 0–1000 ms). |
| `setPttPressed(bool)` | Tecla apertada/solta. Solta → continua aberto `releaseDelayMs`. | Efeito da tecla do PTT (keydown/keyup/blur). |
| `setInputSensitivity({ auto, db } \| null)` | Detecção de voz: fecha o portão 250 ms abaixo do limite. `auto:true` = piso de ruído adaptativo (+ VAD do RNNoise, ver abaixo); `{auto:false, db}` = limite manual (só nível); `null` = sempre aberto. | `applyEngineMicConfig` (`sensitivityAuto`/`sensitivityDb` das Configurações). |
| `setMicGate(open)` | Portão MANUAL (soma com PTT/sensibilidade). | Não usado pelo app hoje (fica pra telas como "teste de mic"). |
| `setInputGain(0..4)` | Ganho de entrada no pipeline. | `applyEngineMicConfig`: preferência `inputVolume` (0–200 %, Configurações → Voz e vídeo → Volume de entrada) ÷ 100. |
| `getMicGateState()` | `{ open, mode:'open'\|'ptt'\|'vad', thresholdDb, floorDb, vadP, vadAssisted, pipelineMode:'graph'\|'direct', gateValue }` (diagnóstico/testes). | — |
| `isMicMeterActive()` / `getMicLastSoundAt()` | Medidor do mic rodando / último instante com som. | Aviso "microfone sem som". |
| `getLocalMicTrack({ raw })` | Padrão: faixa **processada** (a que vai pra call — use pra gravar). `raw:true`: captura crua. | `getLocalMicTrack` do contexto (gravação). |
| `setDeafened(bool)` | Pausa/retoma o áudio recebido **no servidor** (economia de banda). | `toggleDeafen` / `toggleMute` (desmutar ensurdecido desensurdece). |
| `setNoiseSuppression(on)` | Liga/desliga RNNoise ao vivo; o supressor do navegador faz o inverso (`applyConstraints`). | `setNoiseReduction`. |
| `setCamera(on, { detailed })` / `setScreen(on, { quality, frameRate, width, height, maxBitrate, audio, track, audioTrack, detailed })` | Legado: devolve `MediaStream \| null`. Com `detailed:true`: `{ ok, stream, reason, cancelled, code }`. Erro também sai em `onMediaError`. `quality`: `720p`/`1080p`/`1440p`; `frameRate`: 5/15/30/60 (tabela abaixo). `audioTrack`: faixa de áudio pronta (testes/app nativo). | `toggleCamera` / `toggleScreenShare` (legado + toast pelo callback). |
| `setScreenQuality('720p' \| { quality, frameRate, width, height, maxBitrate })` | Muda AO VIVO: captura (`applyConstraints`), `contentHint` e bitrate/fps de cada camada do simulcast + `degradationPreference` (`RTCRtpSender.setParameters`; sem acesso ao sender, `setRtpEncodingParameters`). | `setScreenShareQuality` (menu de qualidade da barra/da chamada; a escolha fica em `localStorage.screenShareOptions`). |
| `getScreenQuality()` | Preset atual `{ quality, frameRate, maxBitrate? }`. | — |
| `setVideoViewport(uid, 'screen'\|'camera', { visible, height } \| { remove: true }, viewId?)` | Recepção sob medida: vídeo escondido/fora da tela (ou `document.hidden`) fica **pausado no servidor**; visível → camada do simulcast pela altura × `devicePixelRatio` (≥ 540 px → alta; câmera ≥ 270 → média). Vários blocos do mesmo vídeo (`viewId`): vale o maior visível. Sem nenhum bloco informado: como antes (camada alta, sem pausar). | `reportVideoViewport` ← `voice/useVideoViewport.js` (IntersectionObserver + ResizeObserver) nos blocos de vídeo (`VideoTile` da chamada e `MiniVideo` da janelinha). |

### Callbacks novos

| Callback | Quando |
|---|---|
| `onLocalLevel(level0a1, { db, gateOpen, transmitting })` | ~10/s enquanto o medidor roda. O contexto repassa por `subscribeMicLevel(fn)` (medidor ao vivo em Configurações → Voz e vídeo → Volume de entrada). |
| `onRemoteScreenAudio(uid, MediaStream \| null)` | Som da TELA da pessoa, separado da voz (`onRemoteAudio` passa a trazer só o microfone). Sem esse callback, o motor junta tudo no `onRemoteAudio` (comportamento antigo). |
| `onConnectionStats({ rtt, sendLoss, connected })` | A cada 2 s: ping e perda no envio (o que o servidor relata sobre o que você manda). |
| `onLocalSpeaking(bool)` | Agora vem do Analyser local (instantâneo, 300 ms de segura); sem Web Audio, vale o `activeSpeakers` do servidor. Já desconta mudo/portão fechado. |
| `onServerState({ canSpeak, canVideo, role, serverMuted, serverDeafened })` | Permissões/moderação impostas pelo servidor de mídia. |
| `onMediaError({ kind:'camera'\|'screen', reason, cancelled, code })` | Erro amigável em pt-BR; `cancelled` = fechou o seletor de tela (sem aviso). |
| `onTelemetry({ type })` | `consumer-recreate`, `consumer-resume-failed`, `mic-bypass`, `mic-restored`, `default-mic-changed`. |
| `onLeft({ reason, network?, code?, detail?, providerFailure? })` | `reason`: `replaced` · `kicked` (`detail`: `moved`, `disconnected`, `missed`, `moderator`) · `full` (`code:'channel-full'`) · `gave-up` (`network:true` = foi a internet, **não** reportar o provedor) · `token` · `closed`. |

### Tela: presets, simulcast e contentHint (`voice/screenPresets.js`)

Bitrate da camada CHEIA (bps) por resolução × fps:

| | 5 fps | 15 fps | 30 fps | 60 fps |
|---|---|---|---|---|
| 720p | 0,8 M | 1,5 M | 2 M | 3,5 M |
| 1080p | 1,5 M | 2,5 M | 5 M | 8 M |
| 1440p | 2,5 M | 4 M | 7 M | 10 M |

- Simulcast de **2 camadas VP8** (`L1T3`): baixa = metade da resolução,
  ≤ 15 fps, `max(300 k, bitrate/4)`; cheia = bitrate da tabela no fps do preset.
- `contentHint` (regra do lib-jitsi-meet): ≤ 15 fps → `'detail'` +
  `degradationPreference: 'maintain-resolution'`; ≥ 30 fps → `'motion'` +
  `'maintain-framerate'`.
- `getDisplayMedia`: `systemAudio:'include'` (quando pede som),
  `selfBrowserSurface:'exclude'`, `surfaceSwitching:'include'`, áudio sem
  cancelamento de eco/supressor/ganho automático e `restrictOwnAudio:true`.
  Navegador que recusa as opções novas (TypeError) cai no pedido simples.
- Som da tela publicado com Opus estéreo, sem DTX, com FEC, 128 kbps.
- Recepção: consumer da tela com prioridade 200, câmera 100
  (`setConsumerPriority`).

### Microfone: Opus e VAD do RNNoise

- Mic: `opusDtx`, `opusFec`, `opusNack` (o servidor retransmite com
  `enableRtx` nos consumers de áudio), 64 kbps, `zeroRtpOnPause` (mudo não
  manda nem silêncio).
- O worklet (`public/rnnoise/rnnoise-worklet.js`) usa a probabilidade de voz
  que o `rnnoise_process_frame` devolve e manda `{ type:'vad', p, open }`
  ~20/s (`open` já com 200 ms de segura; `{ off:true }` quando o redutor
  desliga).
- Portão AUTOMÁTICO com VAD (`voice/micGate.js`), conservador — voz baixa
  nunca é cortada: abre se `p ≥ 0,5` **ou** o nível passou do limite; fecha
  só com os dois baixos por > 300 ms. Com VAD o limite automático nunca
  passa de −45 dB; o piso de ruído não sobe durante a fala e sobe mais rápido
  com ruído (teclado/respiração). O anel verde local acende na hora com o VAD.
- RNNoise desligado / sem mensagem do VAD há 500 ms / sensibilidade manual:
  vale o portão antigo, só por nível.
- Rampa do portão: abre em 8 ms, fecha em 30 ms (sem estalo).

### Erros do `join()`

`err.code` + `err.providerFailure === false` quando **não** é culpa do
provedor: `channel-full` (mostrar "Canal cheio"), `aborted` (dispose no
meio), `offline`, `kicked`, `replaced`, `rate-limited`. Use
`isProviderFailure(err)` (`voice/resilience.js`) antes de reportar
(`/api/voice/report`) ou trocar de provedor.

### Rede

Ping a cada 5 s (3 s de prazo) → sessão nova na hora. `online` /
`navigator.connection` `change` → ICE restart imediato nos dois transports.
Sem internet ou depois de o PC dormir: não desiste, espera o `online`.

### Painel "Voz conectada" e configurações

`voice.connectionInfo` = `{ state: 'connecting'|'connected'|'reconnecting'|'offline', label: 'Conectando'|'Conectado'|'Reconectando'|'Sem internet', ping, sendLoss }`.
Aparece clicando no status da barra de chamada (`CallBar`) e em
Configurações → Voz e vídeo (durante a chamada). Na mesma aba: "Volume de
entrada" (0–200 %, `extraPrefs.inputVolume`, salvo na conta) com o medidor ao
vivo, e "Atraso ao soltar a tecla" do apertar-pra-falar
(`voicePrefs.pushToTalkReleaseMs`).

### Volume da transmissão (som da tela)

`voice.remoteScreenAudioStreams[uid]` toca num player próprio
(`RemoteAudioSinks` da `CallBar`) com `voice.streamVolumes[uid]` (0–2,
`localStorage['pc.voiceStreamVolumes']`), alterado por
`voice.setStreamVolume(uid, v)` — o controle "Volume da transmissão" no bloco
da tela. Provedor que não separa (Jitsi/LiveKit): o controle continua mexendo
no volume da pessoa, como antes. A gravação local inclui o som das telas.

## 2. Socket.IO (backend → cliente)

| Evento | Payload | O app faz |
|---|---|---|
| `voice:server-state` | `{ channelId, serverMuted, serverDeafened }` | Mostra o mudo da moderação (`voice.serverMuted/serverDeafened`). |
| `voice:force-move` | `{ channelId: destino, fromChannelId, byUserId }` | Troca de canal sozinho (`joinChannel`). O engine antigo recebe `kicked/moved` — ignorado se o move chegou. |
| `voice:force-disconnect` | `{ channelId, byUserId }` | Sai da chamada com aviso. |
| `dm-call:answered` | `{ conversationId, channelId, byUserId }` | Os OUTROS aparelhos da pessoa param de tocar. |
| `dm-call:missed` | `{ conversationId, channelId }` | 60 s sem resposta: para de tocar e o chamador sai ("Ninguém atendeu"). |
| `voice:join-denied` | `{ channelId, reason: 'Canal cheio', code: 'channel-full' }` | Aviso e sai. |

Cliente → backend (com `ack({ ok, error })`): `voice:server-mute { channelId,
userId, muted }`, `voice:server-deafen { channelId, userId, deafened }`,
`voice:move { channelId, userId, toChannelId }`, `voice:disconnect {
channelId, userId }`. No contexto: `serverMuteMember`, `serverDeafenMember`,
`moveMember`, `disconnectMember` (menu ⋯ / clique direito nos blocos e na
lista de voz da barra lateral — `components/voice/voiceModerationMenu.js`).

`voice:roster`/`voice:state`/`voice:joined` trazem `serverMuted` e
`serverDeafened` por participante.

## 2b. Sinalização do servidor de mídia (novidades)

- `setConsumerPreferredLayers { consumerId, spatialLayer, temporalLayer? }` →
  `{ applied, preferredLayers }` (consumer sem simulcast: `applied:false`).
- `setConsumerPriority { consumerId, priority 1..255 }` → `{ priority }`.
- `pauseConsumer`/`resumeConsumer` valem também pro vídeo fora da tela.
- Producers de vídeo com `keyFrameRequestDelay: 1000`; consumers de áudio com
  `enableRtx: true`.
- Roteador: Opus, **VP8** (preferido), **VP9 perfil 0**, H264.
- `MEDIA_MAX_INCOMING_BITRATE` padrão **12 Mbps** (tela 1440p/60 + simulcast;
  também em `media-server/scripts/vm-voz-robusta.sh`).
- TURN: `TURN_URLS`/`TURNS_URLS` aceitam `turns:host:443?transport=tcp`
  (ordem UDP → TCP → TLS no `iceServers` do token — `services/voiceTokens.js`).

## 3. Backend → servidor de mídia

`server/src/services/mediaControl.js` → `POST <MEDIA_SERVER_URL>/control`
(header `x-media-secret`), nunca lança:
`{ room, peerId, action: 'pause-audio'|'resume-allowed'|'kick'|'set-perms', perms?, reason? }`.

O token de mídia (`/api/voice/join`) leva `canSpeak`, `canVideo`, `role`,
`serverMuted`, `serverDeafened` (`services/voiceJoinPolicy.js`); canal cheio
→ `403 { code: 'channel-full', error: 'Canal cheio' }` (MOVER MEMBROS fura).

## 4. App de PC (Electron)

O `VoiceContext` chama `window.electronAPI?.setVoiceCallActive(true)` ao
entrar (junto do serviço de chamada) e `(false)` ao sair — o processo
principal (`desktop/main.js`) usa isso pra não deixar o sistema suspender/
estrangular a janela no meio da call.

## 5. Android nativo

`MediasoupEngine.kt` segue o mesmo protocolo: `serverState`, mic publicado
pausado, ICE restart na troca de rede (o servidor tem `restartIce`; só um
servidor antigo cai na reconexão completa), fala local pelas amostras do mic
(`voice:speaking`), 4403 = expulso. Mic com `opusNack` e 64 kbps. Tela em
1080p (lado maior 1920) a 30 fps, até 4 Mbps (`maxFramerate` 30); girar o
aparelho muda a captura na hora (`changeCaptureFormat` → textura +
`VirtualDisplay.resize`). **Sem som interno** na transmissão do Android:
capturar o áudio de reprodução (AudioPlaybackCapture) e publicar como faixa
exige recompilar o libmediasoup-android com um AudioDeviceModule próprio. `VoiceManager.kt` trata
`voice:role-update`, `voice:server-state`, `voice:force-move`,
`voice:force-disconnect`; `CallAudio.kt` muta o mic durante ligação do
telefone.

## 6. AFK

Configuração da comunidade (só staff — Configurações da comunidade → Canal
AFK; `PATCH /api/admin/community`): `afkChannelId` (canal de VOZ ou `null` =
desligado) e `afkTimeoutSeconds` (60, 300, 900, 1800 ou 3600; padrão 300).
Colunas novas em `PlatformSettings` (aditivas — `prisma db push`).

Varredura (`services/voiceAfk.js`, ligada no fim do `sockets/index.js`): a
cada 30 s, com trava no Redis (`voice:afk:sweep-lock`, `SET NX PX 25s` —
uma instância por rodada).

- **Última atividade** = maior entre `lastActiveAt` (gravado ao entrar,
  ao reconectar e em todo `voice:speaking` com `speaking:true` — o cliente
  só manda isso quando realmente transmite voz: mudo, PTT solto e portão
  fechado não contam) e `joinedAt`.
- Movido quando `agora − última atividade ≥ afkTimeoutSeconds`.
- Fora da varredura: o próprio canal AFK, `dm:`/`clan:`, canais de PALCO,
  quem está com câmera/tela ligada e quem não tem CONNECT no canal AFK.
- Movimento = mesmo caminho do "Mover para…": ticket de 60 s (fura o limite),
  `voice:afk-move { channelId, channelName, fromChannelId }` pro usuário,
  saída da sala e `kick`/`moved` no servidor de mídia. O cliente avisa
  ("movido … por inatividade") e entra no AFK.
- No canal AFK: token de mídia com `canSpeak:false`, participante com
  `afk:true` e `muted:true`, `voice:state muted:false` ignorado,
  `voice:joined` com `afk:true` (o cliente muta e bloqueia o desmutar). Ao
  sair do AFK volta o mudo de antes.

## Desktop: áudio da tela

O app de desktop (Electron 44, pasta `desktop/`) entrega o som do PC junto
com a transmissão de tela **sem o som da própria chamada** (quem assiste não
ouve a própria voz de volta). O que o site precisa fazer depende do sistema.

### Windows — nada a fazer

`getDisplayMedia({ video: …, audio: true })` continua igual. O processo
principal (`desktop/screenAudio.js` → `pickLoopbackAudio`) escolhe sozinho:

| Situação | `audio` devolvido no `setDisplayMediaRequestHandler` |
| --- | --- |
| Windows 10 build ≥ 19045 e Chromium ≥ 138 | `'loopbackWithoutChrome'` (som do PC menos o processo de áudio do app) |
| Windows mais antigo | `'loopback'` (som do PC inteiro, como antes) |
| Site pediu sem áudio | só vídeo |

Diagnóstico: a variável de ambiente `PROJECT_CLUB_SCREEN_AUDIO` força o modo
(`loopback`, `nochrome` ou `off`).

### Linux — o site junta o áudio do microfone virtual

No Linux não existe loopback que exclua o próprio app. Quando o venmic
(PipeWire) está disponível, o handler devolve **só vídeo** e o site pega o
som por um microfone virtual chamado `vencord-screen-share`.

API exposta pelo preload (`window.electronAPI.screenAudio`):

- `supported(): Promise<boolean>` — `true` só no Linux com venmic carregado e PipeWire rodando.
- `start(): Promise<{ ok: true, deviceName: 'vencord-screen-share' } | { ok: false, error }>` —
  liga no microfone virtual o som de todos os apps, menos os processos do
  próprio app (processo "Audio Service" de `app.getAppMetrics()`) e menos
  fluxos de entrada (microfones).
- `stop(): Promise<{ ok: true }>` — desfaz as ligações e remove o microfone virtual.
- `deviceLabel: 'vencord-screen-share'` — texto a procurar no rótulo do dispositivo.

**O motor (`mediasoupEngine.js` → `setScreen` / `_venmicAudioTrack`) já faz
tudo isso sozinho** — só entra quando `supported()` é `true`, a captura veio
sem áudio e a pessoa pediu o som do PC; web/Windows/macOS seguem o caminho de
sempre. Passo a passo (referência):

1. `const display = await navigator.mediaDevices.getDisplayMedia({ video: …, audio: true })`
   (no Linux com venmic ele volta sem trilha de áudio — normal).
2. Se `await window.electronAPI?.screenAudio?.supported()` for `true` **e**
   `display.getAudioTracks().length === 0` **e** a pessoa quer o som do PC:
   1. `const r = await window.electronAPI.screenAudio.start()`; se `!r.ok`, segue só com vídeo.
   2. Achar o dispositivo: `navigator.mediaDevices.enumerateDevices()` e
      pegar o `audioinput` cujo `label` contém `'vencord-screen-share'`. O nó
      só aparece depois do `start()`; tentar de novo algumas vezes (por
      exemplo a cada 150 ms, até ~2 s) se ainda não estiver na lista.
   3. ```js
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: device.deviceId },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });
      ```
   4. Produzir `mic.getAudioTracks()[0]` como o áudio da tela (`screenAudio`,
      mesmo `appData`/`source` que o áudio da tela já usa no Windows).
3. Ao parar a transmissão (botão parar, `ended` da trilha de vídeo, sair da
   call): parar a trilha do microfone virtual (`track.stop()`) e chamar
   `window.electronAPI.screenAudio.stop()`. O app também chama `stop()`
   sozinho se a página recarregar/cair ou o app fechar.

Sem `electronAPI.screenAudio` (navegador, app antigo, Windows) o fluxo é o
de sempre: só o `getDisplayMedia`.

### Chamada em segundo plano

`window.electronAPI.setVoiceCallActive(true)` ao entrar na call e
`setVoiceCallActive(false)` ao sair: com a chamada ativa o app desliga o
`backgroundThrottling` da janela (timers e áudio não ficam lentos com o app
minimizado/na bandeja). Sem chamar, o app ainda desliga o throttling
enquanto houver som tocando e religa 30 s depois do silêncio.
