import { z } from 'zod';

export const messageChannelSchema = z.enum(['EMAIL', 'WHATSAPP']);
export type MessageChannel = z.infer<typeof messageChannelSchema>;

/** Filtros de público de uma campanha (business-rules §9). */
export const audienceSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('all') }),
    /** Já veio e não volta há pelo menos N dias. */
    z.strictObject({ kind: z.literal('inactive'), days: z.int().min(15).max(730) }),
    z.strictObject({ kind: z.literal('birthday-month'), month: z.int().min(1).max(12) }),
    /** Fez o serviço nos últimos N dias. */
    z.strictObject({ kind: z.literal('service'), serviceId: z.uuid(), days: z.int().min(1).max(730) }),
  ])
  .meta({ example: { kind: 'inactive', days: 45 } });
export type Audience = z.infer<typeof audienceSchema>;

/** De onde vem o valor de cada variável do modelo do WhatsApp. */
export const templateParameterSourceSchema = z.enum(['client_first_name', 'barbershop_name']);
export type TemplateParameterSource = z.infer<typeof templateParameterSourceSchema>;

/**
 * Modelo aprovado pela Meta e o preenchimento das variáveis do corpo, na ordem do modelo.
 * `name` da variável: posição ("1") ou nome ("nome"), como no modelo.
 */
export const templateConfigSchema = z
  .strictObject({
    name: z.string().regex(/^[a-z0-9_]{1,512}$/, 'Nome de modelo inválido.'),
    language: z.string().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/, 'Idioma inválido (ex.: pt_BR).'),
    parameters: z
      .array(
        z.strictObject({
          name: z.string().regex(/^[a-zA-Z0-9_]{1,100}$/),
          source: templateParameterSourceSchema,
        }),
      )
      .max(10),
  })
  .meta({
    example: {
      name: 'feliz_aniversario',
      language: 'pt_BR',
      parameters: [
        { name: '1', source: 'client_first_name' },
        { name: '2', source: 'barbershop_name' },
      ],
    },
  });
export type TemplateConfig = z.infer<typeof templateConfigSchema>;

/** IDs da Meta são numéricos; validar evita que virem outro caminho na URL da Graph API. */
const metaIdSchema = z
  .string()
  .trim()
  .regex(/^\d{5,30}$/, 'Use o ID numérico mostrado no painel da Meta.');

export const connectWhatsAppSchema = z
  .strictObject({
    phoneNumberId: metaIdSchema,
    businessAccountId: metaIdSchema,
    accessToken: z.string().trim().min(20, 'Token muito curto.').max(1000),
  })
  .meta({
    example: { phoneNumberId: '106540352242922', businessAccountId: '102290129340398', accessToken: 'EAAG…' },
  });
export type ConnectWhatsAppInput = z.infer<typeof connectWhatsAppSchema>;

export const birthdaySettingsInputSchema = z.strictObject({
  enabled: z.boolean(),
  /** Texto do e-mail ({nome}, {barbearia}); null volta para o texto padrão. */
  emailText: z.string().trim().min(10).max(1000).nullable(),
  /** null = aniversário só por e-mail. */
  whatsappTemplate: templateConfigSchema.nullable(),
});
export type BirthdaySettingsInput = z.infer<typeof birthdaySettingsInputSchema>;

export const listBirthdaysSchema = z.strictObject({ month: z.coerce.number().int().min(1).max(12) });
export type ListBirthdaysQuery = z.infer<typeof listBirthdaysSchema>;

export const previewCampaignSchema = z.strictObject({
  channel: messageChannelSchema,
  audience: audienceSchema,
});
export type PreviewCampaignInput = z.infer<typeof previewCampaignSchema>;

export const createCampaignSchema = previewCampaignSchema
  .extend({
    name: z.string().trim().min(3).max(100),
    email: z
      .strictObject({
        subject: z.string().trim().min(3).max(150),
        body: z.string().trim().min(10).max(2000),
      })
      .optional(),
    whatsapp: templateConfigSchema.optional(),
    /**
     * Quantos clientes a prévia mostrou. Se o público mudou desde a prévia, a campanha não
     * é criada (409): a confirmação vale para aquele número.
     */
    confirmRecipients: z.int().min(1),
  })
  .refine((input) => input.channel !== 'EMAIL' || input.email, {
    message: 'Informe o assunto e o texto do e-mail.',
    path: ['email'],
  })
  .refine((input) => input.channel !== 'WHATSAPP' || input.whatsapp, {
    message: 'Escolha o modelo aprovado do WhatsApp.',
    path: ['whatsapp'],
  });
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
