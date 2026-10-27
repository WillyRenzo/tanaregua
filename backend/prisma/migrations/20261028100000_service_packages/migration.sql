-- CreateEnum
CREATE TYPE "ClientPackageStatus" AS ENUM ('ACTIVE', 'REFUNDED', 'VOIDED');

-- CreateEnum
CREATE TYPE "PackageMovementKind" AS ENUM ('PURCHASE', 'USE', 'USE_REVERSAL');

-- AlterEnum
ALTER TYPE "EntryKind" ADD VALUE 'REFUND';

-- AlterEnum
ALTER TYPE "OrderItemKind" ADD VALUE 'PACKAGE';

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "client_package_id" UUID,
ADD COLUMN     "package_id" UUID,
ADD COLUMN     "package_session_value_cents" INTEGER;

-- CreateTable
CREATE TABLE "service_packages" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price_cents" INTEGER NOT NULL,
    "validity_days" INTEGER NOT NULL,
    "commission_on_sessions" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "service_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_package_items" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "service_package_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_packages" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "price_paid_cents" INTEGER NOT NULL,
    "commission_on_sessions" BOOLEAN NOT NULL,
    "purchased_at" TIMESTAMPTZ NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "status" "ClientPackageStatus" NOT NULL DEFAULT 'ACTIVE',
    "refunded_at" TIMESTAMPTZ,
    "refund_cents" INTEGER,
    "refund_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_package_balances" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "client_package_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "initial_quantity" INTEGER NOT NULL,
    "remaining" INTEGER NOT NULL DEFAULT 0,
    "session_value_cents" INTEGER NOT NULL,

    CONSTRAINT "client_package_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_movements" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "client_package_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "kind" "PackageMovementKind" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "order_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "package_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "service_packages_barbershop_id_active_idx" ON "service_packages"("barbershop_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "service_packages_tenant_id_key" ON "service_packages"("barbershop_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "service_package_items_service_key" ON "service_package_items"("barbershop_id", "package_id", "service_id");

-- CreateIndex
CREATE INDEX "client_packages_barbershop_id_client_id_idx" ON "client_packages"("barbershop_id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "client_packages_tenant_id_key" ON "client_packages"("barbershop_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "client_package_balances_service_key" ON "client_package_balances"("barbershop_id", "client_package_id", "service_id");

-- CreateIndex
CREATE INDEX "package_movements_barbershop_id_client_package_id_idx" ON "package_movements"("barbershop_id", "client_package_id");

-- CreateIndex
CREATE INDEX "package_movements_barbershop_id_order_id_idx" ON "package_movements"("barbershop_id", "order_id");

-- AddForeignKey
ALTER TABLE "service_packages" ADD CONSTRAINT "service_packages_barbershop_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_package_items" ADD CONSTRAINT "service_package_items_tenant_package_fkey" FOREIGN KEY ("barbershop_id", "package_id") REFERENCES "service_packages"("barbershop_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_package_items" ADD CONSTRAINT "service_package_items_tenant_service_fkey" FOREIGN KEY ("barbershop_id", "service_id") REFERENCES "services"("barbershop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_packages" ADD CONSTRAINT "client_packages_tenant_client_fkey" FOREIGN KEY ("barbershop_id", "client_id") REFERENCES "clients"("barbershop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_packages" ADD CONSTRAINT "client_packages_tenant_package_fkey" FOREIGN KEY ("barbershop_id", "package_id") REFERENCES "service_packages"("barbershop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_packages" ADD CONSTRAINT "client_packages_tenant_order_fkey" FOREIGN KEY ("barbershop_id", "order_id") REFERENCES "orders"("barbershop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_package_balances" ADD CONSTRAINT "client_package_balances_tenant_package_fkey" FOREIGN KEY ("barbershop_id", "client_package_id") REFERENCES "client_packages"("barbershop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_package_balances" ADD CONSTRAINT "client_package_balances_tenant_service_fkey" FOREIGN KEY ("barbershop_id", "service_id") REFERENCES "services"("barbershop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_movements" ADD CONSTRAINT "package_movements_tenant_package_fkey" FOREIGN KEY ("barbershop_id", "client_package_id") REFERENCES "client_packages"("barbershop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_movements" ADD CONSTRAINT "package_movements_tenant_order_fkey" FOREIGN KEY ("barbershop_id", "order_id") REFERENCES "orders"("barbershop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_tenant_package_fkey" FOREIGN KEY ("barbershop_id", "package_id") REFERENCES "service_packages"("barbershop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_tenant_client_package_fkey" FOREIGN KEY ("barbershop_id", "client_package_id") REFERENCES "client_packages"("barbershop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ───────────── SQL manual: regras de pacotes garantidas pelo banco (business-rules §6) ─────────────
-- Os valores novos dos enums (PACKAGE, REFUND) não podem ser usados na mesma transação em
-- que foram criados: as comparações abaixo usam o texto do enum.

ALTER TABLE "service_packages"
  ADD CONSTRAINT service_packages_values_check CHECK (price_cents >= 0 AND validity_days BETWEEN 1 AND 3650);
ALTER TABLE "service_package_items"
  ADD CONSTRAINT service_package_items_quantity_check CHECK (quantity BETWEEN 1 AND 100);
ALTER TABLE "client_packages"
  ADD CONSTRAINT client_packages_values_check CHECK (
    price_paid_cents >= 0 AND expires_at > purchased_at
    AND (refund_cents IS NULL OR refund_cents BETWEEN 0 AND price_paid_cents)
    AND ((status::text = 'REFUNDED') = (refunded_at IS NOT NULL))
  );
ALTER TABLE "client_package_balances"
  ADD CONSTRAINT client_package_balances_values_check CHECK (
    initial_quantity >= 1 AND session_value_cents >= 0
    -- O saldo de sessões nunca fica negativo, nem sob concorrência.
    AND remaining >= 0 AND remaining <= initial_quantity
  );
ALTER TABLE "package_movements"
  ADD CONSTRAINT package_movements_quantity_check CHECK (
    quantity <> 0
    AND (kind::text <> 'PURCHASE' OR quantity > 0)
    AND (kind::text <> 'USE' OR quantity < 0)
    AND (kind::text <> 'USE_REVERSAL' OR quantity > 0)
  );

-- O saldo é a soma das movimentações (mesmo desenho do estoque): cada inserção aplica o
-- delta; se o saldo ficaria negativo, o CHECK aborta a movimentação inteira.
CREATE FUNCTION apply_package_movement() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE client_package_balances
     SET remaining = remaining + NEW.quantity
   WHERE client_package_id = NEW.client_package_id
     AND service_id = NEW.service_id
     AND barbershop_id = NEW.barbershop_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'package % has no balance for service %', NEW.client_package_id, NEW.service_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER package_movements_apply
  AFTER INSERT ON "package_movements"
  FOR EACH ROW EXECUTE FUNCTION apply_package_movement();

-- Item de comanda: serviço (com profissional; pode ser pago com sessão de pacote), produto
-- (profissional opcional) ou pacote vendido. Item pago com pacote cobra zero.
ALTER TABLE "order_items" DROP CONSTRAINT order_items_kind_check;
ALTER TABLE "order_items"
  ADD CONSTRAINT order_items_kind_check CHECK (
    (kind::text = 'SERVICE' AND service_id IS NOT NULL AND product_id IS NULL AND package_id IS NULL
      AND professional_id IS NOT NULL)
    OR (kind::text = 'PRODUCT' AND product_id IS NOT NULL AND service_id IS NULL AND package_id IS NULL
      AND client_package_id IS NULL)
    OR (kind::text = 'PACKAGE' AND package_id IS NOT NULL AND service_id IS NULL AND product_id IS NULL
      AND client_package_id IS NULL AND quantity = 1)
  );
ALTER TABLE "order_items" DROP CONSTRAINT order_items_values_check;
ALTER TABLE "order_items"
  ADD CONSTRAINT order_items_values_check CHECK (
    unit_price_cents >= 0 AND quantity > 0 AND discount_cents >= 0 AND total_cents >= 0
    AND (
      (client_package_id IS NULL AND total_cents = unit_price_cents * quantity - discount_cents)
      OR (client_package_id IS NOT NULL AND total_cents = 0 AND discount_cents = 0)
    )
  );
-- A comissão nunca passa do valor do item; num serviço pago com pacote, do valor das sessões.
ALTER TABLE "order_items" DROP CONSTRAINT order_items_commission_check;
ALTER TABLE "order_items"
  ADD CONSTRAINT order_items_commission_check CHECK (
    commission_cents IS NULL OR (
      commission_cents >= 0
      AND commission_cents <= CASE
        WHEN client_package_id IS NOT NULL THEN COALESCE(package_session_value_cents, 0) * quantity
        ELSE total_cents
      END
    )
  );

-- RLS (fail-closed) nas tabelas novas com tenant.
ALTER TABLE "service_packages" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "service_packages"
  USING (barbershop_id = app_current_tenant()) WITH CHECK (barbershop_id = app_current_tenant());
ALTER TABLE "service_package_items" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "service_package_items"
  USING (barbershop_id = app_current_tenant()) WITH CHECK (barbershop_id = app_current_tenant());
ALTER TABLE "client_packages" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "client_packages"
  USING (barbershop_id = app_current_tenant()) WITH CHECK (barbershop_id = app_current_tenant());
ALTER TABLE "client_package_balances" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "client_package_balances"
  USING (barbershop_id = app_current_tenant()) WITH CHECK (barbershop_id = app_current_tenant());
ALTER TABLE "package_movements" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "package_movements"
  USING (barbershop_id = app_current_tenant()) WITH CHECK (barbershop_id = app_current_tenant());

-- Privilégios: movimentações append-only; o saldo só muda pelo trigger; pacote vendido
-- nunca é apagado (status muda para REFUNDED/VOIDED).
REVOKE UPDATE, DELETE ON "package_movements" FROM tanaregua_app;
REVOKE UPDATE, DELETE ON "client_package_balances" FROM tanaregua_app;
REVOKE DELETE ON "client_packages" FROM tanaregua_app;

-- Permissões novas nos papéis padrão das barbearias que já existem.
UPDATE roles SET permissions = array_cat(permissions, ARRAY['packages:read', 'packages:manage'])
 WHERE is_system AND key IN ('owner', 'receptionist') AND NOT ('packages:read' = ANY (permissions));
UPDATE roles SET permissions = array_append(permissions, 'packages:read')
 WHERE is_system AND key = 'professional' AND NOT ('packages:read' = ANY (permissions));
