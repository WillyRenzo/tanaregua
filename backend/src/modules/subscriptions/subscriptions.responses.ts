import { z } from 'zod';
import { FEATURES } from './features.js';

/** Contratos de resposta de assinatura e planos (business-rules §12). */

export const featureSchema = z.enum(FEATURES).meta({ id: 'Feature' });

/** Centavos por ciclo; `null` = o plano não é vendido naquele ciclo. */
export const planPricesSchema = z
  .object({ monthlyCents: z.int().positive().nullable(), yearlyCents: z.int().positive().nullable() })
  .meta({ id: 'PlanPrices' });
export type PlanPrices = z.infer<typeof planPricesSchema>;

export const planSchema = z
  .object({
    key: z.string(),
    name: z.string(),
    features: z.array(featureSchema),
    prices: planPricesSchema,
  })
  .meta({ id: 'Plan' });
export type PlanSummary = z.infer<typeof planSchema>;

export const subscriptionSummarySchema = z
  .object({
    plan: z.object({ key: z.string(), name: z.string() }),
    status: z.enum(['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED']),
    /** O que a assinatura libera agora: o painel decide o que mostrar; a API revalida sempre. */
    features: z.array(featureSchema),
  })
  .meta({ id: 'SubscriptionSummary' });
export type SubscriptionSummary = z.infer<typeof subscriptionSummarySchema>;
