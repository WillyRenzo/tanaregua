-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "paid_through" TIMESTAMPTZ,
ADD COLUMN     "scheduled_plan_at" TIMESTAMPTZ,
ADD COLUMN     "scheduled_plan_id" UUID,
ADD COLUMN     "trial_ends_at" TIMESTAMPTZ;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_scheduled_plan_fkey" FOREIGN KEY ("scheduled_plan_id") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- SQL manual: ciclo de vida da assinatura (business-rules §12, decisões de 30/10/2026)
-- ---------------------------------------------------------------------------

-- O teste grátis tem fim; o downgrade agendado tem plano e data; período pago só com gateway.
ALTER TABLE "subscriptions" ADD CONSTRAINT subscriptions_trial_complete
  CHECK ((status = 'TRIALING') = (trial_ends_at IS NOT NULL));
ALTER TABLE "subscriptions" ADD CONSTRAINT subscriptions_scheduled_plan_complete
  CHECK ((scheduled_plan_id IS NULL) = (scheduled_plan_at IS NULL));
ALTER TABLE "subscriptions" ADD CONSTRAINT subscriptions_paid_through_needs_gateway
  CHECK (paid_through IS NULL OR gateway_subscription_id IS NOT NULL);

-- Quem chega entra em teste grátis de 14 dias no plano mais completo (o Premium).
UPDATE "plans" SET is_default = false WHERE is_default AND key <> 'premium';
UPDATE "plans" SET is_default = true WHERE key = 'premium';

-- Barbearias que já existiam sem assinatura paga ganham o mesmo teste, a partir de agora.
UPDATE "subscriptions"
   SET plan_id = (SELECT id FROM "plans" WHERE is_default),
       status = 'TRIALING',
       trial_ends_at = now() + interval '14 days',
       updated_at = now()
 WHERE gateway_subscription_id IS NULL;

-- Assinaturas pagas anteriores (só desenvolvimento): o período pago conta de agora.
UPDATE "subscriptions"
   SET paid_through = now() + CASE interval WHEN 'YEARLY' THEN interval '1 year' ELSE interval '1 month' END
 WHERE gateway_subscription_id IS NOT NULL AND status <> 'CANCELED';

-- O plano cobrado de uma assinatura com downgrade agendado já é o novo (o gateway cobra o
-- valor dele na próxima cobrança): o reajuste e a contagem de assinantes olham os dois.
CREATE OR REPLACE FUNCTION plan_cycle_subscriber_count(p_plan_id uuid, p_interval "BillingInterval") RETURNS integer
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF app_current_platform_admin() IS NULL THEN
    RAISE EXCEPTION 'plan_cycle_subscriber_count: só a administração da plataforma' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT count(*) FROM subscriptions
           WHERE (plan_id = p_plan_id OR scheduled_plan_id = p_plan_id) AND interval = p_interval
             AND gateway_subscription_id IS NOT NULL AND status <> 'CANCELED');
END $$;

CREATE OR REPLACE FUNCTION schedule_plan_price_change(
  p_plan_id uuid, p_interval "BillingInterval", p_amount_cents integer, p_effective_at timestamptz
) RETURNS TABLE (barbershop_id uuid, subscription_id uuid)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF app_current_platform_admin() IS NULL THEN
    RAISE EXCEPTION 'schedule_plan_price_change: só a administração da plataforma' USING ERRCODE = '42501';
  END IF;

  UPDATE subscriptions s
     SET scheduled_amount_cents = NULL, scheduled_amount_at = NULL, updated_at = now()
   WHERE coalesce(s.scheduled_plan_id, s.plan_id) = p_plan_id AND s.interval = p_interval
     AND s.gateway_subscription_id IS NOT NULL AND s.status <> 'CANCELED'
     AND s.amount_cents = p_amount_cents AND s.scheduled_amount_cents IS NOT NULL;

  RETURN QUERY
  UPDATE subscriptions s
     SET scheduled_amount_cents = p_amount_cents, scheduled_amount_at = p_effective_at, updated_at = now()
   WHERE coalesce(s.scheduled_plan_id, s.plan_id) = p_plan_id AND s.interval = p_interval
     AND s.gateway_subscription_id IS NOT NULL AND s.status <> 'CANCELED'
     AND s.amount_cents <> p_amount_cents
     AND s.scheduled_amount_cents IS DISTINCT FROM p_amount_cents
  RETURNING s.barbershop_id, s.id;
END $$;
