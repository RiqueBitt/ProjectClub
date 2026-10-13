# Voz: cadeia de provedores de mídia (Agora → LiveKit → … → Jitsi)

As chamadas de voz/vídeo/tela usam uma **cadeia ordenada de provedores de
mídia gerenciados**. Cada um é usado até o **limite mensal gratuito** dele; ao
estourar, a chamada passa **automaticamente** para o próximo provedor da
cadeia — **sem deslogar ninguém e sem derrubar ninguém da sala**. O último da
cadeia é o **Jitsi** (público `meet.jit.si`), que é gratuito e ilimitado, então
a comunidade **nunca fica sem voz**.

Ordem da cadeia (fonte da verdade: `server/src/services/voiceProviders.js`):

| # | Provedor | Envs obrigatórias | Limite grátis padrão (min-participante/mês) |
|---|----------|-------------------|---------------------------------------------|
| 1 | **Agora** (principal) | `AGORA_APP_ID`, `AGORA_APP_CERTIFICATE` | `AGORA_MONTHLY_MINUTES` (10000) |
| 2 | **LiveKit** | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | `LIVEKIT_MONTHLY_MINUTES` (5000) |
| 3 | **Stream (GetStream)** | `GETSTREAM_API_KEY`, `GETSTREAM_API_SECRET` | `GETSTREAM_MONTHLY_MINUTES` (10000) |
| 4 | **Daily** | `DAILY_DOMAIN`, `DAILY_ROOM_URL` + **gate** `DAILY_API_KEY` | `DAILY_MONTHLY_MINUTES` (10000) |
| 5 | **TRTC (Tencent)** | `TRTC_SDK_APP_ID`, `TRTC_SECRET_KEY` | `TRTC_MONTHLY_MINUTES` (10000) |
| 6 | **Jitsi** (reserva final) | — (nenhuma) | ilimitado |

Um provedor só entra na cadeia se estiver **configurado** (todas as envs dele
presentes). O **Daily** tem um **gate** extra: fica *configurado mas
indisponível* até existir a `DAILY_API_KEY` (necessária para mintar o token de
reunião via REST do Daily) — enquanto não existir, a cadeia o **pula**.

Nenhum segredo sai do servidor: só o **token/credencial pronto e de curta
duração** (24h) vai ao cliente, na rota `/api/voice/join`, e só para quem tem
acesso àquela sala. A margem de segurança (`VOICE_USAGE_MARGIN`, padrão `0.95`)
faz a troca acontecer um pouco **antes** do limite real, para nunca passar do
nível gratuito.

## Como funciona

### 1. Contabilidade de uso por provedor (servidor)
- `server/src/services/voiceUsage.js` conta **minutos-participante por mês e
  por provedor** (chave `voiceusage:YYYY-MM:<provedor>` no Redis, UTC). Um
  **ticker** (`startProviderUsageTicker`, ligado em `server/src/index.js`)
  soma, a cada minuto, o total de participantes ativos (salas com 2+, sem
  ensurdecidos, com socket vivo) ao **provedor que está ativo naquele minuto** —
  exatamente a métrica que os serviços gerenciados cobram no nível gratuito.
- Na virada do mês a chave muda, o contador zera e a cadeia **volta ao Agora**
  automaticamente. Se o Redis cair, a contagem degrada em silêncio (a voz
  continua; só a troca por limite fica “cega”, e o Jitsi está sempre lá).

### 2. Decisão da cadeia (servidor, puro/testável)
- `server/src/services/voiceDecision.js` → `decideProvider()` caminha a cadeia e
  escolhe o **primeiro** provedor que seja, ao mesmo tempo: disponível (envs +
  gate), **abaixo do limite** (com margem) e **não desativado** pela equipe. Um
  **override** da equipe vence (ignora o limite de propósito). Se nada se
  qualificar, cai no **Jitsi**.

### 3. Entrada numa chamada (servidor)
- **`GET /api/voice/join?channelName=<id>&clientReady=agora,livekit,jitsi`**
  faz a mesma checagem de acesso de sempre (canal/DM/clã), decide o provedor e
  devolve **só as credenciais dele**:
  - **Agora:** `{ token, appId, uid }` (campos também no topo, compat).
  - **LiveKit:** `{ url, token, room, identity }` (JWT HS256 com grant `video`).
  - **Stream:** `{ apiKey, token, userId, callId }` (JWT HS256 `user_id`).
  - **TRTC:** `{ sdkAppId, userSig, userId, roomId }` (UserSig HMAC-SHA256+zlib).
  - **Daily:** `{ roomUrl, domain, token }` (token via REST, exige `DAILY_API_KEY`).
  - **Jitsi:** `{ domain, room, jwt|null }`.
- `clientReady` diz quais provedores **este navegador** sabe usar hoje; a cadeia
  **pula** os demais só para aquele join (sem mexer no status global). Isso é o
  que mantém os engines *pendentes* (ver abaixo) fora do caminho do usuário.

### 4. Painel da equipe (servidor, admin)
- **`GET /api/voice/provider`** → painel com um card por provedor: status
  (`ativo`/`em espera`/`esgotado`/`configurado (falta chave)`/`não
  configurado`/`desativado`), uso `X / Y min (Z%)`, qual está ativo e modo
  reserva. **Sem segredos.**
