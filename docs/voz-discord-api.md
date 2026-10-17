# Voz "igual ao Discord" — API do motor e como o app usa

Referência das peças novas da voz própria (servidor de mídia mediasoup). O
`VoiceContext.jsx` já está ligado em tudo abaixo; esta página serve pra
manter (e pra quem for mexer no Android/PC).

## 1. Engine web (`client/src/voice/mediasoupEngine.js`)

### Métodos novos

| Método | O que faz | Quem chama no VoiceContext |
|---|---|---|
| `join({ ..., startMuted, startDeafened })` | Entra já mudo (mic publicado **pausado**) e/ou ensurdecido (o servidor nem manda o áudio dos outros). | `connectEngine`: `startMuted = muted \|\| deafened`, `startDeafened = deafened` (persistem entre canais). |
| `setPushToTalk(on, { releaseDelayMs = 200 })` | Liga o apertar-pra-falar: portão fechado até `setPttPressed(true)`. | `applyEngineMicConfig` (preferência `pushToTalkEnabled`). |
| `setPttPressed(bool)` | Tecla apertada/solta. Solta → continua aberto `releaseDelayMs`. | Efeito da tecla do PTT (keydown/keyup/blur). |
| `setInputSensitivity({ auto, db } \| null)` | Detecção de voz: fecha o portão 250 ms abaixo do limite. `auto:true` = piso de ruído adaptativo; `{auto:false, db}` = limite manual; `null` = sempre aberto. | `applyEngineMicConfig` (`sensitivityAuto`/`sensitivityDb` das Configurações). |
| `setMicGate(open)` | Portão MANUAL (soma com PTT/sensibilidade). | Não usado pelo app hoje (fica pra telas como "teste de mic"). |
| `setInputGain(0..4)` | Ganho de entrada no pipeline. | Ainda sem preferência na UI. |
| `getMicGateState()` | `{ open, mode:'open'\|'ptt'\|'vad', thresholdDb, floorDb, pipelineMode:'graph'\|'direct', gateValue }` (diagnóstico/testes). | — |
| `isMicMeterActive()` / `getMicLastSoundAt()` | Medidor do mic rodando / último instante com som. | Aviso "microfone sem som". |
| `getLocalMicTrack({ raw })` | Padrão: faixa **processada** (a que vai pra call — use pra gravar). `raw:true`: captura crua. | `getLocalMicTrack` do contexto (gravação). |
| `setDeafened(bool)` | Pausa/retoma o áudio recebido **no servidor** (economia de banda). | `toggleDeafen` / `toggleMute` (desmutar ensurdecido desensurdece). |
| `setNoiseSuppression(on)` | Liga/desliga RNNoise ao vivo; o supressor do navegador faz o inverso (`applyConstraints`). | `setNoiseReduction`. |
| `setCamera(on, { detailed })` / `setScreen(on, { quality, width, height, frameRate, maxBitrate, audio, track, detailed })` | Legado: devolve `MediaStream \| null`. Com `detailed:true`: `{ ok, stream, reason, cancelled, code }`. Erro também sai em `onMediaError`. | `toggleCamera` / `toggleScreenShare` (legado + toast pelo callback). |
| `setScreenQuality('720p' \| { quality, width, height, frameRate, maxBitrate })` | Muda resolução/fps (`applyConstraints`) e bitrate (`setRtpEncodingParameters`) ao vivo. | `setScreenShareQuality`. |

### Callbacks novos

| Callback | Quando |
|---|---|
| `onLocalLevel(level0a1, { db, gateOpen, transmitting })` | ~10/s enquanto o medidor roda. O contexto repassa por `subscribeMicLevel(fn)`. |
| `onLocalSpeaking(bool)` | Agora vem do Analyser local (instantâneo, 300 ms de segura); sem Web Audio, vale o `activeSpeakers` do servidor. Já desconta mudo/portão fechado. |
| `onServerState({ canSpeak, canVideo, role, serverMuted, serverDeafened })` | Permissões/moderação impostas pelo servidor de mídia. |
| `onMediaError({ kind:'camera'\|'screen', reason, cancelled, code })` | Erro amigável em pt-BR; `cancelled` = fechou o seletor de tela (sem aviso). |
| `onTelemetry({ type })` | `consumer-recreate`, `consumer-resume-failed`, `mic-bypass`, `mic-restored`, `default-mic-changed`. |
| `onLeft({ reason, network?, code?, detail?, providerFailure? })` | `reason`: `replaced` · `kicked` (`detail`: `moved`, `disconnected`, `missed`, `moderator`) · `full` (`code:'channel-full'`) · `gave-up` (`network:true` = foi a internet, **não** reportar o provedor) · `token` · `closed`. |

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
pausado, ICE restart na troca de rede, fala local pelas amostras do mic
(`voice:speaking`), 4403 = expulso. `VoiceManager.kt` trata
`voice:role-update`, `voice:server-state`, `voice:force-move`,
`voice:force-disconnect`; `CallAudio.kt` muta o mic durante ligação do
telefone.

## 6. AFK

Não implementado: o modelo de dados não tem canal/tempo de AFK (o antigo
`Server.afkChannelId` não existe na comunidade única). O cliente já escuta
`voice:afk-move`; quando existir `afkChannelId`/`afkTimeout` (ex.: em
PlatformSettings), basta uma varredura no `sockets/index.js` usando o
`lastActiveAt` do participante (atualizado pelo `voice:speaking`).

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

Passo a passo no site (motor de voz, ao começar a transmitir a tela):

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
