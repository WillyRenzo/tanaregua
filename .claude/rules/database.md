---
paths:
  - "backend/prisma/**"
  - "backend/src/prisma/**"
---
# Banco de Dados (Prisma 7 + PostgreSQL)

- Prisma **7.10**: client gerado em `src/generated/prisma` (ESM), `prisma.config.ts`, driver adapter `@prisma/adapter-pg`. `generate` é explícito (`npm run db:generate`; `typecheck` e `build` já chamam). A tag `latest` do npm é o Prisma 8 RC: não migre sem decisão explícita.
- Toda alteração de schema = nova migration. Nunca edite migration já aplicada fora do seu banco local.
- **Criar migration num ambiente sem TTY** (Claude, CI): `migrate dev` pede confirmação interativa e falha. Use:
  `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script > prisma/migrations/<timestamp>_<nome>/migration.sql`, acrescente o SQL manual e aplique com `npx prisma migrate deploy`. Depois rode o mesmo `migrate diff`: precisa dar "empty migration".
- **Tudo o que o Prisma enxerga precisa estar no `schema.prisma`**, inclusive FKs compostas e índices únicos de suporte (com `map:` igual ao nome no banco). Se ficarem só no SQL manual, a próxima migration gerada vai **apagá-los**. O Prisma ignora (e pode ficar só no SQL): CHECK, EXCLUDE, RLS/policies, triggers, funções, GRANT/REVOKE e `NULLS NOT DISTINCT`.
- Todo model com tenant tem: `barbershopId`, `@@unique([barbershopId, id])` como alvo de FK, FKs compostas `(barbershopId, xId)` para outras tabelas de tenant, índice começando por `barbershopId`, e `ENABLE ROW LEVEL SECURITY` + policy `tenant_isolation` na mesma migration.
- Grants do usuário da aplicação vivem em migration (`*_app_role_grants`), não no bootstrap: `migrate reset` e restores recriam o schema. Tabela nova com restrição de privilégio (ex.: append-only) precisa de `REVOKE` explícito na própria migration.
- Dinheiro: `Int` em centavos; percentuais em basis points. Datas: `DateTime @db.Timestamptz`. IDs: `@default(uuid(7))`.
- SQL bruto só com `$queryRaw`/`$executeRaw` (tagged template). `*Unsafe` é proibido com input do usuário.
- Exclusões de dados financeiros são por estorno, nunca `DELETE` (business-rules §3).
