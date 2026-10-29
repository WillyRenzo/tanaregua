import type { components } from '@/lib/api/schema';
import type { SessionState } from '@/lib/session/session-store';

export type Plan = components['schemas']['Plan'];
export type Feature = components['schemas']['Feature'];
export type SubscriptionStatus = components['schemas']['SubscriptionSummary']['status'];

/**
 * Só para a UX (mostrar o recurso ou o convite de upgrade), como `can()`. Quem garante é a
 * API (`@RequiresFeature`): esconder no frontend não basta (business-rules §12).
 */
export function hasFeature(session: SessionState, feature: Feature): boolean {
  if (session.status !== 'authenticated') return false;
  return session.profile.subscription?.features.includes(feature) ?? false;
}

/** O plano mais básico que inclui o recurso (os planos vêm da API em ordem). */
export function planIncluding(feature: Feature, plans: readonly Plan[]): Plan | undefined {
  return plans.find((plan) => plan.features.includes(feature));
}

const STATUS_LABELS: Record<SubscriptionStatus, string | null> = {
  ACTIVE: null,
  TRIALING: 'Em período de teste',
  PAST_DUE: 'Pagamento em atraso',
  CANCELED: 'Assinatura cancelada',
};

export function subscriptionStatusLabel(status: SubscriptionStatus): string | null {
  return STATUS_LABELS[status];
}

export const FEATURE_LABELS: Record<Feature, string> = {
  'online-payment': 'Pagamento online',
  payroll: 'Salários e folha',
  'advanced-reports': 'Relatórios avançados',
  assistant: 'Assistente de IA',
};

/**
 * Desconto do anual sobre 12 mensalidades, em basis points (1500 = 15%). Negativo quando o
 * anual sai mais caro; `null` se faltar um dos preços.
 */
export function yearlyDiscount(monthlyCents: number | null, yearlyCents: number | null): number | null {
  if (monthlyCents === null || yearlyCents === null || monthlyCents <= 0) return null;
  return Math.round(10_000 - (yearlyCents * 10_000) / (12 * monthlyCents));
}

export type BillingInterval = components['schemas']['BillingInterval'];

export const INTERVAL_LABELS: Record<BillingInterval, { name: string; per: string }> = {
  MONTHLY: { name: 'mensal', per: 'mês' },
  YEARLY: { name: 'anual', per: 'ano' },
};

/** Preço do plano no ciclo, em centavos; `null` = não é vendido nele. */
export function priceFor(plan: Plan, interval: BillingInterval): number | null {
  return interval === 'MONTHLY' ? plan.prices.monthlyCents : plan.prices.yearlyCents;
}
