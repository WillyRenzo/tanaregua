import { z } from 'zod';
import { PAYMENT_METHODS } from '../finance/finance.service.js';

const MAX_CENTS = 100_000_00;

const packageItemsSchema = z
  .array(z.strictObject({ serviceId: z.uuid(), quantity: z.number().int().min(1).max(100) }))
  .min(1, 'Inclua ao menos um serviço.')
  .max(10)
  .refine((items) => new Set(items.map((item) => item.serviceId)).size === items.length, 'Serviço repetido.');

/** Pacote à venda: sessões por serviço (ex.: 4 cortes + 2 barbas), preço e validade. */
export const createPackageSchema = z
  .strictObject({
    name: z.string().trim().min(2).max(100),
    description: z.string().trim().max(500).nullable().optional(),
    priceCents: z.number().int().min(0).max(MAX_CENTS),
    /** Dias de validade contados a partir da compra. */
    validityDays: z.number().int().min(1).max(3650),
    /** Sessão usada gera comissão para quem atendeu (sobre o valor da sessão). */
    commissionOnSessions: z.boolean().default(true),
    items: packageItemsSchema,
  })
  .meta({
    example: {
      name: 'Combo do mês',
      priceCents: 22000,
      validityDays: 60,
      items: [{ serviceId: '0199a1b2-0000-7000-8000-000000000003', quantity: 4 }],
    },
  });
export type CreatePackageInput = z.infer<typeof createPackageSchema>;

/** Mudanças valem só para vendas futuras: o pacote vendido guarda um retrato da compra. */
export const updatePackageSchema = z
  .strictObject({
    name: z.string().trim().min(2).max(100).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    priceCents: z.number().int().min(0).max(MAX_CENTS).optional(),
    validityDays: z.number().int().min(1).max(3650).optional(),
    commissionOnSessions: z.boolean().optional(),
    active: z.boolean().optional(),
    items: packageItemsSchema.optional(),
  })
  .refine((input) => Object.keys(input).length > 0, 'Nada para alterar.');
export type UpdatePackageInput = z.infer<typeof updatePackageSchema>;

export const listPackagesSchema = z.strictObject({
  includeInactive: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});
export type ListPackagesQuery = z.infer<typeof listPackagesSchema>;

export const clientPackageStatusSchema = z.enum(['ACTIVE', 'EXPIRED', 'REFUNDED', 'VOIDED']);

export const listClientPackagesSchema = z.strictObject({
  clientId: z.uuid().optional(),
  status: clientPackageStatusSchema.optional(),
});
export type ListClientPackagesQuery = z.infer<typeof listClientPackagesSchema>;

/** Reembolso: valor definido pela barbearia, até o que foi pago, sempre com motivo. */
export const refundPackageSchema = z
  .strictObject({
    amountCents: z.number().int().min(0).max(MAX_CENTS),
    paymentMethod: z.enum(PAYMENT_METHODS),
    reason: z.string().trim().min(3, 'Informe o motivo do reembolso.').max(200),
  })
  .meta({ example: { amountCents: 10000, paymentMethod: 'PIX', reason: 'Cliente mudou de cidade' } });
export type RefundPackageInput = z.infer<typeof refundPackageSchema>;
