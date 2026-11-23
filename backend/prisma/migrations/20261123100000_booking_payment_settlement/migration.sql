-- CreateEnum
CREATE TYPE "BookingPaymentSettlement" AS ENUM ('ORDER', 'RETAINED');

-- CreateEnum
CREATE TYPE "BookingRefundKind" AS ENUM ('DIFFERENCE', 'MANUAL');

-- CreateEnum
CREATE TYPE "BookingRefundStatus" AS ENUM ('PENDING', 'DONE', 'FAILED');

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'ONLINE';

-- AlterTable
ALTER TABLE "booking_payments" ADD COLUMN     "order_id" UUID,
ADD COLUMN     "settled_at" TIMESTAMPTZ,
ADD COLUMN     "settled_cents" INTEGER,
ADD COLUMN     "settlement" "BookingPaymentSettlement";

-- AlterTable
ALTER TABLE "cash_entries" ADD COLUMN     "booking_payment_id" UUID,
ALTER COLUMN "order_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "online_paid_cents" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "booking_payment_refunds" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "booking_payment_id" UUID NOT NULL,
    "kind" "BookingRefundKind" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "status" "BookingRefundStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "requested_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refunded_at" TIMESTAMPTZ,

    CONSTRAINT "booking_payment_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "booking_payment_refunds_barbershop_id_booking_payment_id_idx" ON "booking_payment_refunds"("barbershop_id", "booking_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_payment_refunds_tenant_id_key" ON "booking_payment_refunds"("barbershop_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_payment_refunds_booking_payment_id_kind_key" ON "booking_payment_refunds"("booking_payment_id", "kind");

-- CreateIndex
CREATE INDEX "cash_entries_barbershop_id_booking_payment_id_idx" ON "cash_entries"("barbershop_id", "booking_payment_id");

-- AddForeignKey
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_tenant_booking_payment_fkey" FOREIGN KEY ("barbershop_id", "booking_payment_id") REFERENCES "booking_payments"("barbershop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_payments" ADD CONSTRAINT "booking_payments_tenant_order_fkey" FOREIGN KEY ("barbershop_id", "order_id") REFERENCES "orders"("barbershop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_payment_refunds" ADD CONSTRAINT "booking_payment_refunds_tenant_payment_fkey" FOREIGN KEY ("barbershop_id", "booking_payment_id") REFERENCES "booking_payments"("barbershop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ---------------------------------------------------------------------------
-- SQL manual: pagamento online na comanda e no caixa (business-rules §5, entrega 3)
-- ---------------------------------------------------------------------------

-- Todo lançamento de caixa vem de uma comanda, de um pagamento de reserva ou dos dois.
ALTER TABLE "cash_entries" ADD CONSTRAINT cash_entries_has_source
  CHECK (order_id IS NOT NULL OR booking_payment_id IS NOT NULL);

ALTER TABLE "orders" ADD CONSTRAINT orders_online_paid_not_negative CHECK (online_paid_cents >= 0);

-- Liquidado = tem data e valor; na comanda, tem a comanda; nunca mais do que foi pago.
ALTER TABLE "booking_payments" ADD CONSTRAINT booking_payments_settlement_valid
  CHECK ((settlement IS NULL) = (settled_at IS NULL)
     AND (settlement IS NULL) = (settled_cents IS NULL)
     AND (settlement IS DISTINCT FROM 'ORDER' OR order_id IS NOT NULL)
     AND (settled_cents IS NULL OR settled_cents BETWEEN 0 AND amount_cents));

ALTER TABLE "booking_payment_refunds" ADD CONSTRAINT booking_payment_refunds_amount_positive
  CHECK (amount_cents > 0);

ALTER TABLE "booking_payment_refunds" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "booking_payment_refunds"
  USING (barbershop_id = app_current_tenant()) WITH CHECK (barbershop_id = app_current_tenant());

-- Reembolso é histórico de dinheiro: a aplicação muda só a situação, nunca apaga.
REVOKE DELETE ON "booking_payment_refunds" FROM tanaregua_app;
