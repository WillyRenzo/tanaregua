import { z } from 'zod';

const MAX_CENTS = 10_000_00;
const MAX_UNITS = 10_000;

const productFields = {
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).nullable().optional(),
  priceCents: z.number().int().min(0).max(MAX_CENTS),
  /** Custo de referência por unidade; a cada entrada passa a ser o custo pago. */
  costCents: z.number().int().min(0).max(MAX_CENTS).default(0),
  /** Alerta de reposição: saldo no mínimo ou abaixo. Null = sem alerta. */
  minStockQuantity: z.number().int().min(0).max(MAX_UNITS).nullable().optional(),
};

export const createProductSchema = z.strictObject(productFields).meta({
  example: { name: 'Pomada modeladora', priceCents: 4500, costCents: 2200, minStockQuantity: 5 },
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

/** O saldo não está aqui de propósito: só muda por entrada, ajuste ou venda. */
export const updateProductSchema = z
  .strictObject({
    name: productFields.name.optional(),
    description: productFields.description,
    priceCents: productFields.priceCents.optional(),
    costCents: z.number().int().min(0).max(MAX_CENTS).optional(),
    minStockQuantity: productFields.minStockQuantity,
    active: z.boolean().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, 'Nada para alterar.');
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const listProductsSchema = z.strictObject({
  includeInactive: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});
export type ListProductsQuery = z.infer<typeof listProductsSchema>;

/** Entrada de mercadoria: soma ao saldo e atualiza o custo de referência. */
export const stockEntrySchema = z
  .strictObject({
    quantity: z.number().int().min(1).max(MAX_UNITS),
    unitCostCents: z.number().int().min(0).max(MAX_CENTS),
    note: z.string().trim().max(200).optional(),
  })
  .meta({ example: { quantity: 12, unitCostCents: 2100, note: 'NF 1234 do distribuidor' } });
export type StockEntryInput = z.infer<typeof stockEntrySchema>;

/** Ajuste (inventário, perda, quebra): delta com sinal, sempre com motivo. */
export const stockAdjustmentSchema = z
  .strictObject({
    quantity: z
      .number()
      .int()
      .min(-MAX_UNITS)
      .max(MAX_UNITS)
      .refine((quantity) => quantity !== 0, 'O ajuste não pode ser zero.'),
    reason: z.string().trim().min(3, 'Informe o motivo do ajuste.').max(200),
  })
  .meta({ example: { quantity: -1, reason: 'Embalagem danificada' } });
export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;