- **`POST /api/voice/override { provider|null }`** força um provedor / volta ao
  automático. **`POST /api/voice/provider/:id/toggle { disabled }`** liga/desliga
  um provedor na cadeia (o **Jitsi nunca** pode ser desativado). Ambos
  persistem no Redis e emitem **`voice:provider-changed`** para migrar quem já
  está em chamada **sem derrubar**.

### 5. Troca ao vivo no cliente (`client/src/context/VoiceContext.jsx`)
- O caminho do **Agora** é embutido no VoiceContext; os demais provedores usam
  **engines** com a mesma interface (`client/src/voice/engineRegistry.js`):
  `getNode/join/setMicEnabled/setCamera/setScreen/dispose`.
- A troca entre **quaisquer dois** provedores derruba só a mídia atual e sobe a
  do novo provedor **no mesmo canal**, preservando sessão, socket, roster,
  reações e soundboard; mostra **“Reconectando…”**. Dispara por (a) o evento
  `voice:provider-changed` (a equipe mexeu na cadeia) e (b) um poll leve de
  `/api/voice/join` (pega o estouro de limite no meio da chamada).
- Reações, soundboard e lista de participantes **sempre** passam pelo nosso
  Socket.IO, então funcionam em **qualquer** provedor.

## Engines de cliente: completos x pendentes

| Provedor | Engine de cliente | Observações |
|----------|-------------------|-------------|
| **Agora** | ✅ completo (embutido) | todas as features de chamada |
| **LiveKit** | ✅ completo (`livekitEngine.js`) | SFU: faixas por participante caem na nossa grade/AudioSink (identidade = userId) |
| **Jitsi** | ✅ completo (`jitsiEngine.js`) | IFrame External API: a conferência roda dentro do iframe |
| **Stream / Daily / TRTC** | ⏳ pendentes (`pendingEngines.js`) | servidor pronto (token + painel); engine de cliente ainda não — o cliente **não** os anuncia em `clientReady`, então a cadeia os pula no navegador |

O SDK de cada provedor é carregado por **`import()` dinâmico** e fica num
**chunk próprio e preguiçoso** (`vendor-livekit`, `vendor-getstream`,
`vendor-daily`, `vendor-trtc` — ver `client/vite.config.js`): não entram no
bundle inicial; só baixam quando a cadeia de fato usa aquele provedor.

## Degradação graciosa por provedor (features de chamada)

Tudo o que depende da **faixa local do Agora** degrada em provedores de outra
natureza. O que **nunca** degrada (passa pelo nosso socket): lista de
participantes, papéis (palco/plateia), mão levantada, **reações**, **soundboard**,
nomes/avatares, cronômetro e o anel verde dos outros.

| Feature | Agora | LiveKit | Jitsi | Stream/Daily/TRTC |
|---------|:----:|:-------:|:-----:|:-----------------:|
| Áudio / mudo | ✅ | ✅ | ✅ (iframe) | ⏳ |
| Câmera / tela | ✅ | ✅ (faixa na grade) | ✅ (dentro do iframe) | ⏳ |
| Grade própria / auto-retrato | ✅ | ✅ | ❌ (UI é do iframe) | ⏳ |
| Volume por pessoa | ✅ | ✅ | ❌ | ⏳ |
| Ensurdecer (silenciar quem chega) | ✅ | parcial¹ | ❌ (vira auto-mute) | ⏳ |
| Indicador de fala (anel verde) | ✅ | ✅ (active speakers) | só o “dominante” | ⏳ |
| Apertar-pra-falar (PTT) | ✅ | ❌² | ❌² | ⏳ |
| Redutor de ruído / escolha de mic | ✅ | SDK | iframe | ⏳ |

¹ *LiveKit:* o AudioSink zera o volume pelo estado `deafened`; o botão também
muta o próprio microfone, mantendo coerência.
² *PTT:* depende da faixa local do Agora; em engines próprios o microfone é do
engine e o PTT fica desligado.

## Variáveis de ambiente (todas via `process.env`, nunca hardcoded)

- **Agora:** `AGORA_APP_ID`, `AGORA_APP_CERTIFICATE`, `AGORA_MONTHLY_MINUTES`.
- **LiveKit:** `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_MONTHLY_MINUTES`.
- **Stream:** `GETSTREAM_API_KEY`, `GETSTREAM_API_SECRET`, `GETSTREAM_MONTHLY_MINUTES`.
- **Daily:** `DAILY_DOMAIN`, `DAILY_ROOM_URL`, **`DAILY_API_KEY`** (gate, ainda
  não definida), `DAILY_MONTHLY_MINUTES`.
- **TRTC:** `TRTC_SDK_APP_ID`, `TRTC_SECRET_KEY`, `TRTC_MONTHLY_MINUTES`.
- **Jitsi (opcional):** `JITSI_DOMAIN` (padrão `meet.jit.si`), `JITSI_APP_ID` +
  `JITSI_APP_SECRET` (se o domínio exigir JWT).
- **Geral:** `VOICE_USAGE_MARGIN` (padrão `0.95`). Os `*_MONTHLY_MINUTES` são
  opcionais (têm padrão); `<= 0` = ilimitado para aquele provedor.
