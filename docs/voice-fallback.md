# Voz: provedor reserva (Agora ⇆ Jitsi)

O plano gratuito do **Agora** (nossa camada de mídia padrão para chamadas de
voz/vídeo/tela) dá cerca de **10.000 minutos de canal por mês**. Se estourar,
as chamadas passariam a ser cobradas (ou parariam). Para a comunidade **nunca
ficar sem voz**, quando o uso do mês chega perto do limite a mídia troca
sozinha para um **provedor reserva, o Jitsi** (via *IFrame External API*),
**sem deslogar ninguém e sem derrubar ninguém da sala**.

Não hospedamos o Jitsi (a stack completa não cabe no Square Cloud): embutimos
uma conferência de um domínio público/configurável (padrão `meet.jit.si`).

## Como funciona

### 1. Contabilidade de uso (servidor)
- `server/src/services/voiceUsage.js` conta **minutos de canal do Agora por
  mês civil** (chave `YYYY-MM` em UTC, no Redis). A duração é somada na
  **saída** de cada participante (`leaveVoice` em `server/src/sockets/index.js`),
  e **só conta se a pessoa estava no Agora** (no Jitsi não gasta a cota do
  Agora). Cada participante guarda `provider` + `joinedAt` ao entrar.
- Quando o mês vira, a chave muda, o contador do mês novo começa em zero e o
  provedor **volta para o Agora automaticamente** — sem intervenção.

### 2. Decisão do provedor (servidor)
- `decideProvider()` é puro: `minutosUsados >= limite × margem` ⇒ **Jitsi**.
  Padrão: limite **10.000**, margem **95%** (troca em 9.500 min). Se o Agora
  não estiver configurado (`AGORA_APP_ID`/`AGORA_APP_CERTIFICATE` ausentes),
  também usa Jitsi.
- Exposto em **`GET /api/voice/provider`** →
  `{ provider, reason, minutesUsed, limit }` (observabilidade/admin; **sem
  segredos**).

### 3. Emissão de credenciais por provedor (servidor)
- **`GET /api/voice/join?channelName=<id>`** faz a mesma checagem de acesso do
  token do Agora e devolve o provedor escolhido + as credenciais dele:
  - **Agora:** `{ token, appId, uid }` (endpoint antigo `/api/agora/token`
    continua existindo).
  - **Jitsi:** `{ domain, room, jwt|null }`. O **nome da sala** é um hash
    SHA-256 de `callId` + um **salt secreto do servidor**
    (`jitsiRoomName()`), prefixado com `projectclub-`. Assim o domínio
    público **não vaza salas adivinháveis** a partir do id do canal. O `jwt`
    só é emitido quando o domínio exige autenticação (envs
    `JITSI_APP_ID`/`JITSI_APP_SECRET` presentes); caso contrário, fluxo
    anônimo público.

### 4. Cliente — abstração e troca
- A camada de mídia fica atrás de uma interface com **duas implementações**:
  a existente do **Agora** (inline no `VoiceContext`) e a nova do **Jitsi**
  (`client/src/voice/jitsiEngine.js`, que carrega o `external_api.js` sob
  demanda e **traduz os eventos do Jitsi para o mesmo estado de UI** —
  `client/src/voice/jitsiMapping.js`).
- Ao entrar numa chamada, o cliente chama `/api/voice/join`, descobre o
  provedor e conecta com o engine certo. A **sinalização de sala**
  (quem-está-onde, papéis, mão levantada, soundboard, reações, gravação)
  continua **sempre pela nossa Socket.IO**, independente do provedor — por
  isso lista de participantes, nomes, avatares, indicador de mudo e anel de
  "falando" dos outros **seguem funcionando no Jitsi**.
