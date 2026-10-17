# Voz: cadeia de provedores de mídia (servidor próprio → LiveKit → … → Jitsi)

As chamadas de voz/vídeo/tela usam o **servidor de mídia PRÓPRIO** do Project
Club (`media-server/`, mediasoup + coturn — ver `docs/voz-propria.md`). Se ele
não estiver disponível (não configurado, desativado pela equipe ou falhando
pra várias pessoas), a chamada passa **automaticamente** para a próxima
**reserva** da cadeia — **sem deslogar ninguém e sem derrubar ninguém da
sala**. O último da cadeia é o **Jitsi** (público `meet.jit.si`), que é
gratuito e ilimitado, então a comunidade **nunca fica sem voz**.

> Os provedores **Agora** e **Stream (GetStream)** foram **removidos** da
> plataforma (SDKs, tokens, rotas e painel). Valores antigos guardados no
> Redis com esses ids (override, provedor fixado na sala, desativados,
> chaves do painel) são **ignorados** com segurança.

Ordem da cadeia (fonte da verdade: `server/src/services/voiceProviders.js`):

| # | Provedor | Envs obrigatórias | Limite grátis padrão (min-participante/mês) |
|---|----------|-------------------|---------------------------------------------|
| 0 | **Project Club** (servidor próprio, **principal**) | `MEDIA_SERVER_URL`, `MEDIA_SERVER_SECRET` (+ `TURN_URLS`/`TURN_SECRET` opcionais) | ilimitado |
| 1 | **LiveKit** (reserva) | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | `LIVEKIT_MONTHLY_MINUTES` (5000) |
| 2 | **Daily** | `DAILY_DOMAIN`, `DAILY_ROOM_URL` + **gate** `DAILY_API_KEY` | `DAILY_MONTHLY_MINUTES` (10000) |
| 3 | **TRTC (Tencent)** | `TRTC_SDK_APP_ID`, `TRTC_SECRET_KEY` | `TRTC_MONTHLY_MINUTES` (10000) |
| 4 | **Jitsi** (reserva final) | — (nenhuma) | ilimitado |

Um provedor só entra na cadeia se estiver **configurado** (todas as envs dele
presentes). O **Daily** tem um **gate** extra: fica *configurado mas
indisponível* até existir a `DAILY_API_KEY` (necessária para mintar o token de
reunião via REST do Daily) — enquanto não existir, a cadeia o **pula**.
Daily e TRTC ainda não têm engine de cliente (ver abaixo), então no navegador
o caminho real é **servidor próprio → LiveKit (se configurado) → Jitsi**.

Nenhum segredo sai do servidor: só o **token/credencial pronto e de curta
duração** vai ao cliente, na rota `/api/voice/join`, e só para quem tem
acesso àquela sala. A margem de segurança (`VOICE_USAGE_MARGIN`, padrão `0.95`)
faz a troca por limite acontecer um pouco **antes** do limite real das
reservas pagas por uso, para nunca passar do nível gratuito.

## Como funciona

### 1. Contabilidade de uso por provedor (servidor)
- `server/src/services/voiceUsage.js` conta **minutos-participante por mês e
  por provedor** (chave `voiceusage:YYYY-MM:<provedor>` no Redis, UTC). Um
  **ticker** (`startProviderUsageTicker`, ligado em `server/src/index.js`)
  soma, a cada minuto, o total de participantes ativos (salas com 2+, sem
  ensurdecidos, com socket vivo) ao **provedor que está ativo naquele minuto**.
- Na virada do mês a chave muda e o contador zera. Se o Redis cair, a contagem
  degrada em silêncio (a voz continua; só a troca por limite fica “cega”).

### 2. Decisão da cadeia (servidor, puro/testável)
- `server/src/services/voiceDecision.js` → `decideProvider()` caminha a cadeia e
  escolhe o **primeiro** provedor que seja, ao mesmo tempo: disponível (envs +
  gate), **abaixo do limite** (com margem), **saudável** (disjuntor de
  `voiceHealth.js`) e **não desativado** pela equipe. Um **override** da equipe
  vence (ignora o limite de propósito). Se nada se qualificar, cai no **Jitsi**.
- Ids desconhecidos (ex.: `agora`, `getstream` gravados antes da remoção) são
  filtrados por `voiceOverrideStore.js` e nunca viram decisão.

### 3. Entrada numa chamada (servidor)
- **`GET /api/voice/join?channelName=<id>&clientReady=projectclub,livekit,jitsi`**
  faz a checagem de acesso (canal/DM/clã), decide o provedor e devolve **só as
  credenciais dele**:
  - **Project Club:** `{ url, token, room, identity, iceServers }` (JWT HS256 + TURN temporário).
  - **LiveKit:** `{ url, token, room, identity }` (JWT HS256 com grant `video`).
  - **TRTC:** `{ sdkAppId, userSig, userId, roomId }` (UserSig HMAC-SHA256+zlib).
  - **Daily:** `{ roomUrl, domain, token }` (token via REST, exige `DAILY_API_KEY`).
  - **Jitsi:** `{ domain, room, jwt|null }`.
- `clientReady` diz quais provedores **este aparelho** sabe usar hoje; a cadeia
  **pula** os demais só para aquele join (sem mexer no status global). O app
  Android nativo anuncia só `projectclub`.

### 4. Painel da equipe (servidor, admin)
- **`GET /api/voice/provider`** → painel com um card por provedor: status
  (`ativo`/`em espera`/`esgotado`/`instável`/`configurado (falta chave)`/`não
  configurado`/`desativado`), uso `X / Y min (Z%)`, qual está ativo e modo
  reserva. **Sem segredos.**
