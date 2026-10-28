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
| Uma regra de comissão por alvo | índice único `NULLS NOT DISTINCT` (membro, serviço, produto) | migrations `*_staff_clients_catalog` e `*_products_and_stock` |
| Estoque nunca negativo | CHECK `stock_quantity >= 0`; o saldo só muda pelo trigger `apply_stock_movement` (SECURITY DEFINER) ao inserir movimentação | migration `*_products_and_stock` |
| Saldo = soma das movimentações | app sem UPDATE em `products.stock_quantity` (grant só nas outras colunas) e sem UPDATE/DELETE em `stock_movements` | migration `*_products_and_stock` |
| Item de comanda é serviço (com profissional), produto ou pacote (quantidade 1) | CHECK `order_items_kind_check` | migrations `*_products_and_stock` e `*_service_packages` |
| Saldo de pacote nunca negativo nem acima do comprado | CHECK `remaining BETWEEN 0 AND initial_quantity`; o saldo só muda pelo trigger `apply_package_movement` (SECURITY DEFINER) ao inserir movimentação | migration `*_service_packages` |
| Saldo de pacote = soma das movimentações | app sem UPDATE/DELETE em `client_package_balances` e `package_movements`, sem DELETE em `client_packages` | migration `*_service_packages` |
| Sessão de pacote é R$ 0 e a comissão não passa do valor da sessão | CHECKs `order_items_values_check` e `order_items_commission_check` | migration `*_service_packages` |
| Reembolso até o valor pago | CHECK em `client_packages` (e REFUNDED ⇔ data de reembolso) | migration `*_service_packages` |
| Uma mensagem de aniversário por cliente por ano | índice único `marketing_messages_birthday_key` e CHECK `marketing_messages_kind_check` | migration `*_birthdays_and_campaigns` |
| Campanha imutável e histórico de envios preservado | app sem UPDATE/DELETE em `campaigns` e sem DELETE em `marketing_messages` | migration `*_birthdays_and_campaigns` |

A aplicação pré-valida só para dar mensagem amigável. Sob concorrência, o banco decide (há testes e2e com requisições simultâneas).

## Fluxos não óbvios

- **Fechar comanda** (`orders.service.ts#close`): `SELECT … FOR UPDATE` na comanda, baixa dos produtos (`ProductsService.recordSale`: trava os produtos em ordem de id para não haver deadlock entre fechamentos, confere o saldo e lança as vendas), depois congela a comissão em cada item (snapshot), muda o status para CLOSED, lança caixa e comissões (`FinanceService.recordSale`) e conclui o agendamento. Tudo numa transação. O estorno devolve os produtos com `SALE_REVERSAL` ao mesmo custo da venda.
- **Pacotes no fechamento** (`PackagesService`): depois da baixa de produtos, `recordUses` trava os `client_packages` usados (`FOR UPDATE`, em ordem de id; os saldos não podem ser travados porque o app não tem UPDATE neles), confere validade e saldo e lança `USE`; depois `recordPurchases` cria o pacote do cliente, os saldos e as movimentações `PURCHASE`. A comissão da sessão usa o valor congelado da sessão como base. No estorno, `reverseForOrder` recusa antes de qualquer escrita (pacote reembolsado ou já usado) e lança `USE_REVERSAL`.
- **E-mails** (AFA 12): a mudança e o evento (`outbox_events`) são gravados na mesma transação. `OutboxProcessor` reivindica lotes com `FOR UPDATE SKIP LOCKED` (seguro com várias instâncias), envia fora da transação, faz retry com backoff exponencial e, após 5 tentativas, move para FAILED (dead letter). O ID do evento vai como `Idempotency-Key` ao provedor, então reenvio não duplica o e-mail.
- **Aniversários e campanhas** (`modules/marketing`): cada destinatário vira uma linha em `marketing_messages` e um evento `MarketingMessageQueued` no outbox, na mesma transação. O worker não conhece o marketing: o módulo registra o próprio consumidor em `OutboxHandlers` (com `onDeadLetter`, que marca a mensagem FAILED). Na entrega, o consentimento é conferido de novo e o envio acontece fora da transação. O job de aniversário (`BirthdaysService`, a cada 10 min) lê as barbearias com a mensagem ligada (tabela sem RLS), abre a transação de cada uma e enfileira com `createManyAndReturn(skipDuplicates)`: o índice único `(barbershop_id, client_id, birthday_year)` impede a segunda mensagem do ano, mesmo com várias instâncias. E-mail não duplica (ID da mensagem como `Idempotency-Key`); a Cloud API do WhatsApp não tem chave de idempotência, então uma queda entre o envio e a gravação do status pode repetir a mensagem (entrega "ao menos uma vez").
- **Idempotência de POST** (`common/idempotency`): agendar e fechar comanda aceitam `Idempotency-Key`. A mesma chave devolve a resposta original; a mesma chave com outro corpo dá 422.
- **Fuso:** tudo em UTC no banco; dia, expediente e grade são calculados no fuso da barbearia (`appointments/availability.ts`, função pura testada inclusive com horário de verão).