- **Troca no meio da chamada:** enquanto está no Agora, o cliente consulta
  `GET /api/voice/provider` a cada ~60s. Se passou a recomendar Jitsi, faz um
  **re-join transparente**: derruba só a mídia do Agora e sobe a do Jitsi
  **para o mesmo canal**, mantendo sessão, socket e UI montados. Aparece um
  aviso curto **"Reconectando a chamada…"**. Ninguém é deslogado nem tirado
  da sala.
- A troca ao vivo é só **Agora → Jitsi** (não o contrário no meio de uma
  chamada que já funciona). A volta ao Agora acontece naturalmente na
  **próxima** chamada, depois da virada do mês.

### 5. Transparência
- Aviso **"Chamada em modo reserva"** na tela da chamada
  (`VoiceChannelView`) e **"Modo reserva"** na barra de chamada (`CallBar`).
- `GET /api/voice/provider` dá o número de minutos usados no mês (admin).

## O que degrada no Jitsi (graceful degradation)
A mídia do Jitsi roda **dentro do iframe**, então o que dependia das faixas
locais do Agora degrada — nunca quebra:
- **Volume por pessoa** (0–200%): sem efeito no Jitsi (o áudio é tocado pelo
  iframe, não pelo nosso `AudioSink`).
- **Ensurdecer:** vira "mutar o próprio microfone" (não dá para silenciar o
  áudio que chega pela External API).
- **Apertar-pra-falar (F):** desligado no modo reserva (sem faixa local para
  gatilhar por tecla com precisão).
- **Escolha de microfone/saída pela nossa UI** e **indicador de fala por
  pessoa:** mais limitados (o Jitsi aponta só o "dominante").

O que **continua igual nos dois provedores** (vai pela nossa Socket.IO):
soundboard, reações rápidas, gravação com consentimento, mão levantada,
papéis de palco, lista/estado de participantes.

## Variáveis de ambiente (todas opcionais)
Sem nada configurado: usa Agora normal e cai no `meet.jit.si` público
(anônimo, sem segredos) quando precisa.

| Variável | Padrão | Para quê |
|---|---|---|
| `AGORA_MONTHLY_MINUTES` | `10000` | Limite mensal de minutos de canal do Agora. |
| `AGORA_SWITCH_MARGIN` | `0.95` | Fração do limite em que troca para o Jitsi. |
| `JITSI_DOMAIN` | `meet.jit.si` | Domínio do Jitsi usado pela IFrame External API. |
| `JITSI_APP_ID` + `JITSI_APP_SECRET` | — | Se presentes, o domínio exige JWT e o servidor assina um. Sem eles, fluxo anônimo. |
| `JITSI_ROOM_SALT` | `JWT_ACCESS_SECRET` | Segredo para embaralhar o nome da sala (imprevisível por padrão). |
| `JITSI_SUB` | `*` | Campo `sub` do JWT, se o seu deployment do Jitsi exigir um tenant específico. |

> **Segurança:** o `AGORA_APP_CERTIFICATE` e o `JITSI_APP_SECRET` nunca saem
> do servidor. Nomes de sala são hasheados com salt (o domínio público não
> expõe salas adivinháveis). Nunca mandamos nossos tokens de sessão/JWT do
> app para o Jitsi. A CSP (`server/src/app.js`) libera o domínio do Jitsi só
> para `script-src` (baixar o `external_api.js`) e `frame-src` (embutir a
> reunião).

## Testes
- Servidor (`cd server && npm test`): `test/voice-usage.test.js` — contador
  de uso, decisão do provedor (abaixo/acima do limite, margem, virada de
  mês, Agora não configurado) e hash do nome de sala.
- Cliente (`cd client && node --test test/voice-provider.test.mjs`):
  normalização/escolha do provedor e tradução evento-do-Jitsi → estado.
- E2E (`cd client && PW_PORT=4455 npx playwright test voice-fallback`):
  com `/api/voice/provider` simulado em `jitsi`, entrar num canal mostra o
  aviso "Chamada em modo reserva" (o `external_api.js` é simulado).
