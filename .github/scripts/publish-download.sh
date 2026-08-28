#!/usr/bin/env bash
# Publica UM arquivo no repositório de downloads público, com nova
# tentativa automática em caso de conflito.
#
# BUG CORRIGIDO ("falha ao publicar no repositório de downloads"): os
# jobs de Windows/Linux/Android rodam em PARALELO (nenhum depende do
# outro, de propósito — não faz sentido esperar o Windows terminar pra
# só depois começar o Linux). Só que os três tentam clonar, commitar e
# enviar (git push) pro MESMO repositório quase ao mesmo tempo — se o
# job A empurra a mudança dele primeiro, o clone que o job B já tinha
# feito fica desatualizado, e o `git push` dele é rejeitado (a mesma
# proteção normal do Git contra sobrescrever histórico). Esse script
# tenta de novo automaticamente (clonando de novo do zero, já com a
# mudança do outro job incluída) até 5 vezes antes de desistir de
# verdade — cobre com folga qualquer combinação de quem termina primeiro.
#
# Uso: publish-download.sh <arquivo de origem> <caminho de destino no
# repo, ex: download/App.exe> <mensagem de commit>
set -e
SRC_FILE="$1"
DEST_PATH="$2"
COMMIT_MSG="$3"
REPO_URL="https://${DOWNLOADS_REPO_TOKEN}@github.com/RiqueBitt/ProjectClub-Downloads.git"

for attempt in 1 2 3 4 5; do
  echo "Tentativa $attempt de publicar $DEST_PATH..."
  rm -rf /tmp/downloads-repo-publish
  git clone --depth 1 "$REPO_URL" /tmp/downloads-repo-publish
  cd /tmp/downloads-repo-publish
  git config user.name "Project Club CI"
  git config user.email "noreply@projectclub.local"
  mkdir -p "$(dirname "$DEST_PATH")"
  cp "$SRC_FILE" "$DEST_PATH"
  git add "$DEST_PATH"
  if git diff --cached --quiet; then
    echo "Nada mudou, pulando commit."
    exit 0
  fi
  git commit -q -m "$COMMIT_MSG"
  if git push 2>/tmp/push_error.log; then
    echo "Publicado com sucesso: $DEST_PATH"
    exit 0
  fi
  echo "Envio rejeitado (provavelmente outro job publicando ao mesmo tempo) — tentando de novo em alguns segundos..."
  cat /tmp/push_error.log
  sleep $((RANDOM % 10 + 5))
  cd /
done

echo "Falhou depois de 5 tentativas — desistindo."
exit 1
