-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED');

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "features" TEXT[],
    "position" INTEGER NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plans_key_key" ON "plans"("key");

-- CreateIndex
CREATE UNIQUE INDEX "plans_position_key" ON "plans"("position");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_barbershop_id_key" ON "subscriptions"("barbershop_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_tenant_id_key" ON "subscriptions"("barbershop_id", "id");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_barbershop_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;




-- ───────────── SQL manual: assinatura e planos (business-rules §12) ─────────────

-- No máximo um plano padrão (o de quem cria uma barbearia).
ALTER TABLE "plans" ADD CONSTRAINT plans_single_default EXCLUDE (is_default WITH =) WHERE (is_default);

-- [PROPOSTA] Planos iniciais (nomes, conteúdo e preço ainda serão definidos; mudar é dado,
-- não código). O básico cobre as fases 1 e 2, que valem em todo plano e não têm chave própria.
INSERT INTO "plans" (id, key, name, features, position, is_default) VALUES
  (uuidv7(), 'essential', 'Essencial', '{}', 1, true),
  (uuidv7(), 'professional', 'Profissional', '{online-payment,payroll,advanced-reports}', 2, false),
  (uuidv7(), 'premium', 'Premium', '{online-payment,payroll,advanced-reports,assistant}', 3, false);

-- Barbearias que já existem entram no plano padrão, que é o que elas já usam hoje.
INSERT INTO "subscriptions" (id, barbershop_id, plan_id, status, updated_at)
SELECT uuidv7(), b.id, p.id, 'ACTIVE', CURRENT_TIMESTAMP
  FROM "barbershops" b CROSS JOIN "plans" p
 WHERE p.is_default;

-- RLS (fail-closed) na assinatura. Os planos são catálogo global, sem tenant.
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "subscriptions"
  USING (barbershop_id = app_current_tenant()) WITH CHECK (barbershop_id = app_current_tenant());

-- Privilégios: os planos são administrados pela plataforma, nunca pela aplicação das
-- barbearias; a assinatura muda de plano e de status, mas nunca é apagada (§12).
REVOKE INSERT, UPDATE, DELETE ON "plans" FROM tanaregua_app;
REVOKE DELETE ON "subscriptions" FROM tanaregua_app;
