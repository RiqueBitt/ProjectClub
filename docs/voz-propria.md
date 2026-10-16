# Voz própria do Project Club (mediasoup + coturn)

Implementação do documento *"Sistema próprio de chamadas de voz, vídeo e compartilhamento de tela"*
(WebRTC no cliente + sinalização própria + **mediasoup** como SFU + **coturn** para STUN/TURN).

## Peças
| Onde | O quê |
|---|---|
| `media-server/` | Servidor de mídia (roda num **VPS** com IP público/UDP). `README.md` lá tem o passo a passo (docker compose com mediasoup + coturn + Caddy/TLS). |
| `server/src/services/voiceProviders.js` | Provedor **`projectclub`** — primeiro da cadeia, ilimitado; "configurado" quando `MEDIA_SERVER_URL` + `MEDIA_SERVER_SECRET` existem. |
| `server/src/services/voiceTokens.js` | `mintProjectClub`: JWT curto (HS256) por participante + servidores ICE (STUN + **TURN com credencial temporária**). |
| `server/src/controllers/voiceController.js` | `/api/voice/join` devolve `{ provider:'projectclub', projectclub:{ url, token, room, identity, iceServers } }`. |
| `client/src/voice/mediasoupEngine.js` | Engine de cliente (`mediasoup-client`, carregado sob demanda) — mesma interface do LiveKit: mic, câmera (simulcast 3 camadas), tela (+áudio), quem fala, por-usuário. |
| `client/src/voice/providerDecision.js` / `engineRegistry.js` | Cadeia no cliente: `projectclub → agora → livekit → … → jitsi`; próprio **não** é "modo reserva". |

## Ligar em produção
1. Subir o `media-server/` num VPS (ver `media-server/README.md`).
2. Na Square Cloud, variáveis do app: `MEDIA_SERVER_URL=wss://media.seudominio.com/ws`, `MEDIA_SERVER_SECRET=…`,
   `TURN_URLS=turn:media.seudominio.com:3478?transport=udp,turn:media.seudominio.com:3478?transport=tcp`, `TURN_SECRET=…`
   (opcional `STUN_URLS`, `TURN_TTL_SECONDS`).
3. Painel da staff → *Provedores de voz*: "Project Club (servidor próprio)" aparece **ativo**. Sem as variáveis: "não configurado" e a cadeia segue como antes.

## Testes
- `npm test -w server` — cadeia, decisão, tokens (inclui o próprio).
- `cd media-server && npm test` — sinalização (JWT, salas, transports, broadcast, substituição de sessão).
- `cd media-server && npm run test:e2e` — **WebRTC real** no Chromium: 2 pessoas, áudio nos dois sentidos com RTP pelo SFU,
  quem fala, câmera liga/desliga, mudo, saída. (Mic fake do Chromium é ~silêncio, por isso o teste baixa o limiar de fala.)

## Limites conhecidos
- Precisa do VPS (a Square Cloud não expõe UDP). Custo: banda de saída do VPS.
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
