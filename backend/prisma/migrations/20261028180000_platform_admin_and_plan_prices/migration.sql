-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateTable
CREATE TABLE "plan_prices" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "interval" "BillingInterval" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "updated_by_id" UUID,

    CONSTRAINT "plan_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_admins" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_refresh_tokens" (
    "id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plan_prices_plan_id_interval_key" ON "plan_prices"("plan_id", "interval");

-- CreateIndex
CREATE UNIQUE INDEX "platform_admins_email_key" ON "platform_admins"("email");

-- CreateIndex
CREATE UNIQUE INDEX "platform_refresh_tokens_token_hash_key" ON "platform_refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "platform_refresh_tokens_family_id_idx" ON "platform_refresh_tokens"("family_id");

-- AddForeignKey
ALTER TABLE "plan_prices" ADD CONSTRAINT "plan_prices_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_prices" ADD CONSTRAINT "plan_prices_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "platform_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_refresh_tokens" ADD CONSTRAINT "platform_refresh_tokens_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "platform_admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───────────── SQL manual: administração da plataforma e preços (business-rules §12) ─────────────

ALTER TABLE "plan_prices" ADD CONSTRAINT plan_prices_amount_positive CHECK (amount_cents > 0);

-- Administrador da plataforma da transação corrente (como app_current_tenant). Só a
-- administração da plataforma define esse valor, e ela nunca define um tenant junto.
CREATE FUNCTION app_current_platform_admin() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.current_platform_admin', true), '')::uuid $$;

-- Preços: leitura livre (painel das barbearias e página de planos); escrita só numa
-- transação aberta pela administração da plataforma. Uma rota de barbearia que tentasse
-- mudar um preço por engano falha no banco (fail-closed).
ALTER TABLE "plan_prices" ENABLE ROW LEVEL SECURITY;
CREATE POLICY read_all ON "plan_prices" FOR SELECT USING (true);
CREATE POLICY platform_insert ON "plan_prices" FOR INSERT
  WITH CHECK (app_current_platform_admin() IS NOT NULL);
CREATE POLICY platform_update ON "plan_prices" FOR UPDATE
  USING (app_current_platform_admin() IS NOT NULL) WITH CHECK (app_current_platform_admin() IS NOT NULL);
CREATE POLICY platform_delete ON "plan_prices" FOR DELETE
  USING (app_current_platform_admin() IS NOT NULL);

-- Administradores só nascem pelo comando de administração, com o usuário dono das tabelas:
-- uma falha na aplicação não consegue criar um administrador nem trocar a senha de um.
REVOKE INSERT, UPDATE, DELETE ON "platform_admins" FROM tanaregua_app;