## Fornecedores externos: portas e adaptadores

Nenhum fornecedor externo aparece no domínio. Cada um é uma **porta** (interface no módulo
que a usa) com **adapters** escolhidos por variável de ambiente; trocar de fornecedor é
escrever um adapter novo e mudar a configuração, sem migration e sem mexer em regra de negócio.

| Porta | Uso | Adapters | Status |
|---|---|---|---|
| `MailSender` | e-mails do outbox | `LogMailSender` (dev), `ResendMailSender` | implementada |
| `WhatsAppSender` | aniversários e campanhas (com consentimento), só por modelo aprovado | `LogWhatsAppSender` (dev e testes), `MetaWhatsAppSender` (Cloud API via HTTP, sem SDK); `WHATSAPP_PROVIDER` e `META_GRAPH_API_VERSION` | implementada (`marketing/whatsapp`) |
| `PaymentGateway` | cobrança online, reembolso, **assinatura recorrente do TaNaRegua** e webhooks | `MercadoPagoGateway` (inicial) + fake para testes; outros gateways (Asaas, Stripe…) entram como adapters novos | fase 3 |
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
- **Migrations** rodam como passo separado do deploy (`prisma migrate deploy`) com o usuário de migração, nunca com `tanaregua_app`. Ficam numa imagem própria (`tanaregua-migrate`, alvo `migrate` do `backend/Dockerfile`), com o CLI e o schema engine baixados no build.
- **Compatibilidade entre versões (expand/contract):** o rollback troca o código, mas não desfaz migrations. Toda migration precisa funcionar com o código da versão anterior. Para remover ou renomear uma coluna:
  1. a versão N adiciona a coluna nova e para de usar a antiga;
  2. a versão N+1 remove a antiga.
- **Pipeline:**
  - O job `images` do CI, só no `main` e depois dos testes, publica `tanaregua-backend`, `tanaregua-migrate` e `tanaregua-frontend` no GHCR, com a tag igual ao SHA do commit.
  - O deploy é manual (workflow **Deploy**): copia `deploy/` daquele commit para a VPS por SSH e roda `deploy.sh <sha>`, que faz `pull` + `migrate` + `up -d --wait`.
  - Rollback = rodar o Deploy com o SHA anterior.
  - Runbook em `deploy/README.md`.
- **Topologia na VPS:**
  - O Caddy é o único serviço com portas publicadas (80/443).
  - `/api/*` vai direto ao NestJS, e o resto vai ao Next (o rewrite `/api` do Next só é usado em desenvolvimento).
  - API, web e Postgres ficam só na rede interna. Se a API fosse alcançável direto, o `X-Forwarded-For` poderia ser forjado.
  - O Next standalone congela o `next.config` no build: `API_INTERNAL_URL` entra como argumento do build da imagem.
- **Rate limit atrás do proxy:**
  - O Caddy descarta o `X-Forwarded-For` recebido de fora e grava o IP do visitante. Por isso, em produção, `TRUST_PROXY_HOPS=1`, e a API recusa subir com 0.
  - As chamadas SSR do Next saem todas do mesmo IP. Elas se identificam com `INTERNAL_API_TOKEN` (cabeçalho `x-internal-token`, que o Caddy remove das requisições externas) e ficam fora do limite por IP (`common/http/internal-request.ts`).
- **Baseline de performance (28/10/2026):** dados da demo (14 atendimentos no dia), 40 requisições sequenciais na stack de desenvolvimento. A agenda do dia e a disponibilidade (painel e pública) ficam em ~11 ms no p50 e ~15 ms no p95. Use esses números para comparar quando a agenda crescer.
- **Domínio próprio da barbearia:** o Caddy emite certificado sob demanda (on-demand TLS) só para domínios que a API confirma estarem cadastrados e verificados (endpoint interno `ask`); o frontend resolve o `Host` para o slug da barbearia. Sem essa checagem, qualquer domínio apontado para a VPS geraria certificado.
- **Dados:**
  - Backup diário do Postgres para fora da VPS, num storage S3-compatível. O volume do `ObjectStorage` local (logos) entra no mesmo arquivo.
  - O serviço `backup` (`deploy/backup/`) junta o `pg_dump` (formato custom) com os logos, cifra com a **chave pública** age e envia com rclone. A retenção é configurável.
  - A chave privada fica fora da VPS: quem invadir o servidor não lê os backups.
  - A restauração (`restore.sh`) foi ensaiada num banco vazio: contagens, RLS e privilégios do `tanaregua_app` conferidos. O ensaio deve ser repetido a cada trimestre (runbook).

