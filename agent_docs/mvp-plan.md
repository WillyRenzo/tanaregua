# Plano de Ação — MVP TaNaRegua

## Contexto

- O repositório tem só a configuração de IA (CLAUDE.md, `agent_docs/`, `.claude/`, `skills/`). Ainda não há nenhuma linha de código nem commit.
- Objetivo: um MVP que já resolva o dia a dia de uma barbearia (agenda, atendimento, comissão, caixa) e que possa ser vendido barato. Os módulos restantes entram em fases seguintes.
- Decisões confirmadas:
  - **Escopo enxuto.** MVP = auth/permissões, funcionários, clientes, serviços, agenda integrada, agendamento online, comanda + comissões, caixa simples e relatórios básicos.
    - Fase 2: estoque, pacotes, aniversários.
    - Fase 3: pagamento online, salários/folha, relatórios avançados.
  - **Monólito modular.** Cada bounded context é um módulo NestJS isolado. As AFAs do `z3t@-global-context.md` são aplicadas onde fazem sentido para um monólito. As que pressupõem sistema distribuído ficam registradas como "não se aplica no MVP" (o próprio documento pede YAGNI/KISS).
  - **UI:** Tailwind + shadcn/ui.

### Como as AFAs entram no MVP

- **Aplicadas:**
  - 01 Composable: módulos com contratos explícitos e DI.
  - 02 DDD: linguagem ubíqua, agregados `Appointment` e `Order`.
  - 05 API-first: OpenAPI versionado e cliente tipado gerado a partir dele.
  - 06 SaaS Abstraction: `NotificationSender`, `PaymentGateway`.
  - 09 Zero-trust: deny by default, permissões.
  - 12 Outbox: confirmação de agendamento.
  - 14 Timeouts e retry com backoff em chamadas externas.
  - 18 OpenTelemetry, logs estruturados e `/health`.
  - 19 Testcontainers, cobertura ≥ 80% de linhas e ≥ 70% de branches.
  - 20 PII classificada e mascarada em logs.
- **Adiadas (YAGNI, registrar em architecture.md):**
  - 03 micro-frontends, 04 BFF separado, 07 data product, 10 strangler, 13 saga.
  - 15 cache distribuído, 16 GraphQL, 17 CQRS, 21 MCP.
  - Kubernetes e microsserviços.

---

## Plano 1 — Backend (NestJS 12 + Prisma 7 + PostgreSQL)

### B0 · Fundação

- Scaffold NestJS 12 em `backend/`:
  - ESM, `strict: true`, Vitest, oxlint.
  - Scripts `lint`, `typecheck`, `test`, `test:e2e`, `build` (exigidos pelo hook).
- `docker-compose.yml` na raiz com Postgres para desenvolvimento.
- Testes de integração/e2e com **Testcontainers** (AFA 19), em vez do banco compartilhado.
- `.npmrc` com `ignore-scripts` e `min-release-age`; `.env.example`.
- Validação de env com `@nestjs/config` + Zod, falhando na inicialização se faltar algo.
- Infra transversal em `src/common/`:
  - `nestjs-pino` com correlation ID e PII mascarada.
  - OpenTelemetry SDK (http + Prisma).
  - `@nestjs/terminus` (`/health/live`, `/health/ready`).
  - `helmet`, CORS com allowlist, `@nestjs/throttler`.
  - Exception filter global no formato **RFC 9457 Problem Details**.
  - `@nestjs/swagger` gerando `openapi.json`.
- Convenções de API:
  - Prefixo `/v1`.
  - Paginação por cursor.
  - Header `Idempotency-Key` nas rotas `POST` sensíveis (criar agendamento, fechar comanda).
- CI no GitHub Actions: `npm ci` → lint → typecheck → test (coverage gate) → e2e com Testcontainers → build. Actions fixadas por SHA.

### B1 · Identidade, tenancy e permissões

- Models Prisma:
  - `Barbershop` (slug, timezone, políticas).
  - `User`, `Membership` (user ↔ barbershop ↔ role).
  - `Role`, `Permission`, `RolePermission`, `RefreshToken`.
