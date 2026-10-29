import type { components } from '@/lib/api/schema';
import { formatDate } from '@/lib/format';
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

export type SubscriptionAccess = components['schemas']['SubscriptionAccess'];

export interface AccessNotice {
  /** `warning`: o painel já está (ou vai ficar logo) só para consulta. */
  tone: 'info' | 'warning';
  text: string;
}

/**
 * Aviso da situação da assinatura (business-rules §12) para o topo do painel e a tela de
 * plano. Assinatura em dia não tem aviso.
 */
export function accessNotice(access: SubscriptionAccess, timezone: string): AccessNotice | null {
  const until = access.until ? formatDate(access.until, timezone) : '';
  switch (access.state) {
    case 'trial':
      return {
        tone: 'info',
        text: `Teste grátis até ${until}. Assine um plano para continuar criando e alterando depois disso.`,
      };
    case 'canceled':
      return {
        tone: 'info',
        text: `Assinatura cancelada. O painel funciona até ${until}; depois, fica só para consulta.`,
      };
    case 'grace':
      return {
        tone: 'warning',
        text: `O pagamento da assinatura não foi confirmado. Confira a forma de pagamento até ${until} para o painel não ficar só para consulta.`,
      };
    case 'read-only':
      return {
        tone: 'warning',
        text: 'O painel está só para consulta: o teste grátis terminou ou a assinatura não está em dia. Assine um plano para voltar a criar e alterar.',
      };
    case 'active':
      return null;
  }
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
