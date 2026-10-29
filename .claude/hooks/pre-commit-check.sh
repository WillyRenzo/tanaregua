#!/usr/bin/env bash
# PreToolUse hook: bloqueia `git commit` se lint ou typecheck falhar em backend/ ou frontend/.
# Recebe o JSON da tool no stdin. Exit 2 = bloqueia e devolve o stderr ao Claude;
# exit 0 = libera. (Exit 1 NÃO bloqueia — por isso todo erro aqui sai com 2.)

input="$(cat)"

# Filtro redundante ao campo "if" do settings.json: sem jq, um grep no JSON bruto basta.
if ! printf '%s' "$input" | grep -q 'git commit'; then
  exit 0
fi

# Mensagem de commit em inglês e só com ASCII (.claude/rules/general.md). Olha só o campo
# "command" (caminhos e descrição da tool podem ter acento legítimo). O caractere pode vir cru
# (UTF-8) ou escapado no JSON (\u00e7); os dois contam. Checado antes do lint, que é lento.
command_field="$(printf '%s' "$input" | LC_ALL=C grep -oE '"command"[[:space:]]*:[[:space:]]*"([^"\\]|\\.)*"' | head -n 1)"
if printf '%s' "$command_field" | LC_ALL=C grep -q $'[\x80-\xff]' \
  || printf '%s' "$command_field" | grep -qiE '\\u(00[89a-f][0-9a-f]|0[1-9a-f][0-9a-f]{2}|[1-9a-f][0-9a-f]{3})'; then
  echo "Commit bloqueado: a mensagem de commit precisa estar em inglês e só com ASCII (sem acentos, cedilha, travessão, aspas curvas, §, →). Veja agent_docs/skills/conventional-commits." >&2
  exit 2
fi

root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
failed=0
report=""

# O Node deste projeto roda em container (docker-compose.yml); npm no host é só fallback.
# Roda um comando dentro do app (ex.: `npm run lint`, `npx prettier ...`).
run_in_app() {
  local app="$1"
  shift
  if command -v docker >/dev/null 2>&1 && [ -f "$root/docker-compose.yml" ]; then
    # cd em vez de `-f`: no Git Bash o MSYS_NO_PATHCONV (necessário para os paths do container)
    # impediria a conversão de /c/... para C:\... no argumento -f.
    (cd "$root" && MSYS_NO_PATHCONV=1 docker compose run --rm --no-deps -T "$app" "$@")
  elif command -v npm >/dev/null 2>&1; then
    (cd "$root/$app" && "$@")
  else
    echo "nem docker nem npm disponíveis para validar $app/"
    return 1
  fi
}

# Arquivos do app que entram no commit, relativos à pasta do app: os staged e também os
# alterados ou novos ainda não staged, porque o comando costuma ser `git add ... && git commit`
# e o hook roda antes do `git add`. Apagados ficam de fora.
changed_files() {
  local app="$1"
  {
    git -C "$root" diff --cached --name-only --diff-filter=d -- "$app/"
    git -C "$root" diff --name-only --diff-filter=d -- "$app/"
    git -C "$root" ls-files --others --exclude-standard -- "$app/"
  } | sort -u | sed "s#^$app/##"
}

for app in backend frontend; do
  # Pasta ainda não criada (projeto em scaffold): nada para validar.
  [ -f "$root/$app/package.json" ] || continue

  for script in lint typecheck; do
    if ! output="$(run_in_app "$app" npm run "$script" 2>&1)"; then
      failed=1
      report+=$'\n'"=== $app: npm run $script falhou ==="$'\n'"$(printf '%s' "$output" | tail -n 40)"$'\n'
    fi
  done

  # Formatação só dos arquivos do commit, com o mesmo escopo do `format:check` do CI: no
  # backend, os .ts; no frontend, tudo que o prettier conhece. O .prettierignore vale para
  # arquivos passados pelo nome. `--end-of-line auto`: no Windows, o autocrlf deixa CRLF na
  # cópia local, e o CI (que vê LF) não reclamaria disso.
  files=()
  while IFS= read -r file; do
    [ -n "$file" ] || continue
    if [ "$app" = backend ] && [[ "$file" != *.ts ]]; then continue; fi
    files+=("$file")
  done < <(changed_files "$app")
  if [ "${#files[@]}" -gt 0 ]; then
    if ! output="$(run_in_app "$app" npx prettier --check --end-of-line auto --ignore-unknown -- "${files[@]}" 2>&1)"; then
      failed=1
      report+=$'\n'"=== $app: formatação (prettier --check) falhou; rode prettier --write só nesses arquivos ==="$'\n'"$(printf '%s' "$output" | tail -n 40)"$'\n'
    fi
  fi
done

if [ "$failed" -ne 0 ]; then
  echo "Commit bloqueado: corrija os erros abaixo e tente de novo.$report" >&2
  exit 2
fi

exit 0
