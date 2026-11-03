#!/usr/bin/env bash
# Ajuste do HOST do servidor de mídia (revisão voz-turbo). Idempotente: rodar
# de novo não muda nada além do que já estava. NÃO mexe no docker-compose.yml,
# no .env nem no scripts/vm-voz-robusta.sh (que já escreve
# /etc/sysctl.d/90-projectclub-voz.conf com os buffers UDP e BBR) — este
# script só ACRESCENTA /etc/sysctl.d/91-projectclub-voz-turbo.conf e confere
# o resto. Rodar como root NA VM:
#
#   sudo bash media-server/scripts/tune-host.sh            # aplica
#   sudo bash media-server/scripts/tune-host.sh --dry-run  # só mostra
#
# O que acrescenta (e por quê):
#   - net.core.somaxconn / tcp_max_syn_backlog 4096: quando o servidor de
#     mídia reinicia uma sala, dezenas de clientes reconectam juntos (WSS no
#     Caddy + TURN/TLS no coturn); fila de 4096 não descarta SYN na rajada.
#   - vm.swappiness 10: o worker do mediasoup não pode ir pro swap (cada
#     página trazida de volta do disco é um "picote" no áudio de todo mundo).
#   - Se o 90-projectclub-voz.conf NÃO existir (VM montada sem o script
#     antigo), também escreve os buffers UDP (25 MB) e o backlog da placa.
set -euo pipefail

DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1
if [ "$DRY" = 0 ] && [ "$(id -u)" != "0" ]; then echo "rode como root (sudo) — ou use --dry-run"; exit 1; fi

CONF=/etc/sysctl.d/91-projectclub-voz-turbo.conf
BASE=/etc/sysctl.d/90-projectclub-voz.conf

body="# Gerado por media-server/scripts/tune-host.sh (revisão voz-turbo).
# Rajada de reconexões depois de reiniciar o servidor de mídia.
net.core.somaxconn = 4096
net.ipv4.tcp_max_syn_backlog = 4096
# Worker do mediasoup fora do swap (picote no áudio).
vm.swappiness = 10
"
if [ ! -f "$BASE" ]; then
  body="$body# Buffers UDP pra rajadas de RTP (o 90-projectclub-voz.conf não existe nesta VM).
net.core.rmem_max = 26214400
net.core.wmem_max = 26214400
net.core.rmem_default = 1048576
net.core.wmem_default = 1048576
net.core.netdev_max_backlog = 5000
net.ipv4.udp_rmem_min = 16384
net.ipv4.udp_wmem_min = 16384
"
fi

if [ "$DRY" = 1 ]; then
  echo "==> (dry-run) escreveria $CONF:"; printf '%s' "$body"
elif [ -f "$CONF" ] && [ "$(cat "$CONF")" = "$(printf '%s' "$body")" ]; then
  echo "==> $CONF já está igual — nada a fazer"
else
  printf '%s' "$body" > "$CONF"
  sysctl --system >/dev/null
  echo "==> $CONF aplicado"
fi

# ---------- conferência (só leitura) ----------
show() { printf '   %-34s %s\n' "$1" "$(sysctl -n "$1" 2>/dev/null || echo '?')"; }
echo "==> valores em uso:"
for k in net.core.rmem_max net.core.wmem_max net.core.netdev_max_backlog net.core.somaxconn \
         net.ipv4.tcp_congestion_control net.core.default_qdisc vm.swappiness; do show "$k"; done

CPUS=$(nproc 2>/dev/null || echo '?')
echo "==> CPUs: $CPUS (o servidor de mídia sobe 1 worker por CPU; MEDIA_WORKERS no .env troca)"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -f "$DIR/.env" ]; then
  lvl=$(grep -E '^MEDIA_LOG_LEVEL=' "$DIR/.env" | cut -d= -f2- || true)
  [ "${lvl:-warn}" = "debug" ] && echo "!! MEDIA_LOG_LEVEL=debug gasta CPU no worker — use warn em produção"
  dyn=$(grep -E '^MEDIA_DYNACAST=' "$DIR/.env" | cut -d= -f2- || true)
  echo "==> dynacast: ${dyn:-ligado (padrão)}  ·  MEDIA_MAX_INCOMING_BITRATE=$(grep -E '^MEDIA_MAX_INCOMING_BITRATE=' "$DIR/.env" | cut -d= -f2- || echo 'padrão 12000000')"
fi
if command -v docker >/dev/null 2>&1; then
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q 'media'; then
    echo "==> containers:"; docker ps --format '   {{.Names}}  {{.Status}}' | grep -E 'media|coturn|caddy' || true
  fi
fi
echo "Pronto."
