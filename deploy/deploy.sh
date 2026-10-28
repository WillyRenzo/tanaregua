#!/bin/sh
# Deploy (ou rollback) de uma versão: baixa as imagens, roda as migrations e sobe tudo.
#
#   ./deploy.sh <sha-do-commit>
#
# Rollback = rodar de novo com o SHA anterior (está em .deployed-tag antes de cada deploy).
# Migrations não voltam sozinhas: por isso elas precisam ser compatíveis com a versão
# anterior do código (expand/contract), como em architecture.md.
set -eu
cd "$(dirname "$0")"

TAG="${1:?uso: ./deploy.sh <sha-do-commit>}"
case "$TAG" in
  *[!0-9a-f]* | "") echo "deploy: a tag precisa ser o SHA do commit" >&2; exit 1 ;;
esac
export TAG

[ -f .env ] || { echo "deploy: crie o .env a partir do .env.example" >&2; exit 1; }

previous=$(cat .deployed-tag 2>/dev/null || echo "nenhuma")
echo "deploy: ${previous} -> ${TAG}"

docker compose --profile migrate pull migrate backend frontend
# O backup é construído na própria VPS; --pull traz as correções da imagem base.
docker compose build --pull backup
docker compose up -d --wait db
docker compose run --rm migrate
docker compose up -d --wait --remove-orphans

echo "$TAG" > .deployed-tag
docker image prune -f > /dev/null
echo "deploy: ${TAG} no ar (anterior: ${previous})"
