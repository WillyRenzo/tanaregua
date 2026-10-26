-- Roda uma única vez por cluster (volume novo do Postgres local, Testcontainers ou setup
-- do banco de produção), ANTES das migrations.
-- `tanaregua` (dono das tabelas) roda as migrations. `tanaregua_app` é o usuário da
-- aplicação: sem ownership e sem BYPASSRLS, para que o Row Level Security se aplique a ele.
-- As permissões no schema ficam na migration *_app_role_grants (sobrevivem a resets).
CREATE ROLE tanaregua_app LOGIN PASSWORD 'tanaregua_app' NOSUPERUSER NOBYPASSRLS;
GRANT CONNECT ON DATABASE tanaregua TO tanaregua_app;
