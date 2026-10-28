#!/usr/bin/env bash
# Valida o commit que está no índice ISOLADO do resto do trabalho: guarda o que não está
# staged (inclusive arquivos novos), roda lint, typecheck e testes unitários dos apps
# pedidos e devolve tudo. Assim cada commit atômico prova que funciona sozinho.
#
# Uso: check-staged.sh [backend] [frontend]   (padrão: os dois)
set -uo pipefail

cd "$(git rev-parse --show-toplevel)"
apps=("$@")
[ ${#apps[@]} -eq 0 ] && apps=(backend frontend)

if git diff --cached --quiet; then
  echo "Nada staged para validar." >&2
  exit 2
fi

# Só faz pop se este script de fato criou um stash (senão devolveria um stash antigo).
before=$(git stash list | wc -l)
git stash push --keep-index --include-untracked --quiet --message "check-staged" || exit 2
after=$(git stash list | wc -l)

status=0
for app in "${apps[@]}"; do
  for script in lint typecheck test; do
    echo "=== $app: npm run $script ==="
    if ! MSYS_NO_PATHCONV=1 docker compose run --rm --no-deps -T "$app" npm run "$script"; then
      status=1
    fi
  done
done

if [ "$after" -gt "$before" ]; then
  if ! git stash pop --quiet; then
    echo "Conflito ao devolver o trabalho não staged. Recupere cada arquivo com" >&2
    echo "  git checkout stash@{0} -- <caminho>   e depois   git stash drop" >&2
    exit 2
  fi
fi

[ "$status" -eq 0 ] && echo "OK: o que está staged passa sozinho." || echo "FALHOU: corrija antes de commitar." >&2
exit "$status"
