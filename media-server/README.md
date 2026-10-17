# Servidor de mídia próprio do Project Club

SFU **mediasoup** + sinalização WebSocket própria + **coturn** (STUN/TURN) + **Caddy** (TLS automático).
Implementa a arquitetura do documento *"Sistema próprio de chamadas de voz, vídeo e compartilhamento de tela"*:
o Project Club (backend) continua dono das contas, salas e permissões; este servidor só **encaminha mídia**.

> **Por que um VPS separado?** A mídia (RTP/ICE) precisa de **IP público e portas UDP abertas**.
> A Square Cloud expõe só a porta HTTP do app, então o servidor de mídia roda num VPS
> (Hetzner, Contabo, Oracle, DigitalOcean…). 1 vCPU / 2 GB aguenta dezenas de pessoas em chamada;
> o que manda é a **banda de saída** (cada ouvinte recebe o áudio/vídeo de cada falante).

## Subindo (VPS Ubuntu/Debian com Docker)

1. **DNS**: aponte um subdomínio (ex.: `media.seudominio.com`) pro IP do VPS.
2. **Firewall** (abra):
   - `80`, `443` TCP — Caddy (TLS + sinalização `wss://`)
   - `3478` UDP+TCP — coturn (STUN/TURN)
   - `5349` TCP — coturn (TURN sobre TLS, pra redes que só deixam TLS passar)
   - `40000–40999` UDP+TCP — mediasoup (mídia; `40000+N` = WebRtcServer do worker N)
   - `49152–49999` UDP — coturn (relay)
   ```bash
   ufw allow 80,443/tcp && ufw allow 3478 && ufw allow 5349/tcp && ufw allow 40000:40999/udp && ufw allow 40000:40999/tcp && ufw allow 49152:49999/udp
   ```
   Numa VM que já está no ar, o `scripts/vm-voz-robusta.sh` faz tudo isso (firewall,
   buffers UDP, certificado do TURN/TLS, `.env`) de forma idempotente.
3. **Configurar**:
   ```bash
   git clone <repo> && cd media-server
   cp .env.example .env && nano .env   # MEDIA_DOMAIN, MEDIA_PUBLIC_IP, segredos
   ```
   Gere os segredos com `openssl rand -hex 32` (um pra `MEDIA_SERVER_SECRET`, outro pra `TURN_SECRET`).
4. **Subir**: `docker compose up -d --build` — e conferir: `curl https://media.seudominio.com/health`

## TURN na porta 443 (opcional — `TURN_443=1`)