- Auth:
  - Cadastro do dono, que cria a barbearia na mesma transação.
  - Login com argon2id.
  - Access token de 15 min.
  - Refresh rotativo, guardado como hash, em cookie httpOnly. Reuso detectado revoga a família inteira.
  - Logout.
- Guards globais:
  - `JwtAuthGuard` (deny by default, com exceção via `@Public()`).
  - `PermissionsGuard` (`@RequirePermissions('appointments:write:any')`).
- Contexto de tenant com `nestjs-cls`: o `barbershopId` sai do JWT e nunca do input.
- **Isolamento em duas camadas:**
  - Extensão Prisma que envolve cada operação numa `$transaction` com `SELECT set_config('app.current_tenant', $1, true)`.
  - Policies RLS em SQL manual nas migrations. O usuário do banco da app não é dono das tabelas.
- Seed de papéis padrão: owner, professional, receptionist, client. Cada papel é só um conjunto de permissões.
- Helper de teste e2e `expectTenantIsolation(resource)`, reutilizado por todos os módulos seguintes.

### B2 · Cadastros base

- `staff`:
  - Profissionais e recepcionistas.
  - `WorkSchedule` (dia da semana, início, fim).
  - `TimeOff` (folgas e bloqueios).
- `clients`:
  - Nome, telefone, e-mail, nascimento.
  - Campos PII anotados com o nível de classificação.
  - Consentimento de marketing (data e canal).
  - Anonimização sob pedido.
- `catalog`:
  - `Service` (preço em centavos, duração em minutos, ativo).
  - `CommissionRule` (escopo funcionário+serviço / serviço / funcionário; tipo `PERCENT` em basis points ou `FIXED` em centavos).

### B3 · Agenda (regra mais crítica)

- Agregado `Appointment`:
  - `professionalId`, `clientId`, itens de serviço, `startsAt`/`endsAt` (timestamptz).
  - Status: `SCHEDULED → CONFIRMED → IN_SERVICE → COMPLETED`, mais `CANCELLED` e `NO_SHOW`.
  - Transições validadas no domínio.
- Migration com `btree_gist` + `EXCLUDE USING gist (professional_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&) WHERE (status NOT IN ('CANCELLED','NO_SHOW'))`.
- Erro `23P01` mapeado para `409 Conflict` (Problem Details com o tipo `appointment-conflict`).
- `AvailabilityService`, função pura e testada à exaustão:
  - Entradas: expediente − folgas − agendamentos ativos.
  - Grade de 15 min, calculada no fuso da barbearia (`@date-fns/tz`).
- Endpoints:
  - Agenda do dia (todos os profissionais).
  - Semana (um profissional).
  - Criar, reagendar, mudar status.
- Teste e2e de concorrência: duas requisições simultâneas no mesmo horário resultam em exatamente um `201` e um `409`.

### B4 · Agendamento público

- Rotas `@Public()` em `/v1/public/:slug/...`, com throttling agressivo:
  - Dados da barbearia.
  - Serviços.
  - Profissionais.
  - Horários disponíveis.
- O tenant é resolvido **pelo slug no servidor**. É a única exceção à regra "tenant vem do token" e precisa ser documentada em business-rules §1.
- Conta do cliente final, por barbearia (confirma a PROPOSTA de business-rules §1):
  - Cadastro e login com e-mail + senha.
  - Papel `client`.
- Fluxo de reserva:
  - Criação idempotente, que passa pela mesma constraint de conflito.
  - "Meus agendamentos".
  - Cancelamento conforme a política.
- **Outbox (AFA 12):** a reserva grava `AppointmentBooked` em `outbox_events` na mesma transação.
  - Um worker (`@nestjs/schedule`) despacha os eventos pelo `NotificationSender` (adapter de e-mail, ex.: Resend/SES).
  - Timeout + retry com backoff; consumidor idempotente.

### B5 · Comanda e financeiro

