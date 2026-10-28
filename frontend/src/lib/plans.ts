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
