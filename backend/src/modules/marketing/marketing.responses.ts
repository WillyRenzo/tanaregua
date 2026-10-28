import { z } from 'zod';
import { audienceSchema, messageChannelSchema, templateConfigSchema } from './marketing.schemas.js';

/** O token nunca sai da API: só os dados conferidos na Meta. */
export const whatsappConnectionSchema = z
  .object({
    connection: z
      .object({
        phoneNumberId: z.string(),
        businessAccountId: z.string(),
        displayPhoneNumber: z.string(),
        verifiedName: z.string(),
        connectedAt: z.date(),
      })
      .nullable(),
  })
  .meta({ id: 'WhatsAppConnection' });
export type WhatsAppConnectionView = z.infer<typeof whatsappConnectionSchema>;

export const whatsappTemplateSchema = z
  .object({
    name: z.string(),
    language: z.string(),
    category: z.string(),
    body: z.string(),
    parameters: z.array(z.string()),
    supported: z.boolean(),
  })
  .meta({ id: 'WhatsAppTemplate' });

export const birthdaySettingsSchema = z
  .object({
    enabled: z.boolean(),
    /** null = usa o texto padrão. */
    emailText: z.string().nullable(),
    defaultEmailText: z.string(),
    whatsappTemplate: templateConfigSchema.nullable(),
    whatsappConnected: z.boolean(),
    /** Hora local em que as mensagens do dia saem. */
    sendHour: z.int(),
  })
  .meta({ id: 'BirthdaySettings' });
export type BirthdaySettingsView = z.infer<typeof birthdaySettingsSchema>;

export const messageStatusSchema = z.enum(['PENDING', 'SENT', 'SKIPPED', 'FAILED']);

export const birthdayEntrySchema = z
  .object({
    clientId: z.uuid(),
    name: z.string(),
    day: z.int(),
    month: z.int(),
    /** Canais consentidos: sem nenhum, o aniversário é só lembrete interno. */
    consents: z.object({ email: z.boolean(), whatsapp: z.boolean() }),
    /** Mensagem de aniversário deste ano, se houver. */
    message: z
      .object({
        channel: messageChannelSchema,
        status: messageStatusSchema,
        outcome: z.string().nullable(),
        sentAt: z.date().nullable(),
      })
      .nullable(),
  })
  .meta({ id: 'BirthdayEntry' });
export type BirthdayEntry = z.infer<typeof birthdayEntrySchema>;

export const campaignPreviewSchema = z
  .object({
    /** Clientes que atendem ao filtro. */
    matched: z.int(),
    /** Desses, os que consentiram no canal e têm contato nele: quem vai receber. */
    recipients: z.int(),
    sample: z.array(z.object({ id: z.uuid(), name: z.string() })),
  })
  .meta({ id: 'CampaignPreview' });
export type CampaignPreview = z.infer<typeof campaignPreviewSchema>;

export const campaignSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    channel: messageChannelSchema,
    audience: audienceSchema,
    emailSubject: z.string().nullable(),
    whatsappTemplateName: z.string().nullable(),
    recipientCount: z.int(),
    createdAt: z.date(),
    counts: z.object({ pending: z.int(), sent: z.int(), skipped: z.int(), failed: z.int() }),
  })
  .meta({ id: 'Campaign' });
export type CampaignView = z.infer<typeof campaignSchema>;

export const campaignDetailSchema = campaignSchema
  .extend({
    emailBody: z.string().nullable(),
    whatsappTemplate: templateConfigSchema.nullable(),
    messages: z.array(
      z.object({
        clientId: z.uuid(),
        clientName: z.string(),
        status: messageStatusSchema,
        outcome: z.string().nullable(),
        sentAt: z.date().nullable(),
      }),
    ),
  })
  .meta({ id: 'CampaignDetail' });
export type CampaignDetailView = z.infer<typeof campaignDetailSchema>;