Redes que só deixam passar a 443 (empresa, escola, hotel) bloqueiam 3478/5349. Com esse modo o Caddy
olha o **SNI** do TLS na 443 **antes** de decifrar (módulo [caddy-l4](https://github.com/mholt/caddy-l4),
Apache-2.0, imagem própria em `caddy-l4/Dockerfile` via `xcaddy` — Caddy 2.11.4 + caddy-l4 v0.1.2):

- SNI = `TURN_DOMAIN` (ex.: `turn-38-92-41-54.sslip.io`) → TLS repassado intacto pro coturn (`127.0.0.1:5349`);
- qualquer outro → HTTPS de sempre (sinalização `wss://`), com o IP real do cliente.

Arquivos: `docker-compose.turn443.yml` (override: troca a imagem do Caddy e monta `Caddyfile.turn443`,
que importa o `Caddyfile` normal) — só vale com `COMPOSE_FILE=docker-compose.yml:docker-compose.turn443.yml`
e `TURN_DOMAIN=…` no `.env`. Sem isso nada muda.

**Domínio do TURN**: precisa de um nome próprio apontando pro mesmo IP (o SNI é o que separa).
Com sslip.io não precisa criar nada: `turn-38-92-41-54.sslip.io` já resolve pra `38.92.41.54`.
Em domínio próprio: DNS A `turn.seudominio.com` → IP da VM. O Caddy emite o certificado desse nome
por **HTTP-01** (porta 80 aberta; TLS-ALPN fica desligado pra ele) e o `pc-turn-cert-sync` copia esse
certificado pro coturn (que passa a usá-lo também na 5349).

**Ligar na VM** (o script faz tudo: `.env`, build da imagem, certificado, teste do handshake):
```bash
sudo BRANCH=main TURN_443=1 DOMAIN=38-92-41-54.sslip.io PUBLIC_IP=38.92.41.54 bash scripts/vm-voz-robusta.sh
```
Depois, no painel da staff (Provedores de voz → Project Club → chaves), `TURN_URLS`:
`turn:38-92-41-54.sslip.io:3478?transport=udp,turn:38-92-41-54.sslip.io:3478?transport=tcp,turns:turn-38-92-41-54.sslip.io:443?transport=tcp,turns:turn-38-92-41-54.sslip.io:5349?transport=tcp`
(o `turns:` precisa usar o `TURN_DOMAIN`: o certificado do coturn passa a ser o dele).
Teste: `openssl s_client -connect 38.92.41.54:443 -servername turn-38-92-41-54.sslip.io` mostra o
certificado do TURN; o trickle-ice com `turns:turn-38-92-41-54.sslip.io:443?transport=tcp` dá candidato `relay`.

**Desligar**: `sudo TURN_443=0 … bash scripts/vm-voz-robusta.sh` (tira `COMPOSE_FILE`/`TURN_DOMAIN` do `.env`
e volta o Caddy oficial). Observações: o coturn vê as conexões da 443 vindo de `127.0.0.1` (as cotas são
por usuário, então seguem valendo); ao ligar/desligar o Caddy é recriado (as chamadas reconectam sozinhas).

## Ligando no Project Club (variáveis de ambiente do app na Square Cloud)

| Variável | Valor |
|---|---|
| `MEDIA_SERVER_URL` | `wss://media.seudominio.com/ws` |
| `MEDIA_SERVER_SECRET` | o mesmo `MEDIA_SERVER_SECRET` do `.env` |
| `TURN_URLS` | `turn:media.seudominio.com:3478?transport=udp,turn:media.seudominio.com:3478?transport=tcp,turns:media.seudominio.com:5349?transport=tcp` |
| `TURN_SECRET` | o mesmo `TURN_SECRET` do `.env` |
| `STUN_URLS` *(opcional)* | `stun:media.seudominio.com:3478` |

Com `MEDIA_SERVER_URL` + `MEDIA_SERVER_SECRET` definidos, o provedor **"Project Club (próprio)"** aparece no painel
*Sistema → Provedores de voz* como **ativo** (ele é o primeiro da cadeia e é ilimitado). Sem eles, aparece
"não configurado" e a cadeia segue para as reservas: LiveKit (se configurado) → Jitsi.

## Como funciona

- O Project Club assina um **JWT curto** (HS256 com `MEDIA_SERVER_SECRET`) por participante: `{ sub: userId, room, name, exp }`.
  Só esse JWT abre a conexão `wss://…/ws?token=…`. O servidor de mídia **não acessa banco nem contas**.
- Cada sala = um `Router` mediasoup (num worker, 1 por CPU). Cada pessoa = 1 transport de envio + 1 de recepção;
  publica mic / câmera / tela, e assina a mídia dos outros (**SFU**: o servidor só encaminha).
- Áudio **Opus** (FEC + DTX), vídeo **VP8/H264**; câmera com **simulcast** (3 camadas) — o SFU escolhe a camada por
  ouvinte conforme a banda. Áudio tem prioridade (PDF 4.1).
- **Quem está falando** vem do `AudioLevelObserver` (anel verde na grade).
- **TURN** com credenciais temporárias (`use-auth-secret`): usuário `expira:userId`, senha = HMAC-SHA1(secret).
  Nada permanente vai pro navegador.
- Transporte criptografado (DTLS-SRTP). **Não** é ponta a ponta: o SFU precisa ler os pacotes pra encaminhar (PDF seção 6).

## Operação

- `GET /health` — status (público; **503** sem worker vivo). `GET /stats` com header `x-media-secret` — salas e participantes (`?deep=1`: ICE/DTLS e bytes por consumer).
- `POST /control` com header `x-media-secret` — ordens do backend: `{ room, peerId, action, perms? }`, com
  `action` = `pause-audio` (mudo da moderação; `perms.serverDeafened` também ensurdece) · `resume-allowed` (tira) ·
  `set-perms` (`canSpeak`/`canVideo`/`role`/`serverMuted`/`serverDeafened`) · `kick` (fecha com `4403`).
- **Permissões no servidor de mídia**: o JWT traz `canSpeak`, `canVideo`, `role` (`speaker`/`audience` do palco),
  `serverMuted`, `serverDeafened`. `produce` do microfone sem `canSpeak` e de câmera/tela sem `canVideo` é recusado
  (`forbidden:speak|video`); `resumeProducer` do mic com mudo da moderação é recusado (`forbidden:server-muted`).
  Token antigo sem essas claims = tudo permitido.
- Logs: `docker compose logs -f media`.
- **Worker do mediasoup morreu**: as salas dele fecham com código `1012` (o cliente reconecta sozinho numa sala nova)
  e um worker novo sobe no lugar — o processo NÃO cai. Só se morrerem mais de 5 em 1 minuto o processo sai e o docker reinicia.
- **Mesma pessoa em 2 aparelhos**: o mais novo fica; a sessão antiga é recusada (`4409`) se tentar voltar com o mesmo token
  e, se os dois ficarem trocando de lugar (>3 trocas/min), a troca é bloqueada por 30s — acaba o "saiu/entrou" em loop.
- **Saúde no Project Club**: o backend testa `GET /health` a cada 30s; 2 falhas seguidas tiram o servidor próprio da cadeia
  até ele voltar, e falhas reportadas por 2+ pessoas em 5 min desarmam qualquer provedor por 10 min (dobra a cada queda;
  ver `server/src/services/voiceHealth.js`).
- Códigos de fechamento da sinalização: `4401` token (detalhe `expired`/`invalid`), `4409` substituído (não reconectar),
  `4429` muitas conexões, `4503` sala cheia/indisponível, `1012` reiniciando (reconectar), `1008` flood.
- Dimensionamento: ~50 kbps por áudio, 300–1500 kbps por vídeo/tela **por ouvinte**. 10 pessoas em áudio ≈ 4,5 Mbps de saída.
