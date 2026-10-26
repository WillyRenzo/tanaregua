# Arquitetura

Decisões que sessões futuras não devem desfazer sem conversar. Referências apontam
para o código real.

## Visão geral

```
Browser ──► frontend (Next.js 16) ──/api/* (rewrite)──► backend (NestJS 12) ──► PostgreSQL 18
            painel (client-side)                         única dona dos dados     RLS por tenant
            /[slug] público (SSR)  ──API_INTERNAL_URL──►                          outbox_events
```

- **Monólito modular, não microsserviços.** Cada bounded context é um módulo NestJS em `backend/src/modules/` (auth, barbershops, staff, clients, catalog, appointments, public-booking, orders, finance, reports, notifications). Módulos se falam só pelos services exportados; nenhum lê tabela de outro domínio (ex.: relatórios pedem nomes ao `StaffService.names`, não fazem join em `users`).
- **O backend é a única porta para os dados.** O Next nunca acessa o banco. O browser chama `/api/...`, que o Next reescreve para o NestJS no mesmo domínio (`frontend/next.config.ts`), então o cookie de refresh é first-party e `SameSite=Strict`.
- **Contrato único (AFA 05).** Schemas Zod validam a entrada (`@Body({ schema })`) e descrevem a saída (`@ApiResult(schema)`). Os tipos dos services são `z.infer` desses schemas, então código e documentação não divergem. `npm run openapi:export` gera `backend/contracts/openapi.json`, e o frontend gera `src/lib/api/schema.d.ts` dele. O CI barra quando algum dos dois está desatualizado.

## Multi-tenancy (risco nº 1)

| Camada | Onde | O quê |
|---|---|---|
| Token | `common/auth/access.guard.ts` | `barbershopId` sai do JWT para o CLS; nunca do input |
| Aplicação | `common/tenancy/tenant-db.service.ts` | `TenantDb.run(fn)` abre transação com o tenant; services ainda filtram por `barbershopId` |
| Banco (RLS) | migrations + `prisma.service.ts` (`setDbContext`) | `set_config('app.current_tenant', id, true)` na transação; policies fail-closed |
| Banco (FK) | FKs compostas `(barbershop_id, x_id)` | checagem de FK ignora RLS; só a FK composta impede apontar para outro tenant |

- Tabelas sem RLS de propósito: `barbershops` (lida por slug), `users` e `refresh_tokens` (identidade global), `idempotency_keys` (escopo por usuário), `outbox_events` (worker de todos os tenants; payload só com IDs).
- `memberships` tem policy extra por `app.current_user`, para o login enxergar os vínculos antes de escolher o tenant.
- O usuário da aplicação (`tanaregua_app`) não é dono das tabelas. Os grants dele vivem na migration `*_app_role_grants`, porque resets e restores recriam o schema e levariam grants de bootstrap junto.

## Regras críticas garantidas pelo banco

| Regra | Mecanismo | Arquivo |
|---|---|---|
| Sem conflito de horário (com buffer) | `EXCLUDE USING gist` em `tstzrange(starts_at, blocked_until)` parcial por status | migration `*_agenda` |
| Comanda fechada imutável | triggers `order_items_guard` e `orders_guard` | migration `*_orders_finance` |
| Lançamentos append-only | `REVOKE UPDATE, DELETE` do usuário da app | migrations `*_orders_finance` e `*_app_role_grants` |
| Uma regra de comissão por alvo | índice único `NULLS NOT DISTINCT` | migration `*_staff_clients_catalog` |

A aplicação pré-valida só para dar mensagem amigável. Sob concorrência, o banco decide (há testes e2e com requisições simultâneas).

## Fluxos não óbvios

- **Fechar comanda** (`orders.service.ts#close`): `SELECT … FOR UPDATE` na comanda, depois congela a comissão em cada item (snapshot), muda o status para CLOSED, lança caixa e comissões (`FinanceService.recordSale`) e conclui o agendamento. Tudo numa transação.
- **E-mails** (AFA 12): a mudança e o evento (`outbox_events`) são gravados na mesma transação. `OutboxProcessor` reivindica lotes com `FOR UPDATE SKIP LOCKED` (seguro com várias instâncias), envia fora da transação, faz retry com backoff exponencial e, após 5 tentativas, move para FAILED (dead letter). O ID do evento vai como `Idempotency-Key` ao provedor, então reenvio não duplica o e-mail.
- **Idempotência de POST** (`common/idempotency`): agendar e fechar comanda aceitam `Idempotency-Key`. A mesma chave devolve a resposta original; a mesma chave com outro corpo dá 422.
- **Fuso:** tudo em UTC no banco; dia, expediente e grade são calculados no fuso da barbearia (`appointments/availability.ts`, função pura testada inclusive com horário de verão).

## Frontend

- `/painel/*`: client-side (React Query sobre o cliente tipado). A sessão é reconstruída pelo cookie de refresh no `PanelShell`. As páginas exportam `instant = false`, porque são bloqueadas por sessão (validação de navegação instantânea do Next 16.3+).
- `/[slug]`: Server Component com `'use cache'` (minutos) para os dados públicos; a disponibilidade e a reserva rodam no cliente, sem cache.
- `proxy.ts` só redireciona quem não tem cookie (UX). A API revalida tudo.

## AFAs do Z3t@ no MVP

| Aplicadas | Como |
|---|---|
| 01 Composable / 02 DDD | módulos por domínio, DI, agregados `Appointment` e `Order` com invariantes |
| 05 API-first | contrato OpenAPI versionado + cliente gerado + checagem no CI |
| 06 SaaS abstraction | `MailSender` (Log/Resend); gateway de pagamento seguirá o mesmo padrão |
| 09 Zero-trust | guard global deny-by-default, permissões, RLS, menor privilégio no banco |
| 12 Event-driven | outbox transacional, consumidor idempotente, dead letter |
| 14 Resiliência | timeout em chamada externa, retry com backoff no outbox (sem circuit breaker: só há um fornecedor externo) |
| 18 Observabilidade | pino com correlation id, OpenTelemetry opcional (`node --import dist/telemetry.js`), `/health/live` e `/health/ready` |
| 19 Testes | Testcontainers, gate de cobertura 80/70, Playwright, testes de falha e concorrência |
| 20 Privacidade | PII anotada no schema, mascarada em logs, consentimento e anonimização |

**Adiadas (YAGNI):** 03 micro-frontends, 04 BFF separado, 07 data product, 10 strangler, 13 saga, 15 cache distribuído, 16 GraphQL, 17 CQRS, 21 MCP, Kubernetes. Reavaliar quando houver mais de um serviço ou time.

## O que NÃO fazer

- Não acessar o banco a partir do Next.js.
- Não fazer query de modelo com tenant fora de `TenantDb`/`withContext`.
- Não usar `Promise.all` dentro de uma transação Prisma: é tudo a mesma conexão, então não há ganho, e gera warning de depreciação no `pg`.
- Não usar `prisma db push`, e não deixar FK/índice criado à mão fora do `schema.prisma` (a próxima migration o apagaria; ver `.claude/rules/database.md`).
- Não editar ou apagar comanda fechada; não dar UPDATE/DELETE em lançamentos.
