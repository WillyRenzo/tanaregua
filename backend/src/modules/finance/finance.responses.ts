import { z } from 'zod';
import { pageSchema } from '../../common/http/openapi.js';

export const paymentMethodSchema = z.enum(['CASH', 'PIX', 'CARD_CREDIT', 'CARD_DEBIT', 'OTHER']);

export const orderViewSchema = z
  .object({
    id: z.uuid(),
    status: z.enum(['OPEN', 'CLOSED', 'VOIDED']),
    appointmentId: z.uuid().nullable(),
    client: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    items: z.array(
      z.object({
        id: z.uuid(),
        serviceId: z.uuid(),
        name: z.string(),
        professional: z.object({ id: z.uuid(), name: z.string() }),
        unitPriceCents: z.int(),
        quantity: z.int(),
        discountCents: z.int(),
        totalCents: z.int(),
        commissionCents: z.int(),
      }),
    ),
    totalCents: z.int(),
    paymentMethod: paymentMethodSchema.nullable(),
    closedAt: z.date().nullable(),
    voidedAt: z.date().nullable(),
    voidReason: z.string().nullable(),
    createdAt: z.date(),
  })
  .meta({ id: 'Order' });
export type OrderView = z.infer<typeof orderViewSchema>;
export const orderPageSchema = pageSchema(orderViewSchema, 'OrderPage');

export const cashDaySchema = z
  .object({
    date: z.string(),
    timezone: z.string(),
    totals: z.record(paymentMethodSchema, z.int()),
    netCents: z.int(),
    entries: z.array(
      z.object({
        id: z.uuid(),
        orderId: z.uuid(),
        method: paymentMethodSchema,
        kind: z.enum(['ENTRY', 'REVERSAL']),
        amountCents: z.int(),
        occurredAt: z.date(),
        clientName: z.string().nullable(),
      }),
    ),
  })
  .meta({ id: 'CashDay' });

export const commissionsSummarySchema = z
  .object({
    from: z.string(),
    to: z.string(),
    professionals: z.array(
      z.object({ professionalId: z.uuid(), name: z.string(), totalCents: z.int(), entries: z.int() }),
    ),
  })
  .meta({ id: 'CommissionsSummary' });

export const reportSummarySchema = z
  .object({
    from: z.string(),
    to: z.string(),
    timezone: z.string(),
    revenue: z.object({
      netCents: z.int(),
      byDay: z.array(z.object({ day: z.string(), netCents: z.int() })),
    }),
    professionals: z.array(
      z.object({ professionalId: z.uuid(), name: z.string(), revenueCents: z.int(), services: z.int() }),
    ),
    topServices: z.array(
      z.object({ serviceId: z.uuid(), name: z.string(), quantity: z.int(), revenueCents: z.int() }),
    ),
    appointments: z.object({
      byStatus: z.record(z.string(), z.int()),
      noShowRate: z.number(),
    }),
  })
  .meta({ id: 'ReportSummary' });
