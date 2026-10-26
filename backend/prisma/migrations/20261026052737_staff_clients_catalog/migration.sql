-- CreateEnum
CREATE TYPE "CommissionType" AS ENUM ('PERCENT', 'FIXED');

-- CreateTable
CREATE TABLE "work_schedules" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER NOT NULL,

    CONSTRAINT "work_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_offs" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ NOT NULL,
    "ends_at" TIMESTAMPTZ NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "time_offs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "user_id" UUID,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "birth_date" DATE,
    "marketing_consent_at" TIMESTAMPTZ,
    "marketing_consent_channel" TEXT,
    "notes" TEXT,
    "anonymized_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price_cents" INTEGER NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_rules" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "membership_id" UUID,
    "service_id" UUID,
    "type" "CommissionType" NOT NULL,
    "value" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "commission_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_schedules_barbershop_id_membership_id_idx" ON "work_schedules"("barbershop_id", "membership_id");

-- CreateIndex
CREATE INDEX "time_offs_barbershop_id_membership_id_starts_at_idx" ON "time_offs"("barbershop_id", "membership_id", "starts_at");

-- CreateIndex
CREATE INDEX "clients_barbershop_id_name_idx" ON "clients"("barbershop_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "clients_barbershop_id_user_id_key" ON "clients"("barbershop_id", "user_id");

-- CreateIndex
CREATE INDEX "services_barbershop_id_active_idx" ON "services"("barbershop_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "services_tenant_id_key" ON "services"("barbershop_id", "id");

-- CreateIndex
CREATE INDEX "commission_rules_barbershop_id_idx" ON "commission_rules"("barbershop_id");

-- CreateIndex
-- NULLS NOT DISTINCT (editado à mão): NULL significa "qualquer", então só pode haver uma regra por combinação.
CREATE UNIQUE INDEX "commission_rules_target_key" ON "commission_rules"("barbershop_id", "membership_id", "service_id") NULLS NOT DISTINCT;

-- CreateIndex
CREATE UNIQUE INDEX "memberships_tenant_id_key" ON "memberships"("barbershop_id", "id");

-- AddForeignKey
ALTER TABLE "work_schedules" ADD CONSTRAINT "work_schedules_tenant_membership_fkey" FOREIGN KEY ("barbershop_id", "membership_id") REFERENCES "memberships"("barbershop_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_offs" ADD CONSTRAINT "time_offs_tenant_membership_fkey" FOREIGN KEY ("barbershop_id", "membership_id") REFERENCES "memberships"("barbershop_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_barbershop_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_barbershop_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_tenant_membership_fkey" FOREIGN KEY ("barbershop_id", "membership_id") REFERENCES "memberships"("barbershop_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_tenant_service_fkey" FOREIGN KEY ("barbershop_id", "service_id") REFERENCES "services"("barbershop_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ───────────── SQL manual (o schema.prisma não expressa CHECKs nem RLS) ─────────────
-- As FKs compostas (barbershop_id, membership_id) acima existem porque checagens de FK
-- ignoram o RLS: só elas garantem no banco que nada aponte para outro tenant.

ALTER TABLE "work_schedules"
  ADD CONSTRAINT work_schedules_weekday_check CHECK (weekday BETWEEN 0 AND 6),
  ADD CONSTRAINT work_schedules_interval_check CHECK (start_minute >= 0 AND end_minute <= 1440 AND start_minute < end_minute);
ALTER TABLE "time_offs" ADD CONSTRAINT time_offs_interval_check CHECK (starts_at < ends_at);
ALTER TABLE "services"
  ADD CONSTRAINT services_price_check CHECK (price_cents >= 0),
  ADD CONSTRAINT services_duration_check CHECK (duration_minutes > 0);
ALTER TABLE "commission_rules"
  ADD CONSTRAINT commission_rules_target_check CHECK (membership_id IS NOT NULL OR service_id IS NOT NULL),
  ADD CONSTRAINT commission_rules_value_check CHECK (value >= 0 AND (type <> 'PERCENT' OR value <= 10000));

ALTER TABLE "work_schedules" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "work_schedules"
  USING (barbershop_id = app_current_tenant()) WITH CHECK (barbershop_id = app_current_tenant());

ALTER TABLE "time_offs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "time_offs"
  USING (barbershop_id = app_current_tenant()) WITH CHECK (barbershop_id = app_current_tenant());

ALTER TABLE "clients" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "clients"
  USING (barbershop_id = app_current_tenant()) WITH CHECK (barbershop_id = app_current_tenant());

ALTER TABLE "services" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "services"
  USING (barbershop_id = app_current_tenant()) WITH CHECK (barbershop_id = app_current_tenant());

ALTER TABLE "commission_rules" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "commission_rules"
  USING (barbershop_id = app_current_tenant()) WITH CHECK (barbershop_id = app_current_tenant());
