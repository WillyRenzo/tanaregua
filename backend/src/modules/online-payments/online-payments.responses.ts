import { z } from 'zod';

/** Configuração do pagamento online da barbearia, para o painel (business-rules §5). */
export const onlinePaymentViewSchema = z
  .object({
    /** O pagamento online está ligado nesta instalação (há gateway configurado). */
    available: z.boolean(),
    /** Conta conectada, conferida no gateway. As credenciais nunca voltam ao navegador. */
    account: z
      .object({ provider: z.string(), accountId: z.string(), accountName: z.string(), connectedAt: z.date() })
      .nullable(),
    settings: z.object({
      mode: z.enum(['OFF', 'OPTIONAL', 'REQUIRED']),
      amount: z.enum(['FULL', 'DEPOSIT']),
      depositBps: z.int().nullable(),
    }),
  })
  .meta({ id: 'OnlinePayment' });
export type OnlinePaymentView = z.infer<typeof onlinePaymentViewSchema>;
