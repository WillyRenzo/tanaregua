-- CreateEnum
CREATE TYPE "CheckoutStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELED');

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "amount_cents" INTEGER,
ADD COLUMN     "gateway_provider" TEXT,
ADD COLUMN     "gateway_subscription_id" TEXT,
ADD COLUMN     "interval" "BillingInterval",
ADD COLUMN     "scheduled_amount_at" TIMESTAMPTZ,
ADD COLUMN     "scheduled_amount_cents" INTEGER;

-- CreateTable
CREATE TABLE "subscription_checkouts" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "interval" "BillingInterval" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "gateway_provider" TEXT NOT NULL,
    "gateway_subscription_id" TEXT NOT NULL,
    "checkout_url" TEXT NOT NULL,
    "status" "CheckoutStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "subscription_checkouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_webhook_events" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "subscription_checkouts_barbershop_id_status_idx" ON "subscription_checkouts"("barbershop_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_checkouts_barbershop_id_id_key" ON "subscription_checkouts"("barbershop_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_checkouts_gateway_provider_gateway_subscriptio_key" ON "subscription_checkouts"("gateway_provider", "gateway_subscription_id");

-- CreateIndex
CREATE UNIQUE INDEX "billing_webhook_events_provider_event_id_key" ON "billing_webhook_events"("provider", "event_id");

-- CreateIndex
CREATE INDEX "subscriptions_plan_id_interval_idx" ON "subscriptions"("plan_id", "interval");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_gateway_provider_gateway_subscription_id_key" ON "subscriptions"("gateway_provider", "gateway_subscription_id");

-- AddForeignKey
ALTER TABLE "subscription_checkouts" ADD CONSTRAINT "subscription_checkouts_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_checkouts" ADD CONSTRAINT "subscription_checkouts_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;





-- ───────────── SQL manual: cobrança recorrente da assinatura (business-rules §5 e §12) ─────────────

-- Valores sempre positivos; os campos do gateway andam juntos (todos ou nenhum), e o
-- reajuste agendado tem valor e data.
ALTER TABLE "subscriptions"
  ADD CONSTRAINT subscriptions_amount_positive CHECK (amount_cents IS NULL OR amount_cents > 0),
  ADD CONSTRAINT subscriptions_scheduled_amount_positive CHECK (scheduled_amount_cents IS NULL OR scheduled_amount_cents > 0),
  ADD CONSTRAINT subscriptions_gateway_complete CHECK (
    (gateway_provider IS NULL AND gateway_subscription_id IS NULL AND interval IS NULL AND amount_cents IS NULL)
    OR (gateway_provider IS NOT NULL AND gateway_subscription_id IS NOT NULL AND interval IS NOT NULL AND amount_cents IS NOT NULL)
  ),
  ADD CONSTRAINT subscriptions_scheduled_complete CHECK ((scheduled_amount_cents IS NULL) = (scheduled_amount_at IS NULL));
ALTER TABLE "subscription_checkouts"
  ADD CONSTRAINT subscription_checkouts_amount_positive CHECK (amount_cents > 0);

-- RLS (fail-closed) no checkout, que pertence à barbearia.
ALTER TABLE "subscription_checkouts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "subscription_checkouts"
  USING (barbershop_id = app_current_tenant()) WITH CHECK (barbershop_id = app_current_tenant());

