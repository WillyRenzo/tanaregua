# Produtividade e Ferramentas

Dev solo, Windows + Docker Desktop, repositório no GitHub, CI no GitHub Actions.

## Docker (o Node não é instalado no host)

```
docker compose up -d                       # Postgres (:5432) + API (:3333) + web (:3000)
docker compose logs -f backend             # logs da API (pino, legível em dev)
docker compose run --rm --no-deps backend npm run <script>
docker compose run --rm --no-deps frontend npm run <script>
docker compose down                        # para (dados ficam no volume)
docker compose down -v                     # para e APAGA o banco local (bootstrap roda de novo)
```

- No **Git Bash**, prefixe os comandos com `MSYS_NO_PATHCONV=1`; sem isso ele reescreve caminhos como `/app` e `/var/run/docker.sock`.
- `docker compose run` **recria dependências** cuja configuração mudou (por exemplo, o backend com outra variável de ambiente). Para comandos avulsos use `--no-deps`.
- Swagger UI em dev: http://localhost:3333/docs.

## Hot reload no Windows

- **Backend:** funciona. O watch do TypeScript usa polling (`TSC_WATCHFILE`/`TSC_WATCHDIRECTORY` no compose), porque o bind mount do Windows não propaga eventos de arquivo.
- **Frontend:** o Turbopack (bundler padrão do Next 16) **não tem modo polling**, então mudanças salvas no Windows não aparecem até `docker compose restart frontend`. Saídas, em ordem de preferência:
  1. Manter o repositório dentro do sistema de arquivos do WSL2 (`\\wsl$\...`): eventos nativos, hot reload normal e I/O mais rápido.
  2. Rodar o dev com webpack (`next dev --webpack` + `WATCHPACK_POLLING=true`), aceitando que o bundler de dev será diferente do de build.
- **Arquivo novo importado no frontend** é o caso mais traiçoeiro: o dev server não vê o arquivo, responde `Module not found` e devolve 500 em **todas** as rotas, não só na que mudou. No Playwright, isso aparece como timeout em todos os testes, inclusive nos que não têm relação com a mudança. Antes de concluir que o código quebrou, confira `docker compose logs frontend` e rode `docker compose restart frontend`.

## Prisma CLI (dentro do container do backend)

```
npx prisma migrate deploy        # aplica migrations pendentes
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
                                 # gera o SQL de uma migration nova (ver .claude/rules/database.md)
npx prisma studio                # GUI (exponha a porta 5555 se for usar)
npm run db:generate              # regenera o client
```

## Testes

- Backend e2e: Testcontainers sobe um Postgres efêmero via o Docker do host (socket montado no container). Nada compartilhado entre execuções.
- Frontend E2E: `RATE_LIMIT_ENABLED=false docker compose up -d backend frontend` e depois `docker compose --profile e2e run --rm --no-deps e2e`. No Windows, se o frontend ganhou arquivo novo, rode `docker compose restart frontend` antes (ver "Hot reload no Windows"). Ao terminar, `docker compose up -d backend` religa o rate limit. A imagem oficial do Playwright tem a mesma versão do `@playwright/test`; ao atualizar um, atualize o outro. Relatório em `frontend/playwright-report/`.
- O dev server do Next só serve `/_next/*` para origens liberadas; `frontend` (o host visto pelo container de E2E) está em `allowedDevOrigins`.

## GitHub CLI (`gh`)

```
gh pr create --fill              # abre PR a partir da branch atual
gh pr checks --watch             # acompanha o CI do PR
gh run view --log-failed         # log só dos jobs que falharam
```

## CI (`.github/workflows/ci.yml`)

- **backend:** npm ci → prisma generate → format → lint → typecheck → testes com cobertura (Testcontainers) → build → contrato OpenAPI em dia.
- **frontend:** npm ci → cliente da API em dia com o contrato → format → lint → typecheck → testes → build.
- Ainda **não** roda o Playwright (precisa da stack completa). Próximo passo natural: um job que suba o compose.

## Claude Code neste projeto

- O hook em `.claude/settings.json` bloqueia `git commit` se lint/typecheck falharem (roda via Docker). Veja `.claude/hooks/README.md`.
- Use Plan Mode antes de mexer em migrations, auth, RLS ou no fechamento de comanda.