- Agregado `Order` (comanda):
  - Abre a partir de um agendamento ou de um atendimento avulso.
  - Itens com **snapshot** de preço e da regra de comissão.
- `closeOrder` em **uma única transação**:
  - Valida o status.
  - Calcula as comissões com `calculateCommission`, função pura e o único ponto de arredondamento.
  - Grava `CommissionEntry` e `CashEntry`. As formas de pagamento manuais (dinheiro, pix, cartão na maquininha) são só registro.
  - Marca o agendamento como `COMPLETED`.
- Comanda fechada é imutável. Correção só por `voidOrder`, que gera lançamentos de estorno.
- Caixa do dia: listagem de lançamentos e totais por forma de pagamento.

### B6 · Relatórios básicos

- Faturamento por período e por profissional.
- Comissões a pagar por profissional (o profissional vê só as próprias: permissão `commissions:read:own`).
- Serviços mais vendidos e taxa de no-show.
- Agregações SQL sobre comandas fechadas, sempre sob RLS e com índices `(barbershop_id, closed_at)`.

### B7 · Endurecimento antes do lançamento

- Rodar as skills `security-audit` e `code-review` do projeto.
- Revisar o checklist IDOR de cada endpoint.
- Medir um baseline de performance de `/availability` e da agenda do dia.
- Configurar o deploy (plataforma ainda **[PENDENTE]**) com `prisma migrate deploy` usando um usuário de migração separado.

---

## Plano 2 — Frontend (Next.js 16 + Tailwind + shadcn/ui)

### F0 · Fundação

- Scaffold Next.js 16 em `frontend/`:
  - App Router, `strict`, ESLint (`eslint .`), Vitest + Testing Library, Playwright.
  - Scripts `lint`, `typecheck`, `test`, `build`.
- Tailwind + shadcn/ui com **design tokens próprios**:
  - Direção estética a confirmar: "barbearia clássica/industrial", com neutros quentes, acento cobre, tipografia condensada nos títulos e uma sans legível para dados.
  - A agenda é densa e orientada a dados.
  - Nada de Inter nem gradiente roxo (skill `frontend-design`).
- Cliente da API **gerado do `openapi.json`** (`openapi-typescript` + `openapi-fetch`) em `src/lib/api/`. Tipos não são duplicados à mão.
- `rewrites` no `next.config` de `/api/*` para o NestJS, para que o cookie de refresh seja first-party.
- TanStack Query no painel; formulários com React Hook Form + Zod.
- `error.tsx`, `loading.tsx` e `not-found.tsx` por segmento.

### F1 · Auth e casca do painel

- Route groups: `(auth)/login`, `(auth)/cadastro` (onboarding: dono + barbearia), `(painel)/...`.
- Access token só em memória. O interceptor faz refresh silencioso quando recebe 401.
- `proxy.ts` só redireciona quem não está logado (não é autorização).
- Layout do painel com navegação filtrada por permissões. O helper `can()` serve só à UX; a API revalida tudo.

### F2 · Cadastros

- Funcionários, com editor visual de expediente semanal e folgas.
- Clientes: busca, ficha, consentimento, pedido de anonimização.
- Serviços e regras de comissão: preço exibido em reais e enviado em centavos; percentual exibido em % e enviado em basis points.
- Tabelas com busca, paginação por cursor e estados de vazio, loading e erro.

### F3 · Agenda integrada (tela principal)

- Visão do dia em **grade própria** (CSS grid): colunas = profissionais, linhas = horários de 15 min.
  - Cada bloco mostra cliente, serviço e status por cor + ícone (nunca só cor).
  - Linha marcando a hora atual.
- Visão da semana por profissional.
- Drawer de criação e edição:
  - Cliente, serviços (a duração é calculada) e horário.
  - Um `409` da API vira mensagem clara ("Fulana já tem atendimento às 10:00") e o dia é recarregado.
- Ações de status: confirmar, iniciar, não compareceu, cancelar, abrir comanda.
- Atualização por refetch periódico + `invalidateQueries` após cada mutação.
- Grade navegável por teclado e responsiva (no celular vira lista por profissional).

