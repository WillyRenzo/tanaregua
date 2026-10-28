-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('EMAIL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "MarketingMessageKind" AS ENUM ('BIRTHDAY', 'CAMPAIGN');

-- CreateEnum
CREATE TYPE "MarketingMessageStatus" AS ENUM ('PENDING', 'SENT', 'SKIPPED', 'FAILED');

-- AlterTable
ALTER TABLE "barbershops" ADD COLUMN     "birthday_email_text" TEXT,
ADD COLUMN     "birthday_messages_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "birthday_whatsapp_template" JSONB;

-- CreateTable
CREATE TABLE "whatsapp_connections" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "phone_number_id" TEXT NOT NULL,
    "business_account_id" TEXT NOT NULL,
    "display_phone_number" TEXT NOT NULL,
    "verified_name" TEXT NOT NULL,
    "access_token_sealed" TEXT NOT NULL,
    "connected_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "whatsapp_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "audience" JSONB NOT NULL,
    "email_subject" TEXT,
    "email_body" TEXT,
    "whatsapp_template" JSONB,
    "recipient_count" INTEGER NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_messages" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "kind" "MarketingMessageKind" NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "status" "MarketingMessageStatus" NOT NULL DEFAULT 'PENDING',
    "campaign_id" UUID,
    "birthday_year" INTEGER,
    "outcome" TEXT,
    "provider_message_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ,

    CONSTRAINT "marketing_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_connections_barbershop_id_key" ON "whatsapp_connections"("barbershop_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_connections_tenant_id_key" ON "whatsapp_connections"("barbershop_id", "id");

-- CreateIndex
CREATE INDEX "campaigns_barbershop_id_created_at_idx" ON "campaigns"("barbershop_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "campaigns_tenant_id_key" ON "campaigns"("barbershop_id", "id");

-- CreateIndex
CREATE INDEX "marketing_messages_barbershop_id_campaign_id_idx" ON "marketing_messages"("barbershop_id", "campaign_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_messages_tenant_id_key" ON "marketing_messages"("barbershop_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_messages_birthday_key" ON "marketing_messages"("barbershop_id", "client_id", "birthday_year");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_messages_campaign_client_key" ON "marketing_messages"("campaign_id", "client_id");

-- AddForeignKey
ALTER TABLE "whatsapp_connections" ADD CONSTRAINT "whatsapp_connections_barbershop_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_barbershop_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_messages" ADD CONSTRAINT "marketing_messages_tenant_client_fkey" FOREIGN KEY ("barbershop_id", "client_id") REFERENCES "clients"("barbershop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_messages" ADD CONSTRAINT "marketing_messages_tenant_campaign_fkey" FOREIGN KEY ("barbershop_id", "campaign_id") REFERENCES "campaigns"("barbershop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ───────────── SQL manual: aniversários e campanhas (business-rules §9) ─────────────

ALTER TABLE "barbershops"
  ADD CONSTRAINT barbershops_birthday_email_text_check CHECK (char_length(birthday_email_text) <= 1000);

-- Campanha só existe com conteúdo do canal escolhido e com pelo menos um destinatário.
ALTER TABLE "campaigns"
  ADD CONSTRAINT campaigns_content_check CHECK (
    recipient_count >= 1
    AND (channel::text <> 'EMAIL' OR (email_subject IS NOT NULL AND email_body IS NOT NULL))
    AND (channel::text <> 'WHATSAPP' OR whatsapp_template IS NOT NULL)
  );

-- Aniversário: um por cliente por ano (índice único) e nunca ligado a campanha;
-- campanha: sempre ligada à campanha. Enviada <=> tem data de envio.
ALTER TABLE "marketing_messages"
  ADD CONSTRAINT marketing_messages_kind_check CHECK (
    (kind::text = 'BIRTHDAY' AND birthday_year IS NOT NULL AND campaign_id IS NULL)
    OR (kind::text = 'CAMPAIGN' AND campaign_id IS NOT NULL AND birthday_year IS NULL)
  ),
  ADD CONSTRAINT marketing_messages_sent_check CHECK ((status::text = 'SENT') = (sent_at IS NOT NULL));

-- RLS (fail-closed) nas tabelas novas com tenant.
ALTER TABLE "whatsapp_connections" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "whatsapp_connections"
  USING (barbershop_id = app_current_tenant()) WITH CHECK (barbershop_id = app_current_tenant());
ALTER TABLE "campaigns" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "campaigns"
  USING (barbershop_id = app_current_tenant()) WITH CHECK (barbershop_id = app_current_tenant());
ALTER TABLE "marketing_messages" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "marketing_messages"
  USING (barbershop_id = app_current_tenant()) WITH CHECK (barbershop_id = app_current_tenant());

-- Privilégios: campanha é imutável e o histórico de mensagens nunca é apagado (só o status muda).
REVOKE UPDATE, DELETE ON "campaigns" FROM tanaregua_app;
REVOKE DELETE ON "marketing_messages" FROM tanaregua_app;

-- Permissão nova nos papéis padrão das barbearias que já existem.
UPDATE roles SET permissions = array_append(permissions, 'campaigns:manage')
 WHERE is_system AND key IN ('owner', 'receptionist') AND NOT ('campaigns:manage' = ANY (permissions));
