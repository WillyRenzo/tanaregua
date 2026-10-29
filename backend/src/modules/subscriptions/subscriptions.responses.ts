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

export const billingIntervalSchema = z.enum(['MONTHLY', 'YEARLY']).meta({ id: 'BillingInterval' });

/** Assinatura vista por quem assina e paga (o dono): plano, cobrança, reajuste e checkout. */
export const subscriptionDetailSchema = z
  .object({
    plan: z.object({ key: z.string(), name: z.string() }),
    status: subscriptionSummarySchema.shape.status,
    /** Ciclo e valor cobrados pelo gateway; `null` enquanto a barbearia não assinou. */
    interval: billingIntervalSchema.nullable(),
    amountCents: z.int().positive().nullable(),
    /** Reajuste já avisado: o novo valor vale a partir da primeira cobrança depois da data. */
    scheduledChange: z.object({ amountCents: z.int().positive(), effectiveAt: z.date() }).nullable(),
    /** Checkout aberto e ainda não confirmado pelo gateway. */
    pendingCheckout: z
      .object({
        plan: z.object({ key: z.string(), name: z.string() }),
        interval: billingIntervalSchema,
        amountCents: z.int().positive(),
        checkoutUrl: z.string(),
        createdAt: z.date(),
      })
      .nullable(),
    /** A assinatura online está ligada nesta instalação. */
    onlineBilling: z.boolean(),
    /** Pode abrir um checkout agora (sem assinatura paga ativa; a troca de plano vem depois). */
    canSubscribe: z.boolean(),
  })
  .meta({ id: 'SubscriptionDetail' });
export type SubscriptionDetail = z.infer<typeof subscriptionDetailSchema>;

export const checkoutSchema = z.object({ checkoutUrl: z.string() }).meta({ id: 'SubscriptionCheckout' });
export type CheckoutView = z.infer<typeof checkoutSchema>;
