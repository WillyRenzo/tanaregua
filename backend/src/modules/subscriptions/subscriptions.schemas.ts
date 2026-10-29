import { z } from 'zod';

/** Entre R$ 1,00 e R$ 100.000,00 por ciclo: fora disso é quase certo um erro de digitação. */
const priceCentsSchema = z.int().min(100).max(10_000_000).nullable();

/** Preços de um plano, definidos na administração da plataforma. `null` tira o plano de venda no ciclo. */
export const setPlanPricesSchema = z
  .strictObject({ monthlyCents: priceCentsSchema, yearlyCents: priceCentsSchema })
  .meta({ id: 'SetPlanPricesInput', example: { monthlyCents: 9990, yearlyCents: 99900 } });
export type SetPlanPricesInput = z.infer<typeof setPlanPricesSchema>;

/** Plano e ciclo escolhidos pelo dono; o preço vem sempre do catálogo, nunca do navegador. */
export const startCheckoutSchema = z
  .strictObject({ planKey: z.string().min(1).max(64), interval: z.enum(['MONTHLY', 'YEARLY']) })
  .meta({ id: 'StartCheckoutInput', example: { planKey: 'professional', interval: 'MONTHLY' } });
export type StartCheckoutInput = z.infer<typeof startCheckoutSchema>;
