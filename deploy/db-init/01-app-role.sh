#!/bin/sh
# Roda uma única vez, na criação do volume do Postgres, ANTES das migrations.
# Versão de produção de backend/prisma/bootstrap/roles.sql, com a senha vinda do .env.
# `tanaregua` (dono das tabelas) roda as migrations; `tanaregua_app` é o usuário da
# aplicação, sem ownership e sem BYPASSRLS, para que o Row Level Security se aplique a ele.
# As permissões no schema ficam na migration *_app_role_grants.
set -eu

psql -v ON_ERROR_STOP=1 -v app_password="$APP_DB_PASSWORD" \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
CREATE ROLE tanaregua_app LOGIN PASSWORD :'app_password' NOSUPERUSER NOBYPASSRLS;
GRANT CONNECT ON DATABASE tanaregua TO tanaregua_app;
SQL
