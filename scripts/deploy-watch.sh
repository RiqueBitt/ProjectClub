#!/bin/bash
# Vigia de deploy (roda na VPS projectclub-voz a cada minuto, via systemd).
# Quando o branch `deploy` muda (o CI publica a cada push na main), manda o
# app da Shard Cloud se atualizar (scripts/self-update.sh por exec) e
# reinicia. O token da API fica só na VPS (/etc/pc-deploy/token, 600).
set -uo pipefail
APP_ID="${SHARDCLOUD_APP_ID:-f9ba88be-b4b5-4c12-aa4a-699e94d41570}"
DIR=/var/lib/pc-deploy
mkdir -p "$DIR"
exec 9>"$DIR/lock"; flock -n 9 || exit 0
TOKEN=$(cat /etc/pc-deploy/token)
API=https://shardcloud.app/api/apps/$APP_ID
log() { echo "$(date -Is) $*" >> "$DIR/deploy.log"; }

SHA=$(git ls-remote https://github.com/RiqueBitt/ProjectClub.git refs/heads/deploy | cut -f1)
[ -n "$SHA" ] || exit 0
[ "$SHA" = "$(cat "$DIR/last" 2>/dev/null)" ] && exit 0

log "novo deploy $SHA"
CMD="curl -fsSL https://raw.githubusercontent.com/RiqueBitt/ProjectClub/$SHA/scripts/self-update.sh | sh -s $SHA"
OUT=$(curl -sN --max-time 900 -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "$(jq -n --arg c "$CMD" '{command:$c}')" "$API/exec")
if ! grep -q "DEPLOY-OK $SHA" <<<"$OUT"; then
  log "falhou: $(tail -c 600 <<<"$OUT" | tr '\n' ' ')"
  exit 1
fi
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"status":"restart"}' "$API/status")
log "arquivos atualizados; reinício HTTP $CODE"
echo "$SHA" > "$DIR/last"
