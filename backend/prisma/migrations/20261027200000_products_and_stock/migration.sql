-- CreateEnum
CREATE TYPE "StockMovementKind" AS ENUM ('ENTRY', 'SALE', 'SALE_REVERSAL', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "OrderItemKind" AS ENUM ('SERVICE', 'PRODUCT');

-- DropIndex
DROP INDEX "commission_rules_target_key";

-- AlterTable
ALTER TABLE "commission_rules" ADD COLUMN     "product_id" UUID;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "kind" "OrderItemKind" NOT NULL DEFAULT 'SERVICE',
ADD COLUMN     "product_id" UUID,
ALTER COLUMN "service_id" DROP NOT NULL,
ALTER COLUMN "professional_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price_cents" INTEGER NOT NULL,
    "cost_cents" INTEGER NOT NULL DEFAULT 0,
    "stock_quantity" INTEGER NOT NULL DEFAULT 0,
    "min_stock_quantity" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "kind" "StockMovementKind" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_cost_cents" INTEGER NOT NULL,
    "reason" TEXT,
    "order_id" UUID,
    "author_user_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "products_barbershop_id_active_idx" ON "products"("barbershop_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenant_id_key" ON "products"("barbershop_id", "id");

-- CreateIndex
CREATE INDEX "stock_movements_barbershop_id_product_id_occurred_at_idx" ON "stock_movements"("barbershop_id", "product_id", "occurred_at");

-- CreateIndex
-- NULLS NOT DISTINCT (editado à mão): NULL significa "qualquer"; uma regra por combinação.
CREATE UNIQUE INDEX "commission_rules_target_key" ON "commission_rules"("barbershop_id", "membership_id", "service_id", "product_id") NULLS NOT DISTINCT;

-- AddForeignKey
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_tenant_product_fkey" FOREIGN KEY ("barbershop_id", "product_id") REFERENCES "products"("barbershop_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_barbershop_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_product_fkey" FOREIGN KEY ("barbershop_id", "product_id") REFERENCES "products"("barbershop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_order_fkey" FOREIGN KEY ("barbershop_id", "order_id") REFERENCES "orders"("barbershop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_tenant_product_fkey" FOREIGN KEY ("barbershop_id", "product_id") REFERENCES "products"("barbershop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ───────────── SQL manual: regras de estoque garantidas pelo banco (business-rules §7) ─────────────

ALTER TABLE "products"
  ADD CONSTRAINT products_values_check CHECK (price_cents >= 0 AND cost_cents >= 0),
  -- A quantidade em estoque nunca fica negativa, nem sob concorrência.
  ADD CONSTRAINT products_stock_quantity_check CHECK (stock_quantity >= 0),
  ADD CONSTRAINT products_min_stock_check CHECK (min_stock_quantity IS NULL OR min_stock_quantity >= 0);

ALTER TABLE "stock_movements"
  ADD CONSTRAINT stock_movements_quantity_check CHECK (
    quantity <> 0
    AND (kind <> 'ENTRY' OR quantity > 0)
    AND (kind <> 'SALE' OR quantity < 0)
    AND (kind <> 'SALE_REVERSAL' OR quantity > 0)
  ),
  ADD CONSTRAINT stock_movements_cost_check CHECK (unit_cost_cents >= 0),
  -- Venda e estorno apontam para a comanda; ajuste exige motivo.
  ADD CONSTRAINT stock_movements_order_check CHECK (kind NOT IN ('SALE', 'SALE_REVERSAL') OR order_id IS NOT NULL),
  ADD CONSTRAINT stock_movements_reason_check CHECK (kind <> 'ADJUSTMENT' OR length(trim(reason)) > 0);

-- O saldo é a soma das movimentações: cada inserção aplica o delta ao produto. Se o saldo
-- ficaria negativo, o CHECK do produto aborta a movimentação inteira. SECURITY DEFINER
-- porque o usuário da aplicação não tem UPDATE em stock_quantity (abaixo).
CREATE FUNCTION apply_stock_movement() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE products
     SET stock_quantity = stock_quantity + NEW.quantity
   WHERE id = NEW.product_id AND barbershop_id = NEW.barbershop_id;
  RETURN NEW;
END $$;

CREATE TRIGGER stock_movements_apply
  AFTER INSERT ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION apply_stock_movement();

-- Item de comanda: serviço (sempre com profissional) ou produto (profissional opcional).
ALTER TABLE "order_items"
  ADD CONSTRAINT order_items_kind_check CHECK (
    (kind = 'SERVICE' AND service_id IS NOT NULL AND product_id IS NULL AND professional_id IS NOT NULL)
    OR (kind = 'PRODUCT' AND product_id IS NOT NULL AND service_id IS NULL)
  );

-- Regra de comissão: alvo é funcionário, serviço ou produto; nunca serviço e produto juntos.
ALTER TABLE "commission_rules" DROP CONSTRAINT commission_rules_target_check;
ALTER TABLE "commission_rules"
  ADD CONSTRAINT commission_rules_target_check CHECK (
    (membership_id IS NOT NULL OR service_id IS NOT NULL OR product_id IS NOT NULL)
    AND NOT (service_id IS NOT NULL AND product_id IS NOT NULL)
  );

-- RLS (fail-closed) nas tabelas novas com tenant.
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "products"
  USING (barbershop_id = app_current_tenant()) WITH CHECK (barbershop_id = app_current_tenant());
ALTER TABLE "stock_movements" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "stock_movements"
  USING (barbershop_id = app_current_tenant()) WITH CHECK (barbershop_id = app_current_tenant());

-- Privilégios (os default privileges dão tudo à app; aqui restringimos):
-- movimentações são append-only e o saldo só muda pelo trigger.
REVOKE UPDATE, DELETE ON "stock_movements" FROM tanaregua_app;
REVOKE UPDATE, DELETE ON "products" FROM tanaregua_app;
GRANT UPDATE (name, description, price_cents, cost_cents, min_stock_quantity, active, updated_at)
  ON "products" TO tanaregua_app;

-- Permissões novas nos papéis padrão das barbearias que já existem (as novas já nascem com elas).
UPDATE roles SET permissions = array_cat(permissions, ARRAY['products:read', 'products:manage'])
 WHERE is_system AND key IN ('owner', 'receptionist') AND NOT ('products:read' = ANY (permissions));
UPDATE roles SET permissions = array_append(permissions, 'products:read')
 WHERE is_system AND key = 'professional' AND NOT ('products:read' = ANY (permissions));
