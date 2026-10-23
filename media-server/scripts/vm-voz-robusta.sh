#!/usr/bin/env bash
# Aplica na VM do servidor de mídia as mudanças do branch voz-servidor-robusto
# (mediasoup com WebRtcServer + recriação de worker, coturn endurecido com TURN
# sobre TLS, Caddy sem derrubar WebSocket em reload). Idempotente: dá pra rodar
# de novo sem estragar nada. Rodar como root NA VM:
#
#   sudo DOMAIN=38-92-41-54.sslip.io PUBLIC_IP=38.92.41.54 bash vm-voz-robusta.sh
#
# TURN também na porta 443 (opcional, redes que só liberam a 443):
#   sudo TURN_443=1 DOMAIN=38-92-41-54.sslip.io PUBLIC_IP=38.92.41.54 bash vm-voz-robusta.sh
# → Caddy com caddy-l4 separa por SNI: turn-38-92-41-54.sslip.io → coturn
#   (5349), resto → HTTPS. TURN_DOMAIN muda o nome (padrão: turn-<DOMAIN> no
#   sslip.io/nip.io, turn.<DOMAIN> em domínio próprio — precisa de DNS A).
#   TURN_443=0 desliga de novo. Sem TURN_443, nada muda nesse ponto.
#
# Faz backup de docker-compose.yml/Caddyfile/.env antes de mexer.
set -euo pipefail

# Tudo dentro de main(): o bash lê a função INTEIRA antes de rodar — o passo 1
# atualiza este próprio arquivo e isso não pode quebrar a execução no meio.
main() {
DOMAIN="${DOMAIN:-38-92-41-54.sslip.io}"
PUBLIC_IP="${PUBLIC_IP:-38.92.41.54}"
BRANCH="${BRANCH:-voz-servidor-robusto}"
TURN_443="${TURN_443:-}"
if [ -z "${TURN_DOMAIN:-}" ]; then
  case "$DOMAIN" in
    *.sslip.io|*.nip.io) TURN_DOMAIN="turn-$DOMAIN" ;;
    *) TURN_DOMAIN="turn.$DOMAIN" ;;
  esac
fi
# Pasta do docker-compose (descobre pelo container que já está rodando).
DIR="${DIR:-$(docker inspect media-server-media-1 --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' 2>/dev/null || true)}"
if [ -z "$DIR" ] || [ ! -f "$DIR/docker-compose.yml" ]; then
  echo "Não achei a pasta do docker-compose. Rode com DIR=/caminho/da/pasta/media-server"; exit 1
fi
cd "$DIR"
echo "==> pasta: $DIR"

# ---------- 0) backup ----------
BK="/root/media-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BK"
cp -a docker-compose.yml Caddyfile .env "$BK"/ 2>/dev/null || true
echo "==> backup em $BK"

# ---------- 1) código novo ----------
if git -C "$DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git -C "$DIR" fetch origin "$BRANCH"
  # Só os arquivos desta pasta (media-server/); .env e certs/ não são versionados.
  git -C "$DIR" checkout "origin/$BRANCH" -- .
  echo "==> código atualizado de origin/$BRANCH"
else
  echo "!! $DIR não é um clone git: copie src/, test/, docker-compose.yml, Caddyfile e scripts/ do branch $BRANCH pra cá e rode de novo."
  exit 1
fi

# ---------- 2) IP público na interface? (hairpin do TURN) ----------
if ip -4 addr show | grep -qw "$PUBLIC_IP"; then
  echo "==> $PUBLIC_IP está na interface da VM (sem NAT) — ok"
else
  PRIV="$(ip -4 route get 1.1.1.1 | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}')"
  echo "!! $PUBLIC_IP NÃO está na interface (NAT 1:1, IP privado $PRIV)."
  echo "   mediasoup: MEDIA_LISTEN_IP=0.0.0.0 + MEDIA_PUBLIC_IP=$PUBLIC_IP já resolve."
  echo "   coturn: troque no docker-compose.yml '--external-ip=\${MEDIA_PUBLIC_IP}' por '--external-ip=$PUBLIC_IP/$PRIV'"
  echo "   e adicione '--allowed-peer-ip=$PRIV' (o relay pro SFU sai pela rede interna)."
fi

