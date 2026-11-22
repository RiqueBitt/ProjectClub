#!/bin/sh
# Atualiza o Project Club DENTRO do container da Shard Cloud a partir do
# branch `deploy` (main + client/dist já compilado pelo CI). Chamado pelo
# vigia de deploy (VPS projectclub-voz, scripts/deploy-watch.sh) ou pelo
# workflow deploy.yml via POST /api/apps/{id}/exec; depois disso o app é
# reiniciado e o scripts/deploy.js instala dependências e sobe o servidor.
#
# Não toca em server/uploads nem em nada fora das pastas de código (e do
# binário do servidor em Rust, rust/bin).
#   uso: sh self-update.sh <sha-do-branch-deploy>
set -eu
SHA="${1:?informe o SHA}"
APP=/app
TMP=/tmp/pc-update
rm -rf "$TMP" && mkdir -p "$TMP"
curl -fsSL -o "$TMP/pacote.tar.gz" "https://codeload.github.com/RiqueBitt/ProjectClub/tar.gz/$SHA"
tar xzf "$TMP/pacote.tar.gz" -C "$TMP" \
  --wildcards '*/server/src' '*/server/prisma' '*/server/scripts' '*/server/package.json' \
  '*/scripts' '*/client/dist' '*/client/package.json' '*/package.json' '*/package-lock.json'
# Servidor em Rust (rust/bin/pc-server, compilado pelo CI): vem junto quando
# existe; versão antiga do branch sem ele não é erro (o app sobe só com o Node).
tar xzf "$TMP/pacote.tar.gz" -C "$TMP" --wildcards '*/rust/bin' 2>/dev/null || true
rm -f "$TMP/pacote.tar.gz"
SRC=$(find "$TMP" -mindepth 1 -maxdepth 1 -type d | head -1)
test -f "$SRC/client/dist/index.html" || { echo "DEPLOY-FALHOU: sem client/dist"; exit 1; }
test -f "$SRC/server/src/index.js" || { echo "DEPLOY-FALHOU: sem server/src"; exit 1; }
# Binário cortado no caminho não entra: confere com o .sha256 que veio junto.
if [ -f "$SRC/rust/bin/pc-server" ]; then
  WANT=$(cut -d' ' -f1 "$SRC/rust/bin/pc-server.sha256" 2>/dev/null || true)
  GOT=$(sha256sum "$SRC/rust/bin/pc-server" | cut -d' ' -f1)
  if [ -n "$WANT" ] && [ "$WANT" != "$GOT" ]; then echo "DEPLOY-FALHOU: binário do Rust não confere"; exit 1; fi
  chmod +x "$SRC/rust/bin/pc-server"
fi

# Troca pasta por pasta (renomear é instantâneo: nunca fica meio copiado).
for p in server/src server/prisma server/scripts scripts client/dist; do
  rm -rf "$APP/$p.novo" "$APP/$p.velho"
  cp -a "$SRC/$p" "$APP/$p.novo"
  if [ -e "$APP/$p" ]; then mv "$APP/$p" "$APP/$p.velho"; fi
  mv "$APP/$p.novo" "$APP/$p"
  rm -rf "$APP/$p.velho"
done
# Club Penguin removido (nov/2026): tira o servidor do jogo e a mídia baixada
# por ele (o boot também apaga a mídia, ver server/src/services/cpCleanup.js).
rm -rf "$APP/server/waddle" "$APP/server/data/waddle"
# Rust: troca a pasta do binário do mesmo jeito (o processo que está rodando
# continua com o arquivo antigo até reiniciar). Sem binário nesta versão, tira
# o antigo pra não rodar Rust de uma versão com Node de outra.
if [ -f "$SRC/rust/bin/pc-server" ]; then
  mkdir -p "$APP/rust"
  rm -rf "$APP/rust/bin.novo" "$APP/rust/bin.velho"
  cp -a "$SRC/rust/bin" "$APP/rust/bin.novo"
  if [ -e "$APP/rust/bin" ]; then mv "$APP/rust/bin" "$APP/rust/bin.velho"; fi
  mv "$APP/rust/bin.novo" "$APP/rust/bin"
  rm -rf "$APP/rust/bin.velho"
  echo "RUST-OK $(cat "$APP/rust/bin/pc-server.sha256" 2>/dev/null | cut -c1-12)"
else
  rm -rf "$APP/rust/bin"
  echo "RUST-SEM-BINARIO"
fi
cp "$SRC/package.json" "$SRC/package-lock.json" "$APP/"
cp "$SRC/server/package.json" "$APP/server/package.json"
cp "$SRC/client/package.json" "$APP/client/package.json"
echo "$SHA" > "$APP/.deployed-sha"
rm -rf "$TMP"
echo "DEPLOY-OK $SHA"