### F4 · Página pública de agendamento

- Rota `(publico)/[slug]`: barbearia, serviços e profissionais renderizados em Server Component (SSR/SEO).
- Fluxo mobile-first em etapas:
  1. Serviço.
  2. Profissional (ou "qualquer um").
  3. Dia e horário (consulta `/availability`).
  4. Login ou cadastro rápido.
  5. Confirmação.
- Área "Meus agendamentos" com cancelamento dentro da política.
- O botão de reserva envia uma `Idempotency-Key` gerada no cliente, para evitar reserva dupla com duplo clique.

### F5 · Comanda e caixa

- Comanda aberta a partir da agenda: adicionar e remover itens, ver o total e a comissão prevista.
- Fechar com a forma de pagamento → tela de resumo.
- Estorno (só para quem tem permissão).
- Caixa do dia: lançamentos e totais por forma de pagamento.

### F6 · Relatórios e início por papel

- **Dono:** faturamento, ranking de profissionais, serviços, no-show, com filtro de período. Os gráficos seguem a skill `dataviz`.
- **Profissional:** a própria agenda de hoje e as próprias comissões.
- **Recepcionista:** a agenda do dia como tela inicial.

### F7 · Qualidade

- Playwright nos fluxos críticos:
  - Onboarding.
  - Criar agendamento e ver o conflito.
  - Reserva pública.
  - Fechar comanda.
- Checagem WCAG 2.2 AA: foco visível, labels, contraste.
- Validar o layout no celular e no desktop.

---

## Como cada funcionalidade será implementada (resumo)

- **Isolamento entre barbearias:** o `barbershopId` vem do JWT via CLS, o filtro é aplicado pela app e o RLS do Postgres é a garantia final. Um teste e2e por recurso prova que o tenant A recebe 404 nos dados do tenant B.
- **Sem conflito de horário:** exclusion constraint no Postgres, imune a corrida, com o intervalo `[início, fim)` e ignorando os status cancelado e não compareceu. A app pré-valida só para dar um erro amigável. O conflito vira 409 e é testado com requisições concorrentes.
- **Agenda integrada:** um endpoint devolve o dia inteiro (profissionais × agendamentos × bloqueios) e o frontend desenha a grade. É a visão "funcionária X atende cliente Y às 10h".
- **Horários disponíveis:** função pura `expediente − folgas − agendamentos` no fuso da barbearia, usada tanto pelo painel quanto pela página pública.
- **Papéis extensíveis:** papel = conjunto de permissões gravado no banco. Um papel novo é um registro novo, sem mudar código.
- **Comissão configurável:** precedência funcionário+serviço > serviço > funcionário (PROPOSTA). Percentual em basis points, valor em centavos. Calculada uma vez no fechamento e gravada.
- **Comanda imutável:** depois de fechada, só aceita estorno, que gera lançamentos inversos. O histórico nunca muda.
- **Agendamento online:** rotas públicas por slug com throttling, conta do cliente por barbearia, reserva idempotente e e-mail de confirmação via outbox.
- **Relatórios:** consultas agregadas sobre comandas fechadas, nunca sobre agendamentos.

## Fora do MVP

- Estoque e produtos, pacotes, aniversários e campanhas (fase 2).
- Pagamento online, salários/folha, relatórios avançados (fase 3).
- Login social, OTP por WhatsApp, app mobile nativo.
- Drag-and-drop na agenda (o MVP reagenda pelo drawer).

## Decisões a confirmar durante a execução

- **Política de cancelamento (necessária no B4).** Proposta: antecedência mínima configurável por barbearia, padrão de 2h, sem multa no MVP.
- **Intervalo entre atendimentos (B3).** Proposta: `bufferMinutes` configurável por barbearia, padrão 0.
- **Precedência das comissões.** Confirmar a PROPOSTA de business-rules §4.
- **Direção estética (F0).** Validar com um protótipo da agenda antes das outras telas.
- **Plataforma de deploy (B7).**