## Assistente de IA (fase 4, desenho previsto)

- Módulo `assistant` no monólito. O modelo recebe a conversa e uma lista de **ferramentas** (tool use) que são casos de uso já existentes (`createProduct`, `listAppointments`…), cada uma com schema Zod de entrada e a **mesma permissão** da rota equivalente.
- As ferramentas chamam os services de domínio dentro de `TenantDb.run` com o contexto do usuário logado: RLS, permissões e regras valem igual. Não existe ferramenta de SQL livre.
- Ferramentas de escrita não executam direto: geram um **plano** (prévia) que o usuário confirma no chat; só a confirmação executa, com `Idempotency-Key`.
- Arquivos enviados (Excel, CSV) são lidos no backend por parsers determinísticos; o modelo vê o conteúdo como **dado**, nunca como instrução (risco de prompt injection, ver `security.md`).
- Cada execução fica em uma tabela de auditoria por tenant (pedido, plano, confirmação, resultado).
- **Independente do provedor:** conversa, ferramentas (Zod → JSON Schema) e resultados ficam num formato próprio do módulo; só o adapter traduz para a API do provedor (tool use do Claude, function calling de outro). Trocar de provedor não muda ferramentas nem telas; os testes rodam contra o adapter fake.

## Assinatura e planos (regras em business-rules §12)

O mesmo princípio das permissões: **o código checa recursos, nunca nomes de plano**.
Implementado: catálogo, planos, assinatura e verificação (módulo `subscriptions`), preços e
administração da plataforma (módulo `platform`). A cobrança e o ciclo de vida da assinatura
entram nas próximas entregas.

- **Catálogo de recursos em código** (`FEATURES` em `subscriptions/features.ts`, como `PERMISSIONS` em `auth/permissions.ts`): uma chave por capacidade vendável (`online-payment`, `payroll`, `advanced-reports`, `assistant`). O núcleo das fases 1 e 2 vale em todo plano e não tem chave própria. Chave desconhecida gravada num plano é ignorada.
- **Planos no banco**, catálogo global (sem tenant e sem RLS): `plans` com chave, nome, lista de recursos, ordem de exibição e o plano padrão (no máximo um, por exclusion constraint). A aplicação **só lê** (`REVOKE INSERT, UPDATE, DELETE`); plano novo ou mudança de recursos ainda vem por migration. Limites entram quando forem decididos.
- **Preços** em `plan_prices` (um por plano e ciclo `MONTHLY`/`YEARLY`, centavos, CHECK > 0, quem mudou e quando). Sem linha, o plano não é vendido no ciclo. Leitura livre (o painel mostra os preços em `GET /v1/plans`); escrita só pelo `SubscriptionsService.setPlanPrices`, numa transação com `platformAdminId` no contexto, que é o que o RLS da tabela exige.
- **Assinatura por barbearia**: `subscriptions` (uma por tenant, com RLS) com plano e status (`TRIALING`, `ACTIVE`, `PAST_DUE`, `CANCELED`). O cadastro da barbearia cria a assinatura no plano padrão na mesma transação. A aplicação não tem `DELETE`: trocar de plano nunca apaga nada. Na cobrança entram fim do período, `provider`, `externalId` e a tabela de eventos do gateway com unique no ID do evento (idempotência).
- **Troca de plano** só por `SubscriptionsService.changePlan`, que nenhuma rota da barbearia chama: hoje só o seed, depois a confirmação do gateway (webhook verificado).
- **Verificação na API**: `@RequiresFeature('assistant')` (`common/auth/requires-feature.ts`) + `FeatureGuard` global depois do `AccessGuard`, que lê os recursos da assinatura a cada rota que exige um (uma consulta por chave única; cache só se a medição pedir). Fora do plano: 403 com `type` `plan-upgrade-required`. Acesso efetivo = permissão **e** recurso. Só em rota autenticada: o tenant vem do token. O OpenAPI mostra o recurso na descrição da rota, e o teste do contrato exige isso.
- **Plano não vai no JWT**: muda com pagamento a qualquer momento e o token vive 15 min. O perfil da sessão (`/v1/auth/me`, login, refresh) devolve `subscription` com o plano, o status e os recursos liberados; `GET /v1/plans` lista os planos com os recursos. No painel, `hasFeature()` e `<FeatureGate>` decidem entre mostrar o recurso e o convite "disponível no plano X"; a API revalida sempre.
- **Cobrança** pela porta `PaymentGateway` (assinatura recorrente no Mercado Pago como adapter inicial). Webhook verificado → atualiza a assinatura → efeitos (e-mail de cobrança, aviso de inadimplência) saem pelo outbox.
- **Administração da plataforma** (módulo `platform`, rotas `/v1/platform/*`, tela `/admin`): superfície separada das barbearias, detalhada em `security.md`.
  - Conta em `platform_admins`, criada só pelo comando `platform-admin` (`src/platform-admin.ts`, serviço `platform-admin` do `deploy/compose.yml`) com o usuário dono das tabelas.
  - Token com segredo e audiência próprios (`PlatformTokenService`), cookie e refresh rotativo próprios (`PlatformSessionService`, tabela `platform_refresh_tokens`).
  - Rota marcada com `@PlatformAdminOnly()`: o `AccessGuard` autentica com o token da plataforma e não define tenant, então o RLS esconde os dados das barbearias.
  - Hoje edita só os preços. Criar planos e mudar recursos pela tela fica para quando for preciso.
