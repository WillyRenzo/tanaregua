import { z } from 'zod';
import { cursorQuerySchema } from '../../common/http/pagination.js';
import { PAYMENT_METHODS } from '../finance/finance.service.js';

const itemAmounts = {
  quantity: z.number().int().min(1).max(20).default(1),
  discountCents: z.number().int().min(0).default(0),
};

/** Serviço: sempre com o profissional que atendeu. */
export const serviceItemInputSchema = z.strictObject({
  serviceId: z.uuid(),
  professionalId: z.uuid(),
  ...itemAmounts,
});

/** Produto: profissional opcional; sem ele é venda de balcão e não há comissão. */
export const productItemInputSchema = z.strictObject({
  productId: z.uuid(),
  professionalId: z.uuid().nullable().default(null),
  ...itemAmounts,
});

/** Pacote vendido: um por item, para o cliente da comanda (business-rules §6). */
export const packageItemInputSchema = z.strictObject({
  packageId: z.uuid(),
  quantity: z.literal(1).default(1),
  discountCents: z.number().int().min(0).default(0),
});

export const orderItemInputSchema = z.union([
  serviceItemInputSchema,
  productItemInputSchema,
  packageItemInputSchema,
]);
export type OrderItemInput = z.infer<typeof orderItemInputSchema>;

/** Paga (ou deixa de pagar, com null) um serviço da comanda com sessão de pacote do cliente. */
export const applyPackageSchema = z
  .strictObject({ clientPackageId: z.uuid().nullable() })
  .meta({ example: { clientPackageId: '0199a1b2-0000-7000-8000-000000000009' } });
export type ApplyPackageInput = z.infer<typeof applyPackageSchema>;

/** Abre a partir de um agendamento OU avulsa (cliente opcional: "cliente balcão"). */
export const openOrderSchema = z.union([
  z.strictObject({ appointmentId: z.uuid() }),
  z.strictObject({
    clientId: z.uuid().optional(),
    items: z.array(orderItemInputSchema).max(20).default([]),
  }),
]);
export type OpenOrderInput = z.infer<typeof openOrderSchema>;

export const updateOrderItemSchema = z
  .strictObject({
    quantity: z.number().int().min(1).max(20).optional(),
    discountCents: z.number().int().min(0).optional(),
  })
  .refine((input) => Object.keys(input).length > 0, 'Nada para alterar.');
export type UpdateOrderItemInput = z.infer<typeof updateOrderItemSchema>;

export const closeOrderSchema = z
  .strictObject({
    paymentMethod: z.enum(PAYMENT_METHODS),
  })
  .meta({ example: { paymentMethod: 'PIX' } });
export type CloseOrderInput = z.infer<typeof closeOrderSchema>;

export const voidOrderSchema = z.strictObject({
  reason: z.string().trim().min(3, 'Informe o motivo do estorno.').max(200),
});
export type VoidOrderInput = z.infer<typeof voidOrderSchema>;

export const listOrdersSchema = cursorQuerySchema.extend({
  status: z.enum(['OPEN', 'CLOSED', 'VOIDED']).optional(),
  appointmentId: z.uuid().optional(),
});
export type ListOrdersQuery = z.infer<typeof listOrdersSchema>;
