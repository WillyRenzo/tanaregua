# Hooks — Enforcement Real

Regras escritas em prosa (CLAUDE.md, `agent_docs/`) são **contexto**: a IA pode
pular uma delas sob pressão de contexto. Hooks são comandos que o Claude Code
executa automaticamente em eventos do ciclo de vida, **independente do que a IA
decidir**.

## O que está ativo neste projeto

`.claude/settings.json` registra um hook `PreToolUse` que dispara quando o
Claude tenta rodar `git commit` (pela tool Bash ou PowerShell) e executa
[`pre-commit-check.sh`](pre-commit-check.sh):

1. Para cada app (`backend/`, `frontend/`) que já tiver `package.json`, roda `npm run lint` e `npm run typecheck` **dentro do container** do app (`docker compose run --rm --no-deps -T <app>`), porque o Node não está instalado no host. Se não houver Docker, usa o `npm` do host.
2. Se algo falhar, sai com **exit 2**. O commit é bloqueado e o Claude recebe as últimas linhas do erro para corrigir.
3. Apps ainda não criados são ignorados, então o hook não atrapalha durante o scaffold.

Detalhes que importam (e que o exemplo genérico original do kit errava):

- O input da tool chega como **JSON no stdin** (`tool_input.command`). Não existe a variável `$CLAUDE_TOOL_INPUT`.
- Só **exit 2** bloqueia. Exit 1 é tratado como erro não-bloqueante e o commit seguiria.
- O campo `"if": "Bash(git commit*)"` filtra para o hook nem rodar em outros comandos. O script também checa o comando, por redundância.
- No Windows o hook roda no Git Bash (`"shell": "bash"`). O script não depende de `jq`.

## Requisitos

- Os dois apps precisam ter os scripts `lint` e `typecheck` no `package.json` (veja CLAUDE.md → Comandos).
- Docker rodando (ou `npm` no PATH). Sem nenhum dos dois, o commit é bloqueado com uma mensagem clara.

## Testar manualmente

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"git commit -m teste"}}' \
  | CLAUDE_PROJECT_DIR="$PWD" bash .claude/hooks/pre-commit-check.sh; echo "exit $?"
```

## Escopo

Este hook só vale para commits feitos **pelo Claude Code**. Para cobrir commits
manuais também, a rede de segurança é o CI (GitHub Actions rodando o mesmo
lint/typecheck em cada PR). Opcionalmente, use um git hook local (ex.: husky
em cada app).
