import { z } from 'zod';
import { pageSchema } from '../../common/http/openapi.js';

/** `ONLINE` = pago online na reserva (§5); só o sistema lança. */
export const paymentMethodSchema = z.enum(['CASH', 'PIX', 'CARD_CREDIT', 'CARD_DEBIT', 'OTHER', 'ONLINE']);

export const orderViewSchema = z
  .object({
    id: z.uuid(),
    status: z.enum(['OPEN', 'CLOSED', 'VOIDED']),
    appointmentId: z.uuid().nullable(),
    client: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    items: z.array(
      z.object({
        id: z.uuid(),
        kind: z.enum(['SERVICE', 'PRODUCT', 'PACKAGE']),
        serviceId: z.uuid().nullable(),
        productId: z.uuid().nullable(),
        /** Pacote vendido neste item. */
        packageId: z.uuid().nullable(),
        /** Serviço pago com sessão deste pacote do cliente (cobra zero). */
        clientPackageId: z.uuid().nullable(),
        name: z.string(),
        /** Null em produto vendido no balcão. */
        professional: z.object({ id: z.uuid(), name: z.string() }).nullable(),
        unitPriceCents: z.int(),
        quantity: z.int(),
        discountCents: z.int(),
        totalCents: z.int(),
        commissionCents: z.int(),
      }),
    ),
    totalCents: z.int(),
    /**
     * Pago online na reserva (§5). Aberta: o que está disponível para abater; fechada: o que
     * entrou na comanda (o que passou do total voltou ao cliente).
     */
    prepaidCents: z.int(),
    /** Forma do balcão, ou `ONLINE` se a reserva paga cobriu tudo. */
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
        /** Null no valor retido de falta e no reembolso de reserva paga online. */
        orderId: z.uuid().nullable(),
        appointmentId: z.uuid().nullable(),
        method: paymentMethodSchema,
        kind: z.enum(['ENTRY', 'REVERSAL', 'REFUND']),
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
    topProducts: z.array(
      z.object({ productId: z.uuid(), name: z.string(), quantity: z.int(), revenueCents: z.int() }),
    ),
    appointments: z.object({
      byStatus: z.record(z.string(), z.int()),
      noShowRate: z.number(),
    }),
  })
  .meta({ id: 'ReportSummary' });
