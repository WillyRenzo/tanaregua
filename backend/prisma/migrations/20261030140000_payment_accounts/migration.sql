-- CreateEnum
CREATE TYPE "OnlinePaymentMode" AS ENUM ('OFF', 'OPTIONAL', 'REQUIRED');

-- CreateEnum
CREATE TYPE "OnlinePaymentAmount" AS ENUM ('FULL', 'DEPOSIT');

-- CreateTable
CREATE TABLE "payment_accounts" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "external_account_id" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "access_token_sealed" TEXT NOT NULL,
    "webhook_secret_sealed" TEXT NOT NULL,
    "webhook_key" TEXT NOT NULL,
    "mode" "OnlinePaymentMode" NOT NULL DEFAULT 'OFF',
    "amount" "OnlinePaymentAmount" NOT NULL DEFAULT 'FULL',
    "deposit_bps" INTEGER,
    "connected_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payment_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_accounts_barbershop_id_key" ON "payment_accounts"("barbershop_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_accounts_webhook_key_key" ON "payment_accounts"("webhook_key");

-- CreateIndex
CREATE UNIQUE INDEX "payment_accounts_tenant_id_key" ON "payment_accounts"("barbershop_id", "id");

-- AddForeignKey
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_barbershop_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- SQL manual: conta da barbearia no gateway de pagamento (business-rules §5)
-- ---------------------------------------------------------------------------

-- Sinal entre 1% e 99% (100% é o total), e só quando o valor escolhido é o sinal.
ALTER TABLE "payment_accounts" ADD CONSTRAINT payment_accounts_deposit_valid
  CHECK ((amount = 'DEPOSIT') = (deposit_bps IS NOT NULL) AND (deposit_bps IS NULL OR deposit_bps BETWEEN 100 AND 9900));

ALTER TABLE "payment_accounts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "payment_accounts"
  USING (barbershop_id = app_current_tenant()) WITH CHECK (barbershop_id = app_current_tenant());
