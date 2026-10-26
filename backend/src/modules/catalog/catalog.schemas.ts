import { z } from 'zod';

const serviceFields = {
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).nullable().optional(),
  priceCents: z.number().int().min(0).max(10_000_00),
  /** Múltiplos de 5 min para encaixar na grade da agenda. */
  durationMinutes: z.number().int().min(5).max(480).multipleOf(5),
};

export const createServiceSchema = z.strictObject(serviceFields);
export type CreateServiceInput = z.infer<typeof createServiceSchema>;

export const updateServiceSchema = z.strictObject({
  name: serviceFields.name.optional(),
  description: serviceFields.description,
  priceCents: serviceFields.priceCents.optional(),
  durationMinutes: serviceFields.durationMinutes.optional(),
  active: z.boolean().optional(),
});
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;

export const listServicesSchema = z.strictObject({
  includeInactive: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});
export type ListServicesQuery = z.infer<typeof listServicesSchema>;

export const upsertCommissionRuleSchema = z
  .discriminatedUnion('type', [
    z.strictObject({
      membershipId: z.uuid().nullable(),
      serviceId: z.uuid().nullable(),
      type: z.literal('PERCENT'),
      /** basis points: 4000 = 40% */
      value: z.number().int().min(0).max(10_000),
    }),
    z.strictObject({
      membershipId: z.uuid().nullable(),
      serviceId: z.uuid().nullable(),
      type: z.literal('FIXED'),
      /** centavos */
      value: z.number().int().min(0).max(10_000_00),
    }),
  ])
  .refine((rule) => rule.membershipId !== null || rule.serviceId !== null, {
    message: 'Informe o funcionário, o serviço ou ambos.',
  })
  .meta({
    example: {
      membershipId: null,
      serviceId: '0199a1b2-0000-7000-8000-000000000003',
      type: 'PERCENT',
      value: 4000,
    },
  });
export type UpsertCommissionRuleInput = z.infer<typeof upsertCommissionRuleSchema>;
