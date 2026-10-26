---
paths:
  - "backend/**/*.ts"
---
# Backend (NestJS 12)

- ESM: imports relativos com extensão `.js`. Testes com Vitest, lint com oxlint (type-aware), formato com prettier.
- Um módulo por domínio em `src/modules/<dominio>/`. Controller fino; regra de negócio no service; nenhum service lê tabela de outro domínio (exponha um método no service dono, como `StaffService.assertProfessional`).
- **Rotas:** deny by default. Toda rota declara `@Public()` (com `@Throttle`), `@AnyAuthenticated()` ou `@RequirePermissions(...)` (basta uma; escopo own/any no service). Nunca compare nome de papel.
- **Entrada:** `@Body({ schema })` / `@Query({ schema })` com Zod. Objetos de entrada são `z.strictObject` (campo extra = 400). DTOs nunca aceitam `barbershopId`.
- **Saída:** toda rota declara `@ApiResult(schema)` (`common/http/openapi.ts`). O tipo de retorno do service é `z.infer` do schema em `*.responses.ts`. Mudou? Rode `npm run openapi:export`.
- **Swagger (`/docs`):** todo controller tem `@ApiTags(API_TAGS.x[0])` e toda rota `@ApiOperation({ summary })`; erros de negócio específicos vão em `@ApiProblem(status, code, descrição)` com o mesmo `code` do `DomainError`. Permissões, cadeado e erros genéricos (400/401/403/404) entram sozinhos a partir de `@Public`/`@RequirePermissions`. O teste `test/openapi.e2e-spec.ts` falha se faltar algo. Exemplos de corpo: `.meta({ example })` no schema Zod de entrada.
- **Dados com tenant:** sempre via `TenantDb.run((tx, auth) => …)` (ou `runAs` nas rotas públicas por slug). Métodos chamados por outros módulos recebem `tx` em vez de abrir outra transação.
- **Nada de `Promise.all` com o mesmo `tx`**: a transação é uma conexão só; faça as queries em sequência.
- Erros de domínio com `DomainError` (`notFound`, `conflict`, `unprocessable`), que viram RFC 9457 com `type` específico, usado pelo frontend. Recurso de outro tenant: 404. Erro de banco conhecido (23P01, 23505) é mapeado em `database-errors.ts`.
- POST sensível a duplicidade usa `@Idempotent()` (aplica o interceptor e documenta o cabeçalho `Idempotency-Key`).
- Efeitos externos (e-mail, futuramente pagamento) só via outbox (`OutboxService.publish(tx, …)` na mesma transação) e adapters (`MailSender`).
- Testes: unitários para regras puras (comissão, disponibilidade, status). E2E com Postgres real para tenancy (`expectTenantIsolation`), constraints e concorrência, já que mocks não testam RLS.