-- A notificação do gateway chega sem tenant (só o id da assinatura lá). Esta função devolve
-- só a barbearia dona daquele id, para a aplicação abrir a transação no tenant certo; não
-- expõe nenhum outro dado. SECURITY DEFINER porque o RLS esconderia a linha sem tenant.
CREATE FUNCTION billing_tenant_of(p_provider text, p_gateway_subscription_id text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT barbershop_id FROM (
    SELECT barbershop_id FROM subscriptions
     WHERE gateway_provider = p_provider AND gateway_subscription_id = p_gateway_subscription_id
    UNION ALL
    SELECT barbershop_id FROM subscription_checkouts
     WHERE gateway_provider = p_provider AND gateway_subscription_id = p_gateway_subscription_id
  ) found LIMIT 1
$$;

-- Assinaturas pagas num plano e ciclo, para a administração não tirar de venda um ciclo que
-- ainda tem assinante (§12). Só a administração da plataforma chama; o resto recebe erro.
CREATE FUNCTION plan_cycle_subscriber_count(p_plan_id uuid, p_interval "BillingInterval") RETURNS integer
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF app_current_platform_admin() IS NULL THEN
    RAISE EXCEPTION 'plan_cycle_subscriber_count: só a administração da plataforma' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT count(*) FROM subscriptions
           WHERE plan_id = p_plan_id AND interval = p_interval
             AND gateway_subscription_id IS NOT NULL AND status <> 'CANCELED');
END $$;

-- Reajuste de um plano num ciclo (§12): vale para todas as assinaturas pagas daquele plano e
-- ciclo, com aviso de 30 dias. Agenda o novo valor nas que pagam outro valor e devolve quais
-- foram avisadas agora (a aplicação manda o e-mail e repassa ao gateway na data). Quem já paga
-- o valor novo perde um reajuste agendado antes; quem já tem este valor agendado não é avisado
-- de novo. Só a administração da plataforma chama.
CREATE FUNCTION schedule_plan_price_change(
  p_plan_id uuid, p_interval "BillingInterval", p_amount_cents integer, p_effective_at timestamptz
) RETURNS TABLE (barbershop_id uuid, subscription_id uuid)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF app_current_platform_admin() IS NULL THEN
    RAISE EXCEPTION 'schedule_plan_price_change: só a administração da plataforma' USING ERRCODE = '42501';
  END IF;

  UPDATE subscriptions s
     SET scheduled_amount_cents = NULL, scheduled_amount_at = NULL, updated_at = now()
   WHERE s.plan_id = p_plan_id AND s.interval = p_interval
     AND s.gateway_subscription_id IS NOT NULL AND s.status <> 'CANCELED'
     AND s.amount_cents = p_amount_cents AND s.scheduled_amount_cents IS NOT NULL;

  RETURN QUERY
  UPDATE subscriptions s
     SET scheduled_amount_cents = p_amount_cents, scheduled_amount_at = p_effective_at, updated_at = now()
   WHERE s.plan_id = p_plan_id AND s.interval = p_interval
     AND s.gateway_subscription_id IS NOT NULL AND s.status <> 'CANCELED'
     AND s.amount_cents <> p_amount_cents
     AND s.scheduled_amount_cents IS DISTINCT FROM p_amount_cents
  RETURNING s.barbershop_id, s.id;
END $$;

REVOKE ALL ON FUNCTION billing_tenant_of(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION plan_cycle_subscriber_count(uuid, "BillingInterval") FROM PUBLIC;
REVOKE ALL ON FUNCTION schedule_plan_price_change(uuid, "BillingInterval", integer, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION billing_tenant_of(text, text) TO tanaregua_app;
GRANT EXECUTE ON FUNCTION plan_cycle_subscriber_count(uuid, "BillingInterval") TO tanaregua_app;
GRANT EXECUTE ON FUNCTION schedule_plan_price_change(uuid, "BillingInterval", integer, timestamptz) TO tanaregua_app;

-- Privilégios: checkout e notificações recebidas nunca são apagados pela aplicação; a
-- notificação recebida também não muda.
REVOKE DELETE ON "subscription_checkouts" FROM tanaregua_app;
REVOKE UPDATE, DELETE ON "billing_webhook_events" FROM tanaregua_app;

-- Permissão nova no papel de dono das barbearias que já existem: quem assina e paga é o dono.
UPDATE roles SET permissions = array_append(permissions, 'subscription:manage')
 WHERE is_system AND key = 'owner' AND NOT ('subscription:manage' = ANY (permissions));
