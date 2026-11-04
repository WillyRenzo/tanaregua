-- CreateEnum
CREATE TYPE "BookingPaymentStatus" AS ENUM ('PENDING', 'PAID', 'REFUND_PENDING', 'REFUNDED', 'REFUND_FAILED', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "booking_payments" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "status" "BookingPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "hold_until" TIMESTAMPTZ,
    "checkout_id" TEXT,
    "checkout_url" TEXT,
    "checkout_expires_at" TIMESTAMPTZ,
    "gateway_payment_id" TEXT,
    "paid_at" TIMESTAMPTZ,
    "refund_reason" TEXT,
    "refunded_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "booking_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_payment_webhook_events" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "event_id" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_payment_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "booking_payments_tenant_appointment_key" ON "booking_payments"("barbershop_id", "appointment_id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_payments_tenant_id_key" ON "booking_payments"("barbershop_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_payments_provider_gateway_payment_id_key" ON "booking_payments"("provider", "gateway_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_payment_webhook_events_barbershop_id_event_id_key" ON "booking_payment_webhook_events"("barbershop_id", "event_id");

-- AddForeignKey
ALTER TABLE "booking_payments" ADD CONSTRAINT "booking_payments_tenant_appointment_fkey" FOREIGN KEY ("barbershop_id", "appointment_id") REFERENCES "appointments"("barbershop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_payment_webhook_events" ADD CONSTRAINT "booking_payment_webhook_events_barbershop_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- ---------------------------------------------------------------------------
-- SQL manual: pagamento online da reserva (business-rules §5)
-- ---------------------------------------------------------------------------

ALTER TABLE "booking_payments" ADD CONSTRAINT booking_payments_amount_positive CHECK (amount_cents > 0);
-- Pago (ou reembolsado) sempre tem o pagamento do gateway que o comprova.
ALTER TABLE "booking_payments" ADD CONSTRAINT booking_payments_paid_has_gateway_payment
  CHECK (status NOT IN ('PAID', 'REFUND_PENDING', 'REFUNDED', 'REFUND_FAILED')
         OR (gateway_payment_id IS NOT NULL AND paid_at IS NOT NULL));

ALTER TABLE "booking_payments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "booking_payments"
  USING (barbershop_id = app_current_tenant()) WITH CHECK (barbershop_id = app_current_tenant());

ALTER TABLE "booking_payment_webhook_events" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "booking_payment_webhook_events"
  USING (barbershop_id = app_current_tenant()) WITH CHECK (barbershop_id = app_current_tenant());

-- A notificação do gateway chega na URL da conta, sem tenant. Esta função devolve só a
-- barbearia dona daquela chave, para a aplicação abrir a transação no tenant certo e conferir
-- a assinatura com o segredo dela. SECURITY DEFINER porque o RLS esconderia a linha sem tenant.
CREATE FUNCTION payment_account_tenant_of(p_webhook_key text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT barbershop_id FROM payment_accounts WHERE webhook_key = p_webhook_key
$$;
REVOKE ALL ON FUNCTION payment_account_tenant_of(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION payment_account_tenant_of(text) TO tanaregua_app;

-- Privilégios: o pagamento de uma reserva é histórico de dinheiro e nunca é apagado pela
-- aplicação; a notificação recebida também não muda.
REVOKE DELETE ON "booking_payments" FROM tanaregua_app;
REVOKE UPDATE, DELETE ON "booking_payment_webhook_events" FROM tanaregua_app;