## Atualizações de documentação propostas (pedem sua confirmação)

- `architecture.md`: monólito modular e o mapa de AFAs aplicadas e adiadas.
- `business-rules.md`:
  - Exceção do tenant por slug nas rotas públicas.
  - Percentual em basis points.
  - Confirmação do cadastro de cliente por barbearia.
- `CLAUDE.md`: testes e2e com Testcontainers e o comando de geração do cliente da API no frontend.

## Verificação

- A cada etapa: `npm --prefix <app> run lint && npm --prefix <app> run typecheck && npm --prefix <app> test`. O hook de pré-commit bloqueia se falhar.
- Backend:
  - e2e com Testcontainers cobrindo isolamento de tenant, conflito concorrente (um 201 e um 409), fechamento/estorno de comanda, rotação e reuso de refresh token, e webhook/outbox idempotente.
  - Coverage gate de 80% de linhas e 70% de branches no CI.
- Frontend: Playwright nos quatro fluxos críticos rodando contra a API real em `docker compose`.
- Teste de aceite manual do MVP:
  1. Criar uma barbearia, dois profissionais e três serviços.
  2. Agendar pelo painel e pela página pública.
  3. Tentar um conflito.
  4. Fechar a comanda.
  5. Conferir a comissão e o caixa do dia.
  6. Conferir o relatório do período.

---

## Roadmap depois do MVP (decisões de 27/10/2026)

O MVP (Plano 1 e Plano 2) está implementado. Regras de negócio de cada item em
`business-rules.md`; desenho técnico em `architecture.md`.

### B7 · Endurecimento e deploy (próximo)

- Auditoria (`security-audit`, `code-review`), revisão de IDOR por endpoint, baseline de performance de `/availability` e da agenda do dia.
- Deploy na **VPS da Hostinger** com Docker Compose de produção (`deploy/`): imagens multi-stage, Caddy com HTTPS, migrations com usuário próprio, imagens no GHCR publicadas pelo CI, backup criptografado fora da VPS.
- Nada específico do provedor no código: trocar de hospedagem = rodar as mesmas imagens em outro lugar.

### Fase 2 · Operação e personalização

- **Reagendamento pelo cliente** até N horas antes (configurável, padrão 24 h), pela página pública.
- **Faltas sem justificativa:** justificativa opcional ao marcar "não compareceu"; contagem visível para a equipe no cliente e no agendamento.
- **Identidade visual por barbearia:** logo (porta `ObjectStorage`) e cores com contraste AA garantido, aplicados na página pública e no painel.
- **Domínio próprio (opcional):** a barbearia compra e aponta o DNS; a plataforma verifica e emite HTTPS automaticamente.
- **Estoque e produtos:** venda na comanda, movimentações com autor e motivo, quantidade nunca negativa (garantida no banco), valor total do estoque pode ficar negativo.
- **Pacotes de serviços:** validade configurável por pacote, intransferível, reembolso só se pago antecipadamente e dentro da validade, com valor definido pela barbearia.
- **Aniversários e campanhas** com consentimento (LGPD).

### Fase 3 · Dinheiro

- **Pagamento online** pela porta `PaymentGateway` (Mercado Pago como adapter inicial, trocável por configuração), webhook verificado e idempotente, reembolso de pacote pago antecipadamente.
- **Salários e folha**, relatórios avançados.

### Fase 4 · Assistente de IA

- Chat no painel para o dono pedir tarefas em linguagem natural (ex.: importar produtos de uma planilha Excel).
- Ferramentas = casos de uso existentes, com as permissões do usuário; toda escrita mostra prévia e só executa após confirmação; auditoria de cada ação.
- Provedor de IA pela porta `LlmProvider`: Claude como adapter inicial, trocável a qualquer momento por configuração (`LLM_PROVIDER`), sem mudar ferramentas, prompts de domínio nem telas.
- Acesso: dono e recepcionista (`assistant:use`). LGPD: PII de clientes mascarada antes de ir ao provedor.
- Pendente: limites de uso por plano.
