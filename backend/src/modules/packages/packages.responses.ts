import { z } from 'zod';
import { clientPackageStatusSchema } from './packages.schemas.js';

export const servicePackageSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    description: z.string().nullable(),
    priceCents: z.int(),
    validityDays: z.int(),
    commissionOnSessions: z.boolean(),
    active: z.boolean(),
    items: z.array(z.object({ serviceId: z.uuid(), name: z.string(), quantity: z.int() })),
  })
  .meta({ id: 'ServicePackage' });
export type ServicePackageView = z.infer<typeof servicePackageSchema>;

const balanceSchema = z.object({
  serviceId: z.uuid(),
  name: z.string(),
  initialQuantity: z.int(),
  remaining: z.int(),
});

/** Pacote comprado, como o cliente vê (agendamento online): só consulta. */
export const myPackageSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    purchasedAt: z.date(),
    expiresAt: z.date(),
    /** EXPIRED é derivado: ativo com validade vencida. */
    status: clientPackageStatusSchema,
    balances: z.array(balanceSchema),
  })
  .meta({ id: 'MyPackage' });
export type MyPackageView = z.infer<typeof myPackageSchema>;

/** Pacote comprado, como a equipe vê. */
export const clientPackageSchema = myPackageSchema
  .extend({
    client: z.object({ id: z.uuid(), name: z.string() }),
    packageId: z.uuid(),
    orderId: z.uuid(),
    pricePaidCents: z.int(),
    commissionOnSessions: z.boolean(),
    refundCents: z.int().nullable(),
    refundedAt: z.date().nullable(),
    refundReason: z.string().nullable(),
  })
  .meta({ id: 'ClientPackage' });
export type ClientPackageView = z.infer<typeof clientPackageSchema>;
