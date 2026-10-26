-- Permissões do usuário da aplicação (tanaregua_app) no schema.
--
-- Por que numa migration e não só no bootstrap (prisma/bootstrap/roles.sql)? Grants de
-- schema e DEFAULT PRIVILEGES morrem junto com o schema: um `prisma migrate reset` ou um
-- restore recria o `public` e o app perderia acesso a tudo. A migration é reaplicada em
-- qualquer ambiente; o bootstrap fica só com o que é do cluster (criar o role).
--
-- Sem `FOR ROLE`: os default privileges valem para quem roda as migrations (o dono das
-- tabelas), qualquer que seja o nome desse usuário no ambiente.

GRANT USAGE ON SCHEMA public TO tanaregua_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tanaregua_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tanaregua_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tanaregua_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO tanaregua_app;

-- O GRANT ON ALL TABLES acima desfaria as restrições financeiras: reaplica (business-rules §3).
REVOKE UPDATE, DELETE ON "commission_entries", "cash_entries" FROM tanaregua_app;
REVOKE DELETE ON "orders" FROM tanaregua_app;

-- A aplicação não tem por que ler nem alterar o histórico de migrations.
REVOKE ALL ON "_prisma_migrations" FROM tanaregua_app;
