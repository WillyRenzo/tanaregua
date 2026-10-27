export type CommissionType = 'PERCENT' | 'FIXED';

export interface CommissionRuleTerms {
  membershipId: string | null;
  serviceId: string | null;
  productId: string | null;
  type: CommissionType;
  /** PERCENT: basis points (4000 = 40%). FIXED: centavos. */
  value: number;
}

/** O que foi vendido no item da comanda. */
export type CommissionTarget = { serviceId: string } | { productId: string };

/**
 * Escolhe a regra aplicável (business-rules §4). Sem regra, não há comissão.
 * - Serviço: funcionário+serviço > serviço > padrão do funcionário.
 * - Produto: funcionário+produto > produto. O padrão do funcionário não vale para produto,
 *   e venda de balcão (sem profissional) nunca gera comissão.
 */
export function resolveCommissionRule<T extends CommissionRuleTerms>(
  rules: readonly T[],
  membershipId: string | null,
  target: CommissionTarget,
): T | undefined {
  if (membershipId === null) return undefined;
  if ('productId' in target) {
    return (
      rules.find((rule) => rule.membershipId === membershipId && rule.productId === target.productId) ??
      rules.find((rule) => rule.membershipId === null && rule.productId === target.productId)
    );
  }
  return (
    rules.find((rule) => rule.membershipId === membershipId && rule.serviceId === target.serviceId) ??
    rules.find((rule) => rule.membershipId === null && rule.serviceId === target.serviceId) ??
    rules.find(
      (rule) => rule.membershipId === membershipId && rule.serviceId === null && rule.productId === null,
    )
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
