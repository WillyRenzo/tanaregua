# Contexto do Projeto

TaNaRegua é um SaaS multi-tenant de gestão completa para barbearias e salões:
agenda integrada, comandas, financeiro, comissões e salários, estoque, pacotes
de serviços, aniversários de clientes, relatórios e agendamento online pelo
cliente final. Projeto paralelo de dev solo, com foco em preço acessível para
pequenos negócios. O MVP (agenda, agendamento online, comanda, comissões, caixa,
relatórios) está implementado. Fase 2: estoque, pacotes, aniversários, identidade
visual por barbearia, reagendamento pelo cliente e faltas sem justificativa. Fase 3:
pagamento online, salários e relatórios avançados. Fase 4: assistente de IA que executa
tarefas no sistema. Modelo de negócio: assinatura paga por barbearia, com vários planos
(o básico cobre as fases 1 e 2; o mais completo inclui o assistente de IA). Roadmap em
`agent_docs/mvp-plan.md`.

# Stack

- **Node.js 24 LTS rodando em Docker** (`node:24-alpine`); não há Node no host. Migrar para o Node 26 (LTS desde 28/10/2026) é uma troca de imagem.
- **TypeScript** em modo `strict` nos dois apps
- **Backend:** NestJS 12 (ESM, Vitest, oxlint) em `backend/`; validação com Zod via Standard Schema
- **Frontend:** Next.js 16.4 (App Router, Cache Components, Turbopack), React 19.3, Tailwind 4 + shadcn/ui (Radix) em `frontend/`
- **Banco:** PostgreSQL 18 + Prisma ORM **7.10** (driver adapter `@prisma/adapter-pg`). A tag `latest` do npm aponta para o Prisma 8 RC: não atualize sem decisão explícita.
- **Auth:** JWT próprio no NestJS (access token de 15 min + refresh token rotativo em cookie httpOnly)
- **npm** com `.npmrc` de supply chain (`ignore-scripts`, `min-release-age=3`) em cada app
- **CI:** GitHub Actions (`.github/workflows/ci.yml`) · **Deploy:** VPS da Hostinger com Docker Compose, sem acoplamento ao provedor (`agent_docs/architecture.md`)
- **Fornecedores externos** (e-mail, pagamento, storage, IA) só por portas e adaptadores; nada de SDK fora do adapter

# Comandos

O Node roda nos containers do `docker-compose.yml`. Rode da raiz do repositório.
Atalho usado abaixo: `be` = `docker compose run --rm --no-deps backend`,
`fe` = `docker compose run --rm --no-deps frontend` (no Git Bash, prefixe com
`MSYS_NO_PATHCONV=1`).

```
# Subir tudo (Postgres + API em :3333 + web em :3000)
docker compose up -d

# Instalar dependências
be npm ci && be npm run db:generate
fe npm ci

# Migrations (criar: ver .claude/rules/database.md — migrate dev é interativo)
be npx prisma migrate deploy

# Dados de demonstração: uma conta por papel; numa demo existente, só acrescenta módulos novos (README)
be npm run db:seed

# Testes
be npm test                    # unitários (Vitest)
be npm run test:e2e            # e2e com Postgres real via Testcontainers
be npm run test:cov            # unitários + e2e com gate de cobertura (80% linhas / 70% branches)
fe npm test                    # unitários (Vitest + Testing Library)

# E2E do frontend (Playwright, desktop + mobile + axe WCAG) contra a stack rodando
RATE_LIMIT_ENABLED=false docker compose up -d backend frontend
docker compose --profile e2e run --rm --no-deps e2e

# Lint + typecheck (o mesmo que o hook roda antes de cada commit)
be npm run lint && be npm run typecheck && be npm run format:check
fe npm run lint && fe npm run typecheck && fe npm run format:check

# Contrato da API: exporta o OpenAPI e regenera o cliente tipado do frontend
be npm run openapi:export && fe npm run api:generate

# Build
be npm run build
fe npx next build
```

