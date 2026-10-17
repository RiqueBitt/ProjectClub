# Voz — integração com o app de desktop

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