# ---------- 3) buffers UDP do kernel (recomendado pra SFU) ----------
cat > /etc/sysctl.d/90-projectclub-voz.conf <<'EOF'
# Buffers maiores pra rajadas de RTP (vídeo/tela) não perderem pacote no kernel.
net.core.rmem_max = 26214400
net.core.wmem_max = 26214400
net.core.rmem_default = 1048576
net.core.wmem_default = 1048576
net.core.netdev_max_backlog = 5000
# Mínimo por socket UDP (o mediasoup abre poucos sockets, todos com rajada).
net.ipv4.udp_rmem_min = 16384
net.ipv4.udp_wmem_min = 16384
# TCP (sinalização wss, TURN/TLS, ICE-TCP de quem não tem UDP): BBR + fq
# segura a latência baixa mesmo com perda no 4G/wi-fi ruim.
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
net.ipv4.tcp_slow_start_after_idle = 0
net.ipv4.tcp_notsent_lowat = 16384
EOF
sysctl --system >/dev/null
echo "==> sysctl aplicado"

# ---------- 4) firewall ----------
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw allow 3478/udp
  ufw allow 3478/tcp
  ufw allow 5349/tcp
  ufw allow 40000:40999/udp
  ufw allow 40000:40999/tcp
  ufw allow 49152:49999/udp
  echo "==> ufw liberado"
else
  echo "!! ufw inativo/ausente — confira o firewall da VM e do PAINEL do provedor:"
fi
echo "   Precisa estar aberto: 80,443/tcp · 3478/udp+tcp · 5349/tcp · 40000-40999/udp+tcp · 49152-49999/udp"

# ---------- 5) .env ----------
set_env() { # set_env CHAVE VALOR  (troca se existe, acrescenta se não)
  if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi
}
set_env MEDIA_WEBRTC_SERVER 1
set_env MEDIA_MAX_INCOMING_BITRATE 12000000
set_env TURN_MIN_PORT 49152
set_env TURN_MAX_PORT 49999
grep -q '^MEDIA_PUBLIC_IP=' .env || set_env MEDIA_PUBLIC_IP "$PUBLIC_IP"
grep -q '^MEDIA_DOMAIN=' .env || set_env MEDIA_DOMAIN "$DOMAIN"
# TURN na 443 (opt-in): o docker compose lê COMPOSE_FILE do .env, então todo
# "docker compose …" nesta pasta passa a usar o override com caddy-l4.
del_env() { sed -i "/^$1=/d" .env; }
if [ "$TURN_443" = "1" ]; then
  [ -f docker-compose.turn443.yml ] && [ -f Caddyfile.turn443 ] || { echo "!! faltam docker-compose.turn443.yml/Caddyfile.turn443 (código antigo?)"; exit 1; }
  if ! getent ahostsv4 "$TURN_DOMAIN" | grep -qw "$PUBLIC_IP"; then
    echo "!! $TURN_DOMAIN não resolve pra $PUBLIC_IP — crie o DNS A antes (sslip.io/nip.io já resolvem sozinhos)."; exit 1
  fi
  set_env TURN_DOMAIN "$TURN_DOMAIN"
  set_env COMPOSE_FILE docker-compose.yml:docker-compose.turn443.yml
  echo "==> TURN na 443 LIGADO (SNI $TURN_DOMAIN → coturn 5349)"
elif [ "$TURN_443" = "0" ]; then
  del_env COMPOSE_FILE
  del_env TURN_DOMAIN
  echo "==> TURN na 443 desligado (Caddy padrão)"
fi
# Domínio do certificado que o coturn usa: o do TURN quando a 443 está ligada.
CERT_DOMAIN="$DOMAIN"
if grep -q '^COMPOSE_FILE=.*turn443' .env; then
  TURN_DOMAIN="$(grep '^TURN_DOMAIN=' .env | cut -d= -f2-)"
  CERT_DOMAIN="$TURN_DOMAIN"
  TURN_443=1
fi

# ---------- 6) certificado do Caddy → coturn (TURN sobre TLS na 5349) ----------
mkdir -p certs
# Com TURN na 443 o Caddy (imagem nova) precisa estar de pé e ter emitido o
# certificado do TURN_DOMAIN antes de copiar.
if [ "$TURN_443" = "1" ]; then
  docker compose up -d --build caddy
  for i in $(seq 1 30); do
    docker compose exec -T caddy sh -c "find /data/caddy/certificates -name '$CERT_DOMAIN.crt'" 2>/dev/null | grep -q . && break
    sleep 2
  done
