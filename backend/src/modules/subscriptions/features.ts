import type { SubscriptionStatus } from '../../generated/prisma/client.js';

/**
 * Catálogo único de recursos vendáveis (business-rules §12). Como as permissões, o código
 * checa recursos, nunca o nome do plano. O núcleo das fases 1 e 2 vale em todo plano e não
 * tem chave. Cada chave passa a ser exigida (`@RequiresFeature`) quando o módulo dela entra.
 */
export const FEATURES = ['online-payment', 'payroll', 'advanced-reports', 'assistant'] as const;

export type Feature = (typeof FEATURES)[number];

export function isFeature(value: string): value is Feature {
  return (FEATURES as readonly string[]).includes(value);
}

/**
 * Recursos que a assinatura libera agora. [PROPOSTA] Em atraso ainda libera (a carência e o
 * que acontece depois dela são decisões pendentes do §12); cancelada não libera nada.
 */
export function grantedFeatures(status: SubscriptionStatus, planFeatures: readonly string[]): Feature[] {
  if (status === 'CANCELED') return [];
  return planFeatures.filter(isFeature);
}
