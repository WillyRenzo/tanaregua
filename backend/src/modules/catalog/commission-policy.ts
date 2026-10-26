export type CommissionType = 'PERCENT' | 'FIXED';

export interface CommissionRuleTerms {
  membershipId: string | null;
  serviceId: string | null;
  type: CommissionType;
  /** PERCENT: basis points (4000 = 40%). FIXED: centavos. */
  value: number;
}

/**
 * Escolhe a regra aplicável (business-rules §4):
 * funcionário+serviço > serviço > funcionário. Sem regra, não há comissão.
 */
export function resolveCommissionRule<T extends CommissionRuleTerms>(
  rules: readonly T[],
  membershipId: string,
  serviceId: string,
): T | undefined {
  return (
    rules.find((rule) => rule.membershipId === membershipId && rule.serviceId === serviceId) ??
    rules.find((rule) => rule.membershipId === null && rule.serviceId === serviceId) ??
    rules.find((rule) => rule.membershipId === membershipId && rule.serviceId === null)
  );
}

/**
 * Único ponto de arredondamento de comissão (business-rules §4): meio centavo
 * arredonda para cima. A comissão nunca passa do valor cobrado pelo item.
 */
export function calculateCommissionCents(
  baseCents: number,
  rule: Pick<CommissionRuleTerms, 'type' | 'value'> | undefined,
): number {
  if (!rule || baseCents <= 0) return 0;
  const commission = rule.type === 'PERCENT' ? Math.round((baseCents * rule.value) / 10_000) : rule.value;
  return Math.min(commission, baseCents);
}
