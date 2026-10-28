#!/usr/bin/env bash
# Desfaz mudanças que são só de fim de linha (CRLF ↔ LF), comuns no Windows depois de
# rodar o prettier: o arquivo aparece como modificado, mas o diff de conteúdo é vazio.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

restored=0
while IFS= read -r file; do
  # `git diff --quiet` ignora a diferença de EOL que o autocrlf normaliza.
  if git diff --quiet -- "$file"; then
    git checkout -- "$file"
    restored=$((restored + 1))
  fi
done < <(git diff --name-only --diff-filter=M)

echo "Arquivos restaurados (só fim de linha): $restored"
