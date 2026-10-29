import { z } from 'zod';

/** Credenciais da conta da barbearia no gateway (no Mercado Pago, as de produção da aplicação dela). */
export const connectPaymentAccountSchema = z
  .strictObject({
    accessToken: z.string().trim().min(16).max(512),
    webhookSecret: z.string().trim().min(16).max(512),
  })
  .meta({
    id: 'ConnectPaymentAccountInput',
    example: {
      accessToken: 'APP_USR-0000000000000000-000000',
      webhookSecret: 'segredo-de-webhooks-da-conta',
    },
  });
export type ConnectPaymentAccountInput = z.infer<typeof connectPaymentAccountSchema>;

/**
 * Como a reserva online é paga (business-rules §5). O sinal vai em basis points, entre 1% e
 * 99% (100% é o total), e só com `amount = DEPOSIT`.
 */
export const onlinePaymentSettingsSchema = z
  .strictObject({
    mode: z.enum(['OFF', 'OPTIONAL', 'REQUIRED']),
    amount: z.enum(['FULL', 'DEPOSIT']),
    depositBps: z.int().min(100).max(9900).nullable(),
  })
  .refine((settings) => (settings.amount === 'DEPOSIT') === (settings.depositBps !== null), {
    message: 'Informe o percentual do sinal só quando o valor cobrado for o sinal.',
    path: ['depositBps'],
  })
  .meta({
    id: 'OnlinePaymentSettingsInput',
    example: { mode: 'OPTIONAL', amount: 'DEPOSIT', depositBps: 3000 },
  });
export type OnlinePaymentSettingsInput = z.infer<typeof onlinePaymentSettingsSchema>;