fi
cat > /usr/local/bin/pc-turn-cert-sync <<EOF
#!/usr/bin/env bash
# Copia o certificado que o Caddy renova sozinho pro coturn e manda o coturn
# recarregar (SIGUSR2 = reload_ssl_certs, sem derrubar as alocações).
set -euo pipefail
cd "$DIR"
SRC=\$(docker compose exec -T caddy sh -c 'find /data/caddy/certificates -type d -name "$CERT_DOMAIN" | head -n1')
[ -n "\$SRC" ] || { echo "certificado de $CERT_DOMAIN ainda não existe no Caddy"; exit 0; }
tmp=\$(mktemp -d)
docker compose cp "caddy:\$SRC/$CERT_DOMAIN.crt" "\$tmp/turn.crt" >/dev/null
docker compose cp "caddy:\$SRC/$CERT_DOMAIN.key" "\$tmp/turn.key" >/dev/null
if ! cmp -s "\$tmp/turn.crt" certs/turn.crt 2>/dev/null; then
  install -m 0644 -o 65534 -g 65534 "\$tmp/turn.crt" certs/turn.crt
  install -m 0600 -o 65534 -g 65534 "\$tmp/turn.key" certs/turn.key
  docker compose kill -s USR2 coturn >/dev/null 2>&1 || true
  echo "certificado do TURN atualizado"
fi
rm -rf "\$tmp"
EOF
chmod +x /usr/local/bin/pc-turn-cert-sync
/usr/local/bin/pc-turn-cert-sync || true
if [ -s certs/turn.crt ]; then
  set_env TURN_TLS_ARGS '"--tls-listening-port=5349 --cert=/etc/coturn/certs/turn.crt --pkey=/etc/coturn/certs/turn.key"'
  echo "==> TURN/TLS ligado (5349)"
else
  echo "!! sem certificado ainda — TURN/TLS fica desligado; rode pc-turn-cert-sync e este script de novo depois"
fi
# Renovação: confere todo dia às 04:17.
echo "17 4 * * * root /usr/local/bin/pc-turn-cert-sync >/var/log/pc-turn-cert-sync.log 2>&1" > /etc/cron.d/pc-turn-cert-sync

# ---------- 7) sobe ----------
docker compose config -q
docker compose up -d --build --remove-orphans
echo "==> containers recriados; esperando o /health…"
for i in $(seq 1 30); do
  if curl -fsS "https://$DOMAIN/health" >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS "https://$DOMAIN/health"; echo

# ---------- 8) conferência ----------
echo "==> portas escutando:"
ss -lnptu | grep -E ':(443|3478|5349|4000[0-9]|4443)\b' || true
if [ "$TURN_443" = "1" ]; then
  echo "==> TURN na 443: handshake TLS com SNI $TURN_DOMAIN (tem que mostrar o certificado do TURN):"
  timeout 8 openssl s_client -connect "$PUBLIC_IP:443" -servername "$TURN_DOMAIN" </dev/null 2>/dev/null | grep -E 'subject=|Verify return' || echo "   !! sem resposta — veja: docker compose logs caddy coturn"
fi
echo "==> coturn (erros):"
docker compose logs --tail=80 coturn | grep -Ei 'error|cannot|fail' || echo "   nenhum"
TS=$(( $(date +%s) + 3600 )); U="$TS:teste"
SECRET=$(grep '^TURN_SECRET=' .env | cut -d= -f2-)
P=$(printf '%s' "$U" | openssl dgst -sha1 -hmac "$SECRET" -binary | base64)
cat <<EOF

Pronto. Teste o TURN no navegador (válido 1h):
  https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/
  URIs: turn:$DOMAIN:3478?transport=udp  turn:$DOMAIN:3478?transport=tcp  turns:$DOMAIN:5349?transport=tcp
EOF
if [ "$TURN_443" = "1" ]; then echo "        turns:$TURN_DOMAIN:443?transport=tcp"; fi
cat <<EOF
  usuário: $U
  senha:   $P
  (tem que aparecer candidato "relay")

No painel da staff (Sistema → Servidor de voz), TURN_URLS:
EOF
if [ "$TURN_443" = "1" ]; then
  echo "  turn:$DOMAIN:3478?transport=udp,turn:$DOMAIN:3478?transport=tcp,turns:$TURN_DOMAIN:443?transport=tcp,turns:$TURN_DOMAIN:5349?transport=tcp"
else
  echo "  turn:$DOMAIN:3478?transport=udp,turn:$DOMAIN:3478?transport=tcp,turns:$DOMAIN:5349?transport=tcp"
fi
}
main "$@"