- **Seed**:
  - A Barbearia Demo fica no plano mais completo (mostra tudo) e a Vizinha no básico (mostra o bloqueio e o convite de upgrade). Numa demo existente, o complemento troca o plano só se ela ainda estiver no padrão.
  - `seedPlatform` cria a conta `plataforma@tanaregua.dev` e põe preços fictícios nos planos sem preço (precisa de `DATABASE_MIGRATION_URL`; nunca sobrescreve um preço).

## Frontend

- `/painel/*`: client-side (React Query sobre o cliente tipado). A sessão é reconstruída pelo cookie de refresh no `PanelShell`. As páginas exportam `instant = false`, porque são bloqueadas por sessão (validação de navegação instantânea do Next 16.3+).
- `/[slug]`: Server Component com `'use cache'` (minutos) para os dados públicos; a disponibilidade e a reserva rodam no cliente, sem cache.
- `proxy.ts` só redireciona quem não tem cookie (UX). A API revalida tudo.
- **Identidade visual:** a API guarda só as cores escolhidas (hex) e o logo; quem deriva o tema é `lib/brand.ts` (função pura e testada), que ajusta as cores até o contraste AA e gera um `<style>` com os tokens no `:root` (vale também para diálogos em portal). Os tokens base em hex ali espelham o `globals.css`: mudou o tema, atualize os dois. O logo é servido pela API em `/v1/public/{slug}/logo?v=<versão>`.
- **Duas sessões independentes no navegador** (ver `security.md`): `sessionStore` (painel) e `clientSessionStore` (agendamento online), em `lib/session/session-store.ts`. O cliente da API escolhe o token pela rota: `/v1/public/...` usa a sessão do cliente, o resto usa a do painel, e cada uma se renova pelo seu cookie (`refreshSession('panel' | 'client')`). Unificar as duas fazia o F5 do painel cair na página da barbearia quando o dono entrava como cliente no mesmo navegador (teste `e2e/sessions.spec.ts`). A administração da plataforma é a terceira sessão (`platformSessionStore`, rotas `/v1/platform/...`, `refreshSession('platform')`), reconstruída no `PlatformShell` de `/admin`.

## AFAs do Z3t@ no MVP

| Aplicadas | Como |
|---|---|
| 01 Composable / 02 DDD | módulos por domínio, DI, agregados `Appointment` e `Order` com invariantes |
| 05 API-first | contrato OpenAPI versionado + cliente gerado + checagem no CI |
| 06 SaaS abstraction | portas e adaptadores para todo fornecedor externo (e-mail, pagamento, storage, IA) e deploy em containers sem dependência do provedor |
| 09 Zero-trust | guard global deny-by-default, permissões, RLS, menor privilégio no banco |
| 12 Event-driven | outbox transacional, consumidor idempotente, dead letter |
| 14 Resiliência | timeout em chamada externa, retry com backoff no outbox (sem circuit breaker: só há um fornecedor externo) |
| 18 Observabilidade | pino com correlation id, OpenTelemetry opcional (`node --import dist/telemetry.js`), `/health/live` e `/health/ready`; estado atual, lacunas e como instrumentar cada mudança na skill `agent_docs/skills/observability/` |
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
