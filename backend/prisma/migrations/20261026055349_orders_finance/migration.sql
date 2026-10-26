-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('OPEN', 'CLOSED', 'VOIDED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'PIX', 'CARD_CREDIT', 'CARD_DEBIT', 'OTHER');

-- CreateEnum
CREATE TYPE "EntryKind" AS ENUM ('ENTRY', 'REVERSAL');

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "client_id" UUID,
    "appointment_id" UUID,
    "status" "OrderStatus" NOT NULL DEFAULT 'OPEN',
    "payment_method" "PaymentMethod",
    "total_cents" INTEGER,
    "opened_by_user_id" UUID NOT NULL,
    "closed_by_user_id" UUID,
    "closed_at" TIMESTAMPTZ,
    "voided_at" TIMESTAMPTZ,
    "void_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "professional_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "discount_cents" INTEGER NOT NULL DEFAULT 0,
    "total_cents" INTEGER NOT NULL,
    "commission_type" "CommissionType",
    "commission_value" INTEGER,
    "commission_cents" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_entries" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "professional_id" UUID NOT NULL,
    "kind" "EntryKind" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_entries" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "kind" "EntryKind" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orders_barbershop_id_status_idx" ON "orders"("barbershop_id", "status");

-- CreateIndex
CREATE INDEX "orders_barbershop_id_closed_at_idx" ON "orders"("barbershop_id", "closed_at");

-- CreateIndex
CREATE UNIQUE INDEX "orders_tenant_id_key" ON "orders"("barbershop_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_appointment_key" ON "orders"("barbershop_id", "appointment_id");

-- CreateIndex
CREATE INDEX "order_items_barbershop_id_order_id_idx" ON "order_items"("barbershop_id", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_items_tenant_id_key" ON "order_items"("barbershop_id", "id");

-- CreateIndex
CREATE INDEX "commission_entries_barbershop_id_professional_id_occurred_a_idx" ON "commission_entries"("barbershop_id", "professional_id", "occurred_at");

-- CreateIndex
CREATE INDEX "cash_entries_barbershop_id_occurred_at_idx" ON "cash_entries"("barbershop_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_client_fkey" FOREIGN KEY ("barbershop_id", "client_id") REFERENCES "clients"("barbershop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_appointment_fkey" FOREIGN KEY ("barbershop_id", "appointment_id") REFERENCES "appointments"("barbershop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_tenant_order_fkey" FOREIGN KEY ("barbershop_id", "order_id") REFERENCES "orders"("barbershop_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_tenant_service_fkey" FOREIGN KEY ("barbershop_id", "service_id") REFERENCES "services"("barbershop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_tenant_professional_fkey" FOREIGN KEY ("barbershop_id", "professional_id") REFERENCES "memberships"("barbershop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_tenant_order_fkey" FOREIGN KEY ("barbershop_id", "order_id") REFERENCES "orders"("barbershop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_tenant_professional_fkey" FOREIGN KEY ("barbershop_id", "professional_id") REFERENCES "memberships"("barbershop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_tenant_order_fkey" FOREIGN KEY ("barbershop_id", "order_id") REFERENCES "orders"("barbershop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ───────────── SQL manual: imutabilidade financeira garantida pelo banco (business-rules §3) ─────────────

ALTER TABLE "order_items"
  ADD CONSTRAINT order_items_values_check CHECK (
    unit_price_cents >= 0 AND quantity > 0 AND discount_cents >= 0
    AND total_cents = unit_price_cents * quantity - discount_cents AND total_cents >= 0
  ),
  ADD CONSTRAINT order_items_commission_check CHECK (commission_cents IS NULL OR commission_cents BETWEEN 0 AND total_cents);
ALTER TABLE "orders"
  ADD CONSTRAINT orders_closed_check CHECK (
    status = 'OPEN' OR closed_at IS NOT NULL OR voided_at IS NOT NULL
  );

-- Itens só mudam enquanto a comanda está aberta.
CREATE FUNCTION order_items_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent_status "OrderStatus";
BEGIN
  SELECT status INTO parent_status FROM orders WHERE id = COALESCE(NEW.order_id, OLD.order_id);
  IF parent_status IS DISTINCT FROM 'OPEN' THEN
    RAISE EXCEPTION 'order % is % and its items are immutable', COALESCE(NEW.order_id, OLD.order_id), parent_status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER order_items_immutable_when_not_open
  BEFORE INSERT OR UPDATE OR DELETE ON "order_items"
  FOR EACH ROW EXECUTE FUNCTION order_items_guard();

-- Comanda fechada só pode ser estornada (CLOSED → VOIDED); estornada não muda mais.
CREATE FUNCTION orders_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'VOIDED'
     OR (OLD.status = 'CLOSED' AND (
           NEW.status <> 'VOIDED'
           OR NEW.total_cents IS DISTINCT FROM OLD.total_cents
           OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
           OR NEW.client_id IS DISTINCT FROM OLD.client_id
           OR NEW.closed_at IS DISTINCT FROM OLD.closed_at)) THEN
    RAISE EXCEPTION 'order % is % and cannot be changed', OLD.id, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER orders_immutable_after_close
  BEFORE UPDATE ON "orders"
  FOR EACH ROW EXECUTE FUNCTION orders_guard();

-- Lançamentos financeiros são append-only e comandas nunca são apagadas:
-- o usuário da aplicação perde UPDATE/DELETE (concedidos pelos default privileges).
REVOKE UPDATE, DELETE ON "commission_entries", "cash_entries" FROM tanaregua_app;
REVOKE DELETE ON "orders" FROM tanaregua_app;

ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "orders"
  USING (barbershop_id = app_current_tenant()) WITH CHECK (barbershop_id = app_current_tenant());

ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "order_items"
  USING (barbershop_id = app_current_tenant()) WITH CHECK (barbershop_id = app_current_tenant());

ALTER TABLE "commission_entries" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "commission_entries"
  USING (barbershop_id = app_current_tenant()) WITH CHECK (barbershop_id = app_current_tenant());

ALTER TABLE "cash_entries" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "cash_entries"
  USING (barbershop_id = app_current_tenant()) WITH CHECK (barbershop_id = app_current_tenant());
