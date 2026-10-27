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

## Fornecedores externos: portas e adaptadores

Nenhum fornecedor externo aparece no domínio. Cada um é uma **porta** (interface no módulo
que a usa) com **adapters** escolhidos por variável de ambiente; trocar de fornecedor é
escrever um adapter novo e mudar a configuração, sem migration e sem mexer em regra de negócio.

| Porta | Uso | Adapters | Status |
|---|---|---|---|
| `MailSender` | e-mails do outbox | `LogMailSender` (dev), `ResendMailSender` | implementada |
| `WhatsAppSender` | aniversários e campanhas (com consentimento) | log (dev) + adapter do provedor escolhido | fase 2; provedor **[PENDENTE]** |
| `PaymentGateway` | cobrança online, reembolso e webhooks | `MercadoPagoGateway` (inicial) + fake para testes; outros gateways (Asaas, Stripe…) entram como adapters novos | fase 3 |
| `ObjectStorage` | logos da identidade visual (e futuros anexos) | `LocalDiskStorage` (dev e VPS com volume; `STORAGE_LOCAL_DIR`); S3-compatível depois | implementada (`common/storage`) |
| `LlmProvider` | assistente de IA | `ClaudeProvider` (inicial, API da Anthropic) + fake para testes; outro provedor = adapter novo + `LLM_PROVIDER` | fase 4 |

Regras para portas novas:
- A interface fala a língua do domínio (`createCharge`, `parseWebhook`), não a do fornecedor. Tipos do SDK não vazam para fora do adapter.
- IDs externos são gravados com o nome do provedor (`provider`, `externalId`), para conviver com dois provedores durante uma migração.
- Efeito externo disparado por mudança de estado sai pelo outbox (AFA 12). Webhook entra por rota própria, verifica assinatura no adapter e é idempotente pelo ID do evento.
- Todo adapter tem timeout e é coberto por teste com o fake; o adapter real tem teste de contrato isolado.

## Deploy (Hostinger VPS, sem acoplamento)

- **Destino inicial:** VPS da Hostinger rodando Docker Compose de produção: Postgres, API, web e um proxy reverso com HTTPS automático (Caddy). É a mesma topologia do desenvolvimento, com imagens de produção (build multi-stage, `node:24-alpine`, usuário não-root).
- **Nada específico da Hostinger no código ou nas imagens.** Toda configuração vem de variáveis de ambiente validadas na inicialização; o compose de produção e os scripts de deploy ficam em `deploy/`. Mudar para outro provedor (outra VPS, Fly, Render, AWS) é rodar as mesmas imagens em outro lugar.
- **Migrations** rodam como passo separado do deploy (`prisma migrate deploy`) com o usuário de migração, nunca com `tanaregua_app`.
- **Pipeline:** o CI publica as imagens num registry (GHCR); o deploy na VPS faz `pull` + `migrate` + `up -d` por SSH. Rollback = subir a tag anterior.
- **Domínio próprio da barbearia:** o Caddy emite certificado sob demanda (on-demand TLS) só para domínios que a API confirma estarem cadastrados e verificados (endpoint interno `ask`); o frontend resolve o `Host` para o slug da barbearia. Sem essa checagem, qualquer domínio apontado para a VPS geraria certificado.
- **Dados:** backup diário criptografado do Postgres para fora da VPS (storage S3-compatível), com teste de restore. Volume do `ObjectStorage` local também entra no backup.

## Assistente de IA (fase 4, desenho previsto)

- Módulo `assistant` no monólito. O modelo recebe a conversa e uma lista de **ferramentas** (tool use) que são casos de uso já existentes (`createProduct`, `listAppointments`…), cada uma com schema Zod de entrada e a **mesma permissão** da rota equivalente.
- As ferramentas chamam os services de domínio dentro de `TenantDb.run` com o contexto do usuário logado: RLS, permissões e regras valem igual. Não existe ferramenta de SQL livre.
- Ferramentas de escrita não executam direto: geram um **plano** (prévia) que o usuário confirma no chat; só a confirmação executa, com `Idempotency-Key`.
- Arquivos enviados (Excel, CSV) são lidos no backend por parsers determinísticos; o modelo vê o conteúdo como **dado**, nunca como instrução (risco de prompt injection, ver `security.md`).
- Cada execução fica em uma tabela de auditoria por tenant (pedido, plano, confirmação, resultado).
- **Independente do provedor:** conversa, ferramentas (Zod → JSON Schema) e resultados ficam num formato próprio do módulo; só o adapter traduz para a API do provedor (tool use do Claude, function calling de outro). Trocar de provedor não muda ferramentas nem telas; os testes rodam contra o adapter fake.

## Frontend

- `/painel/*`: client-side (React Query sobre o cliente tipado). A sessão é reconstruída pelo cookie de refresh no `PanelShell`. As páginas exportam `instant = false`, porque são bloqueadas por sessão (validação de navegação instantânea do Next 16.3+).
- `/[slug]`: Server Component com `'use cache'` (minutos) para os dados públicos; a disponibilidade e a reserva rodam no cliente, sem cache.
- `proxy.ts` só redireciona quem não tem cookie (UX). A API revalida tudo.
- **Identidade visual:** a API guarda só as cores escolhidas (hex) e o logo; quem deriva o tema é `lib/brand.ts` (função pura e testada), que ajusta as cores até o contraste AA e gera um `<style>` com os tokens no `:root` (vale também para diálogos em portal). Os tokens base em hex ali espelham o `globals.css`: mudou o tema, atualize os dois. O logo é servido pela API em `/v1/public/{slug}/logo?v=<versão>`.
- **Duas sessões independentes no navegador** (ver `security.md`): `sessionStore` (painel) e `clientSessionStore` (agendamento online), em `lib/session/session-store.ts`. O cliente da API escolhe o token pela rota: `/v1/public/...` usa a sessão do cliente, o resto usa a do painel, e cada uma se renova pelo seu cookie (`refreshSession('panel' | 'client')`). Unificar as duas fazia o F5 do painel cair na página da barbearia quando o dono entrava como cliente no mesmo navegador (teste `e2e/sessions.spec.ts`).

## AFAs do Z3t@ no MVP

| Aplicadas | Como |
|---|---|
| 01 Composable / 02 DDD | módulos por domínio, DI, agregados `Appointment` e `Order` com invariantes |
| 05 API-first | contrato OpenAPI versionado + cliente gerado + checagem no CI |
| 06 SaaS abstraction | portas e adaptadores para todo fornecedor externo (e-mail, pagamento, storage, IA) e deploy em containers sem dependência do provedor |
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
- Não importar SDK de fornecedor (gateway, storage, IA, e-mail) fora do adapter, nem colocar configuração específica da Hostinger no código.
- Não dar ao assistente de IA ferramenta que contorne services, permissões ou confirmação de escrita.
