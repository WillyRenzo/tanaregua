-- Consentimento de marketing por canal (business-rules §9): a mensagem só sai pelo canal
-- que o cliente aceitou. Cada canal guarda a data da concessão; NULL = sem consentimento.
ALTER TABLE "clients" ADD COLUMN "email_consent_at" TIMESTAMPTZ,
ADD COLUMN "whatsapp_consent_at" TIMESTAMPTZ;

-- Preserva o consentimento já registrado no canal único. SMS não é um canal do produto
-- (só e-mail e WhatsApp): esse consentimento não é migrado, o que só deixa de enviar.
UPDATE "clients" SET "email_consent_at" = "marketing_consent_at"
 WHERE "marketing_consent_channel" = 'email' AND "marketing_consent_at" IS NOT NULL;
UPDATE "clients" SET "whatsapp_consent_at" = "marketing_consent_at"
 WHERE "marketing_consent_channel" = 'whatsapp' AND "marketing_consent_at" IS NOT NULL;

ALTER TABLE "clients" DROP COLUMN "marketing_consent_at",
DROP COLUMN "marketing_consent_channel";
