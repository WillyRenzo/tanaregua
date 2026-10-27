import { z } from 'zod';

export const productViewSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    description: z.string().nullable(),
    priceCents: z.int(),
    /** Só para quem gerencia produtos (custo é informação do negócio); null para os demais. */
    costCents: z.int().nullable(),
    stockQuantity: z.int(),
    minStockQuantity: z.int().nullable(),
    /** Saldo no mínimo ou abaixo: hora de repor. */
    lowStock: z.boolean(),
    /** Σ quantidade × custo das movimentações; pode ser negativo. Null para quem não gerencia. */
    stockValueCents: z.int().nullable(),
    active: z.boolean(),
  })
  .meta({ id: 'Product' });
export type ProductView = z.infer<typeof productViewSchema>;

export const stockMovementSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(['ENTRY', 'SALE', 'SALE_REVERSAL', 'ADJUSTMENT']),
    /** Delta com sinal. */
    quantity: z.int(),
    unitCostCents: z.int(),
    reason: z.string().nullable(),
    orderId: z.uuid().nullable(),
    author: z.object({ id: z.uuid(), name: z.string() }),
    occurredAt: z.date(),
  })
  .meta({ id: 'StockMovement' });
export type StockMovementView = z.infer<typeof stockMovementSchema>;
