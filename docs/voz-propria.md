# Voz própria do Project Club (mediasoup + coturn)

Implementação do documento *"Sistema próprio de chamadas de voz, vídeo e compartilhamento de tela"*
(WebRTC no cliente + sinalização própria + **mediasoup** como SFU + **coturn** para STUN/TURN).

O servidor de mídia próprio é o **único** provedor de voz da plataforma (site, app de PC e app Android).
A antiga cadeia de provedores de reserva (Agora, GetStream, LiveKit, Daily, TRTC, Jitsi), o painel
"Provedores de voz", o disjuntor de saúde e a troca de provedor no meio da chamada foram removidos.

## Peças
| Onde | O quê |
|---|---|
| `media-server/` | Servidor de mídia (roda num **VPS** com IP público/UDP). `README.md` lá tem o passo a passo (docker compose com mediasoup + coturn + Caddy/TLS). |
| `server/src/services/voiceTokens.js` | `mintProjectClub`: JWT curto (HS256) por participante + servidores ICE (STUN + **TURN com credencial temporária**). `isConfigured()` = `MEDIA_SERVER_URL` + `MEDIA_SERVER_SECRET` existem. |
| `server/src/services/voiceCredentials.js` | Chaves do servidor de voz editáveis pelo painel da staff (`MEDIA_SERVER_URL`, `MEDIA_SERVER_SECRET`, `TURN_URLS`, `TURN_SECRET`), criptografadas no Redis (`voice:credentials`) e aplicadas em `process.env` na subida. |
| `server/src/controllers/voiceController.js` | `GET /api/voice/join` devolve `{ provider:'projectclub', projectclub:{ url, token, room, identity, iceServers } }` (clientes antigos que mandam `clientReady` recebem o mesmo). Sem servidor configurado: `503 { code:'voice-unavailable' }`. `POST /api/voice/report`: só telemetria (log). Staff: `GET /api/voice/server`, `POST /api/voice/server/config`. |
| `server/src/services/voiceUsage.js` | Minutos de voz do mês (`voiceusage:YYYY-MM:projectclub`) — só pro Painel de saúde. |
| `server/src/services/voiceLegacyCleanup.js` | Na subida, apaga do Redis as chaves da antiga cadeia (`voice:override`, `voice:disabled`, `voice:epoch`, `voice:roomprov:*`, `voice:lastjoin:*`, `voice:health:*` e as chaves de provedores removidos dentro de `voice:credentials`). |
| `client/src/voice/mediasoupEngine.js` | Engine de cliente (`mediasoup-client`, carregado sob demanda): mic, câmera (simulcast 3 camadas), tela (+áudio), quem fala, volume por usuário. |
| `client/src/voice/engineRegistry.js` / `joinResponse.js` | Cria o engine e valida a resposta de `/api/voice/join`. |
| `client/src/context/VoiceContext.jsx` | Entrar/sair, e a **recuperação da mídia**: quando a mídia cai e não volta sozinha, refaz com credencial nova no mesmo canal (até 3 tentativas) sem tirar a pessoa da sala. |
| `android-nativo/.../voice/VoiceManager.kt` | Mesmo servidor próprio no app Android (reconexão com espera crescente). |

## Ligar em produção
1. Subir o `media-server/` num VPS (ver `media-server/README.md`).
2. Na Square Cloud, variáveis do app: `MEDIA_SERVER_URL=wss://media.seudominio.com/ws`, `MEDIA_SERVER_SECRET=…`,
   `TURN_URLS=turn:media.seudominio.com:3478?transport=udp,turn:media.seudominio.com:3478?transport=tcp`, `TURN_SECRET=…`
   (opcional `STUN_URLS`, `TURN_TTL_SECONDS`, `VOICE_ROOM_SALT` — o nome antigo `JITSI_ROOM_SALT` ainda vale).
   Também dá pra definir essas chaves pelo painel da staff (*Sistema → Servidor de voz*).
3. Painel da staff → *Servidor de voz*: aparece **configurado**. Sem as variáveis: "não configurado (sem voz)".

## Testes
- `cd server && node --test` — tokens, `/api/voice/join` (inclusive compatibilidade com clientes antigos), report, painel, faxina do Redis.
- `cd media-server && npm test` — sinalização (JWT, salas, transports, broadcast, substituição de sessão).
- `node media-server/test/e2e-webrtc.mjs` — **WebRTC real** no Chromium: 2 pessoas, áudio nos dois sentidos com RTP pelo SFU,
  quem fala, câmera liga/desliga, mudo, saída. (Mic fake do Chromium é ~silêncio, por isso o teste baixa o limiar de fala.)
- `cd client && npx playwright test e2e/voice-*.spec.mjs` — painel "Servidor de voz" e entrada na chamada.

## Limites conhecidos
- Precisa do VPS (a Square Cloud não expõe UDP). Custo: banda de saída do VPS.
- Sem servidor de reserva: se o VPS cair, não há voz até ele voltar (o status em `/status` mostra "Chamadas de voz").
- Criptografia é de **transporte** (DTLS-SRTP); o SFU vê os pacotes pra encaminhar (não é E2EE) — PDF seção 6.
- Gravação não existe (nem era pedida); se um dia entrar, é uma decisão de produto/privacidade separada.

## Rich presence pros apps do ecossistema

Qualquer app (ProjectMC, CanvasProject, integrações) pode avisar o que a
pessoa está fazendo, com o token da sessão dela:

```
POST /api/activity/presence   Authorization: Bearer <token>
{ "type": "app", "name": "CanvasProject", "detail": "pintando retrato.kra", "imageUrl": "/apps/canvasproject/icon.png", "ttlSeconds": 60 }

DELETE /api/activity/presence   (ao fechar)
```

Reenvie antes de `ttlSeconds` (padrão 60, máx. 300) pra manter; se o app
fechar sem avisar, some sozinho. `type: "game"` também conta tempo de jogo
na biblioteca. O app de desktop já detecta os apps do ecossistema pelo
processo (ProjectMC.exe, CanvasProject.exe…) sem precisar disso.