# Estrutura de Arquivos

```
backend/src/modules/      um módulo NestJS por domínio (auth, staff, clients, catalog, appointments, orders, finance…)
backend/src/common/       guard global, tenancy (TenantDb/RLS), Problem Details, idempotência, OpenAPI
backend/prisma/           schema.prisma, migrations (com SQL manual de RLS/constraints), bootstrap/roles.sql
backend/contracts/        openapi.json versionado (fonte do cliente tipado do frontend)
backend/test/             e2e (Testcontainers) e helpers (expectTenantIsolation)
frontend/src/app/painel/  painel da barbearia (client-side, protegido por sessão)
frontend/src/app/[slug]/  página pública de agendamento de cada barbearia (SSR)
frontend/src/lib/         cliente da API (gerado), sessão, queries React Query, formatação
frontend/e2e/             Playwright
agent_docs/               contexto aprofundado (regras de negócio, segurança, arquitetura…)
.claude/                  settings.json (hooks), hooks/, rules/ com escopo por caminho
```

# Regras de Trabalho

- Antes de considerar uma tarefa pronta, rode lint, typecheck e testes do app que você alterou.
- Bug fix começa com um teste que falha e reproduz o bug.
- Toda tabela que pertence a um tenant precisa de `barbershopId`, de uma policy RLS, de FKs compostas `(barbershop_id, …)` e de um teste e2e com `expectTenantIsolation`.
- Mudanças de schema só entram via migration. Nunca edite uma migration já aplicada fora do seu banco local.
- Dinheiro é sempre inteiro em centavos (`Int`); percentuais em basis points. Nunca use float.
- Mudou rota ou resposta da API? Rode `openapi:export` e `api:generate` e commite os dois arquivos (o CI barra a divergência).
- NestJS 12, Next.js 16 e Prisma 7/8 mudaram APIs recentemente: consulte a doc oficial atual antes de usar um padrão que você só conhece de memória.
- Commits seguem Conventional Commits e são atômicos: uma mudança lógica por commit, cada um passando em lint, typecheck e testes (veja `.claude/rules/general.md`).
- Todo módulo novo entra no seed de desenvolvimento: no seed completo (`seedDemo`) e no complemento de uma demo existente (`completeDemo`, que só acrescenta o que falta e nunca sobrescreve personalização), com teste em `backend/test/demo-seed.e2e-spec.ts`.
- Recurso que depende de plano (fase 3 em diante) é verificado na API por recurso, nunca por nome de plano (`business-rules.md` §12).

# Contexto Aprofundado

Carregados sempre (crítico em qualquer tarefa):

- Regras de negócio e domínio: @agent_docs/business-rules.md
- Segurança: @agent_docs/security.md

Leia quando a tarefa pedir:

- Arquitetura e decisões de design: `agent_docs/architecture.md`
- Padrões de engenharia e filosofia de qualidade: `agent_docs/engineering-standards.md`
- Princípios arquiteturais (AFAs) e persona Z3t@: `agent_docs/z3t@-global-context.md` (mapa do que se aplica ao MVP em `architecture.md`)
- Ferramentas, Docker e fluxos (gh, Prisma CLI, CI, hot reload): `agent_docs/productivity.md`
- Convenções por área (backend/frontend/banco): `.claude/rules/` (carregam sozinhas pelo caminho do arquivo)

# Mantendo Este Arquivo Atual

Este é um sistema vivo, não um artefato de setup que se usa uma vez. Se durante
o trabalho real aparecer algo que deveria virar regra permanente (uma regra de
negócio, uma restrição de segurança, uma decisão de arquitetura, um erro que
não pode se repetir), não aplique em silêncio: pergunte se deve ser
documentado e coloque no arquivo certo acima, não aqui. Se você errar porque
faltava uma regra, isso é sinal de que a documentação precisa ser atualizada.
Diga isso.

# Idioma das Respostas

Always respond in Brazilian Portuguese, regardless of the language used in the prompt.
