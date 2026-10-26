-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('SCHEDULED', 'CONFIRMED', 'IN_SERVICE', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "AppointmentSource" AS ENUM ('PANEL', 'ONLINE');

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "professional_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ NOT NULL,
    "ends_at" TIMESTAMPTZ NOT NULL,
    "blocked_until" TIMESTAMPTZ NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "source" "AppointmentSource" NOT NULL,
    "notes" TEXT,
    "cancellation_reason" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_items" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "duration_minutes" INTEGER NOT NULL,

    CONSTRAINT "appointment_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_code" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "appointments_barbershop_id_starts_at_idx" ON "appointments"("barbershop_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_barbershop_id_client_id_idx" ON "appointments"("barbershop_id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_tenant_id_key" ON "appointments"("barbershop_id", "id");

-- CreateIndex
CREATE INDEX "appointment_items_barbershop_id_appointment_id_idx" ON "appointment_items"("barbershop_id", "appointment_id");

-- CreateIndex
CREATE INDEX "idempotency_keys_created_at_idx" ON "idempotency_keys"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_user_id_key_key" ON "idempotency_keys"("user_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "clients_tenant_id_key" ON "clients"("barbershop_id", "id");

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_professional_fkey" FOREIGN KEY ("barbershop_id", "professional_id") REFERENCES "memberships"("barbershop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_client_fkey" FOREIGN KEY ("barbershop_id", "client_id") REFERENCES "clients"("barbershop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_items" ADD CONSTRAINT "appointment_items_tenant_appointment_fkey" FOREIGN KEY ("barbershop_id", "appointment_id") REFERENCES "appointments"("barbershop_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_items" ADD CONSTRAINT "appointment_items_tenant_service_fkey" FOREIGN KEY ("barbershop_id", "service_id") REFERENCES "services"("barbershop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ───────────── SQL manual: regra mais crítica do sistema (business-rules §2) ─────────────

-- btree_gist permite combinar igualdade (=) de uuid com sobreposição (&&) de intervalos no mesmo índice GiST.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Um profissional não pode ter dois atendimentos ATIVOS sobrepostos. Validar só na aplicação
-- não basta: duas requisições simultâneas passariam pela checagem. Detalhes:
-- - '[)': atendimentos encostados (um termina 10:00, outro começa 10:00) são válidos;
-- - blocked_until = fim + buffer da barbearia, então o intervalo entre atendimentos também é garantido;
-- - o WHERE torna a constraint parcial: linhas canceladas/no-show ficam FORA do índice, então nem
--   bloqueiam nem são bloqueadas. (Não confundir com checar só quando a linha NOVA está ativa.)
ALTER TABLE "appointments" ADD CONSTRAINT appointments_no_overlap
  EXCLUDE USING gist (
    barbershop_id WITH =,
    professional_id WITH =,
    tstzrange(starts_at, blocked_until, '[)') WITH &&
  ) WHERE (status NOT IN ('CANCELLED', 'NO_SHOW'));

ALTER TABLE "appointments"
  ADD CONSTRAINT appointments_interval_check CHECK (starts_at < ends_at AND ends_at <= blocked_until);
ALTER TABLE "appointment_items"
  ADD CONSTRAINT appointment_items_values_check CHECK (price_cents >= 0 AND duration_minutes > 0 AND position >= 0);

ALTER TABLE "appointments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "appointments"
  USING (barbershop_id = app_current_tenant()) WITH CHECK (barbershop_id = app_current_tenant());

ALTER TABLE "appointment_items" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "appointment_items"
  USING (barbershop_id = app_current_tenant()) WITH CHECK (barbershop_id = app_current_tenant());
