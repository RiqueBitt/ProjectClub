#!/usr/bin/env bash
# Publica UM arquivo no repositório de downloads público, com nova
# tentativa automática em caso de conflito (dois jobs publicando ao
# mesmo tempo).
#
# BUG CORRIGIDO ("File ... exceeds GitHub's file size limit of 100.00
# MB"): esse erro específico NUNCA seria resolvido tentando de novo — o
# limite de 100MB do Git normal é fixo, sem exceção. O repositório de
# downloads já vem com um .gitattributes configurando Git LFS pro
# AppImage de Linux (o único arquivo que passa dos 100MB); esse script
# só precisa garantir que o `git-lfs` está instalado no runner antes de
# clonar, senão o filtro do .gitattributes é ignorado silenciosamente e
# o arquivo tenta ir como blob normal de novo, batendo no mesmo erro.
#
# Uso: publish-download.sh <arquivo de origem> <caminho de destino no
# repo, ex: download/App.exe> <mensagem de commit>
set -e
SRC_FILE="$1"
DEST_PATH="$2"
COMMIT_MSG="$3"
REPO_URL="https://${DOWNLOADS_REPO_TOKEN}@github.com/RiqueBitt/ProjectClub-Downloads.git"

# git-lfs já vem pronto nos runners Ubuntu/Windows/Mac da GitHub — isso
# aqui é só uma rede de segurança, caso mude num runner futuro.
if ! command -v git-lfs >/dev/null 2>&1; then
  git lfs install --skip-repo || true
fi

for attempt in 1 2 3 4 5; do
  echo "Tentativa $attempt de publicar $DEST_PATH..."
  rm -rf /tmp/downloads-repo-publish
  git clone --depth 1 "$REPO_URL" /tmp/downloads-repo-publish
  cd /tmp/downloads-repo-publish
  git lfs install --local
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
  if grep -q "exceeds GitHub's file size limit" /tmp/push_error.log; then
    echo "ERRO FATAL: arquivo grande demais pro Git normal e sem LFS configurado pra esse padrão de nome — não adianta tentar de novo."
    cat /tmp/push_error.log
    exit 1
  fi
  echo "Envio rejeitado (provavelmente outro job publicando ao mesmo tempo) — tentando de novo em alguns segundos..."
  cat /tmp/push_error.log
  sleep $((RANDOM % 10 + 5))
  cd /
done

echo "Falhou depois de 5 tentativas — desistindo."
exit 1
