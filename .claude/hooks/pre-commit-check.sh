#!/usr/bin/env bash
# PreToolUse hook: bloqueia `git commit` se lint ou typecheck falhar em backend/ ou frontend/.
# Recebe o JSON da tool no stdin. Exit 2 = bloqueia e devolve o stderr ao Claude;
# exit 0 = libera. (Exit 1 NÃO bloqueia — por isso todo erro aqui sai com 2.)

input="$(cat)"

# Filtro redundante ao campo "if" do settings.json: sem jq, um grep no JSON bruto basta.
if ! printf '%s' "$input" | grep -q 'git commit'; then
  exit 0
fi

root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
failed=0
report=""

# O Node deste projeto roda em container (docker-compose.yml); npm no host é só fallback.
run_script() {
  local app="$1" script="$2"
  if command -v docker >/dev/null 2>&1 && [ -f "$root/docker-compose.yml" ]; then
    # cd em vez de `-f`: no Git Bash o MSYS_NO_PATHCONV (necessário para os paths do container)
    # impediria a conversão de /c/... para C:\... no argumento -f.
    (cd "$root" && MSYS_NO_PATHCONV=1 docker compose run --rm --no-deps -T "$app" npm run "$script")
  elif command -v npm >/dev/null 2>&1; then
    npm --prefix "$root/$app" run "$script"
  else
    echo "nem docker nem npm disponíveis para validar $app/"
    return 1
  fi
}

for app in backend frontend; do
  # Pasta ainda não criada (projeto em scaffold): nada para validar.
  [ -f "$root/$app/package.json" ] || continue

  for script in lint typecheck; do
    if ! output="$(run_script "$app" "$script" 2>&1)"; then
      failed=1
      report+=$'\n'"=== $app: npm run $script falhou ==="$'\n'"$(printf '%s' "$output" | tail -n 40)"$'\n'
    fi
  done
done

if [ "$failed" -ne 0 ]; then
  echo "Commit bloqueado: corrija os erros abaixo e tente de novo.$report" >&2
  exit 2
fi

exit 0
