#!/usr/bin/env bash
# Aplica na VM do servidor de mídia as mudanças do branch voz-servidor-robusto
# (mediasoup com WebRtcServer + recriação de worker, coturn endurecido com TURN
# sobre TLS, Caddy sem derrubar WebSocket em reload). Idempotente: dá pra rodar
# de novo sem estragar nada. Rodar como root NA VM:
#
#   sudo DOMAIN=38-92-41-54.sslip.io PUBLIC_IP=38.92.41.54 bash vm-voz-robusta.sh
#
# Faz backup de docker-compose.yml/Caddyfile/.env antes de mexer.
set -euo pipefail

# Tudo dentro de main(): o bash lê a função INTEIRA antes de rodar — o passo 1
# atualiza este próprio arquivo e isso não pode quebrar a execução no meio.
main() {
DOMAIN="${DOMAIN:-38-92-41-54.sslip.io}"
PUBLIC_IP="${PUBLIC_IP:-38.92.41.54}"
BRANCH="${BRANCH:-voz-servidor-robusto}"
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
set_env MEDIA_MAX_INCOMING_BITRATE 5000000
set_env TURN_MIN_PORT 49152
set_env TURN_MAX_PORT 49999
grep -q '^MEDIA_PUBLIC_IP=' .env || set_env MEDIA_PUBLIC_IP "$PUBLIC_IP"
grep -q '^MEDIA_DOMAIN=' .env || set_env MEDIA_DOMAIN "$DOMAIN"

# ---------- 6) certificado do Caddy → coturn (TURN sobre TLS na 5349) ----------
mkdir -p certs
cat > /usr/local/bin/pc-turn-cert-sync <<EOF
#!/usr/bin/env bash
# Copia o certificado que o Caddy renova sozinho pro coturn e manda o coturn
# recarregar (SIGUSR2 = reload_ssl_certs, sem derrubar as alocações).
set -euo pipefail
cd "$DIR"
SRC=\$(docker compose exec -T caddy sh -c 'find /data/caddy/certificates -type d -name "$DOMAIN" | head -n1')
[ -n "\$SRC" ] || { echo "certificado de $DOMAIN ainda não existe no Caddy"; exit 0; }
tmp=\$(mktemp -d)
docker compose cp "caddy:\$SRC/$DOMAIN.crt" "\$tmp/turn.crt" >/dev/null
docker compose cp "caddy:\$SRC/$DOMAIN.key" "\$tmp/turn.key" >/dev/null
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
echo "==> coturn (erros):"
docker compose logs --tail=80 coturn | grep -Ei 'error|cannot|fail' || echo "   nenhum"
TS=$(( $(date +%s) + 3600 )); U="$TS:teste"
SECRET=$(grep '^TURN_SECRET=' .env | cut -d= -f2-)
P=$(printf '%s' "$U" | openssl dgst -sha1 -hmac "$SECRET" -binary | base64)
cat <<EOF

Pronto. Teste o TURN no navegador (válido 1h):
  https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/
  URIs: turn:$DOMAIN:3478?transport=udp  turn:$DOMAIN:3478?transport=tcp  turns:$DOMAIN:5349?transport=tcp
  usuário: $U
  senha:   $P
  (tem que aparecer candidato "relay")

No painel da staff (Sistema → Provedores de voz → Project Club → chaves), TURN_URLS:
  turn:$DOMAIN:3478?transport=udp,turn:$DOMAIN:3478?transport=tcp,turns:$DOMAIN:5349?transport=tcp
EOF
}
main "$@"
