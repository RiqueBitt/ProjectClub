#!/bin/sh
# Atualiza o Project Club DENTRO do container da Shard Cloud a partir do
# branch `deploy` (main + client/dist já compilado pelo CI). Chamado pelo
# vigia de deploy (VPS projectclub-voz, scripts/deploy-watch.sh) ou pelo
# workflow deploy.yml via POST /api/apps/{id}/exec; depois disso o app é
# reiniciado e o scripts/deploy.js instala dependências e sobe o servidor.
#
# Não toca em server/uploads nem em nada fora das pastas de código.
#   uso: sh self-update.sh <sha-do-branch-deploy>
set -eu
SHA="${1:?informe o SHA}"
APP=/app
TMP=/tmp/pc-update
rm -rf "$TMP" && mkdir -p "$TMP"
curl -fsSL "https://codeload.github.com/RiqueBitt/ProjectClub/tar.gz/$SHA" | tar xz -C "$TMP" \
  --wildcards '*/server/src' '*/server/prisma' '*/server/scripts' '*/server/package.json' \
  '*/scripts' '*/client/dist' '*/client/package.json' '*/package.json' '*/package-lock.json'
SRC=$(find "$TMP" -mindepth 1 -maxdepth 1 -type d | head -1)
test -f "$SRC/client/dist/index.html" || { echo "DEPLOY-FALHOU: sem client/dist"; exit 1; }
test -f "$SRC/server/src/index.js" || { echo "DEPLOY-FALHOU: sem server/src"; exit 1; }

# Troca pasta por pasta (renomear é instantâneo: nunca fica meio copiado).
for p in server/src server/prisma server/scripts scripts client/dist; do
  rm -rf "$APP/$p.novo" "$APP/$p.velho"
  cp -a "$SRC/$p" "$APP/$p.novo"
  if [ -e "$APP/$p" ]; then mv "$APP/$p" "$APP/$p.velho"; fi
  mv "$APP/$p.novo" "$APP/$p"
  rm -rf "$APP/$p.velho"
done
cp "$SRC/package.json" "$SRC/package-lock.json" "$APP/"
cp "$SRC/server/package.json" "$APP/server/package.json"
cp "$SRC/client/package.json" "$APP/client/package.json"
echo "$SHA" > "$APP/.deployed-sha"
rm -rf "$TMP"
echo "DEPLOY-OK $SHA"
