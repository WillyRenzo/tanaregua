import { z } from 'zod';
import { cursorQuerySchema } from '../../common/http/pagination.js';
import { PAYMENT_METHODS } from '../finance/finance.service.js';

export const orderItemInputSchema = z.strictObject({
  serviceId: z.uuid(),
  professionalId: z.uuid(),
  quantity: z.number().int().min(1).max(20).default(1),
  discountCents: z.number().int().min(0).default(0),
});
export type OrderItemInput = z.infer<typeof orderItemInputSchema>;

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