- **`POST /api/voice/override { provider|null }`** força um provedor / volta ao
  automático. **`POST /api/voice/provider/:id/toggle { disabled }`** liga/desliga
  um provedor na cadeia (o **Jitsi nunca** pode ser desativado). Ambos
  persistem no Redis e emitem **`voice:provider-changed`** para migrar quem já
  está em chamada **sem derrubar**.

### 5. Troca ao vivo no cliente (`client/src/context/VoiceContext.jsx`)
- Toda a mídia passa por **engines** com a mesma interface
  (`client/src/voice/engineRegistry.js`):
  `getNode/join/setMicEnabled/setCamera/setScreen/dispose`.
- Failover na entrada: se o provedor escolhido não conectar, o cliente pede o
  próximo da cadeia **sem ele** (servidor próprio → LiveKit, se configurado →
  Jitsi). Provedores que falharam neste aparelho ficam fora por ~10 min.
- A troca entre **quaisquer dois** provedores derruba só a mídia atual e sobe a
  do novo provedor **no mesmo canal**, preservando sessão, socket, roster,
  reações e soundboard; mostra **“Reconectando…”**. Dispara por (a) o evento
  `voice:provider-changed`, (b) um poll leve de `/api/voice/join` e (c) falha
  da mídia atual (engine desistiu de reconectar).
- Reações, soundboard e lista de participantes **sempre** passam pelo nosso
  Socket.IO, então funcionam em **qualquer** provedor.

### 6. App Android nativo (`android-nativo/`)
- Usa **só** o servidor próprio (`MediasoupEngine.kt`, sem SDK de terceiros).
  Se ele não conectar, tenta de novo sozinho com espera crescente (credencial
  nova a cada vez) e, esgotadas as tentativas, sai com uma mensagem clara. Se
  o servidor mandar a reserva da web (Jitsi), o app mostra “Chamada pelo site”.

## Engines de cliente: completos x pendentes

| Provedor | Engine de cliente | Observações |
|----------|-------------------|-------------|
| **Project Club** | ✅ completo (`mediasoupEngine.js`) | SFU próprio: faixas por participante na nossa grade/AudioSink; RNNoise, reconexão, ICE restart |
| **LiveKit** | ✅ completo (`livekitEngine.js`) | SFU: faixas por participante caem na nossa grade/AudioSink (identidade = userId) |
| **Jitsi** | ✅ completo (`jitsiEngine.js`) | IFrame External API: a conferência roda dentro do iframe |
| **Daily / TRTC** | ⏳ pendentes (`pendingEngines.js`) | servidor pronto (token + painel); engine de cliente ainda não — o cliente **não** os anuncia em `clientReady`, então a cadeia os pula no navegador |

O SDK de cada provedor é carregado por **`import()` dinâmico** e fica num
**chunk próprio e preguiçoso** (`vendor-mediasoup`, `vendor-livekit` — ver
`client/vite.config.js`): não entram no bundle inicial; só baixam quando a
cadeia de fato usa aquele provedor.

## Degradação graciosa por provedor (features de chamada)

O que **nunca** degrada (passa pelo nosso socket): lista de participantes,
papéis (palco/plateia), mão levantada, **reações**, **soundboard**,
nomes/avatares, cronômetro e o anel verde dos outros.

| Feature | Project Club | LiveKit | Jitsi |
|---------|:-----------:|:-------:|:-----:|
| Áudio / mudo | ✅ | ✅ | ✅ (iframe) |
| Câmera / tela | ✅ | ✅ (faixa na grade) | ✅ (dentro do iframe) |
| Qualidade da tela ao vivo | ✅ | ❌ | ❌ |
| Grade própria / auto-retrato | ✅ | ✅ | ❌ (UI é do iframe) |
| Volume por pessoa | ✅ | ✅ | ❌ |
| Ensurdecer (silenciar quem chega) | ✅ | parcial¹ | ❌ (vira auto-mute) |
| Indicador de fala (anel verde) | ✅ | ✅ (active speakers) | só o “dominante” |
| Apertar-pra-falar / sensibilidade | ✅² | ❌ | ❌ |
| Redutor de ruído / escolha de mic | ✅ (RNNoise) | SDK | iframe |

¹ *LiveKit:* o AudioSink zera o volume pelo estado `deafened`; o botão também
muta o próprio microfone, mantendo coerência.
² *Servidor próprio:* portão do microfone no engine (`setMicGate`) — fechado
manda silêncio sem mudar o “mudo” da pessoa.

## Variáveis de ambiente (todas via `process.env`, nunca hardcoded)

- **Servidor próprio:** `MEDIA_SERVER_URL`, `MEDIA_SERVER_SECRET`, `TURN_URLS`,
  `TURN_SECRET`, `STUN_URLS`, `TURN_TTL_SECONDS` (ver `media-server/README.md`).
- **LiveKit:** `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_MONTHLY_MINUTES`.
- **Daily:** `DAILY_DOMAIN`, `DAILY_ROOM_URL`, **`DAILY_API_KEY`** (gate, ainda
  não definida), `DAILY_MONTHLY_MINUTES`.
- **TRTC:** `TRTC_SDK_APP_ID`, `TRTC_SECRET_KEY`, `TRTC_MONTHLY_MINUTES`.
- **Jitsi (opcional):** `JITSI_DOMAIN` (padrão `meet.jit.si`), `JITSI_APP_ID` +
  `JITSI_APP_SECRET` (se o domínio exigir JWT).
- **Geral:** `VOICE_USAGE_MARGIN` (padrão `0.95`). Os `*_MONTHLY_MINUTES` são
  opcionais (têm padrão); `<= 0` = ilimitado para aquele provedor.
- As antigas `AGORA_*` e `GETSTREAM_*` não são mais lidas e podem ser apagadas
  da hospedagem.
