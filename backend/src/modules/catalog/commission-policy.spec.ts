import {
  calculateCommissionCents,
  resolveCommissionRule,
  type CommissionRuleTerms,
} from './commission-policy.js';

const rule = (overrides: Partial<CommissionRuleTerms>): CommissionRuleTerms => ({
  membershipId: null,
  serviceId: null,
  type: 'PERCENT',
  value: 4000,
  ...overrides,
});

describe('resolveCommissionRule', () => {
  const memberDefault = rule({ membershipId: 'ana', value: 3000 });
  const serviceRule = rule({ serviceId: 'corte', value: 4000 });
  const specific = rule({ membershipId: 'ana', serviceId: 'corte', value: 5000 });

  it('prefere a regra específica funcionário+serviço', () => {
    expect(resolveCommissionRule([memberDefault, serviceRule, specific], 'ana', 'corte')).toBe(specific);
  });

  it('usa a regra do serviço antes do padrão do funcionário', () => {
    expect(resolveCommissionRule([memberDefault, serviceRule], 'ana', 'corte')).toBe(serviceRule);
  });

  it('cai no padrão do funcionário quando o serviço não tem regra', () => {
    expect(resolveCommissionRule([memberDefault, serviceRule], 'ana', 'barba')).toBe(memberDefault);
  });

  it('não aplica regra de outro funcionário', () => {
    expect(resolveCommissionRule([memberDefault, specific], 'bia', 'barba')).toBeUndefined();
  });
});

describe('calculateCommissionCents', () => {
  it('calcula percentual em basis points', () => {
    expect(calculateCommissionCents(5000, { type: 'PERCENT', value: 4000 })).toBe(2000);
  });

  it('arredonda meio centavo para cima', () => {
    // 3333 * 15% = 499,95 → 500
    expect(calculateCommissionCents(3333, { type: 'PERCENT', value: 1500 })).toBe(500);
    // 101 * 50% = 50,5 → 51
    expect(calculateCommissionCents(101, { type: 'PERCENT', value: 5000 })).toBe(51);
  });

  it('aplica valor fixo em centavos', () => {
    expect(calculateCommissionCents(5000, { type: 'FIXED', value: 1500 })).toBe(1500);
  });

  it('nunca passa do valor do item', () => {
    expect(calculateCommissionCents(1000, { type: 'FIXED', value: 1500 })).toBe(1000);
  });

  it('retorna zero sem regra ou para item gratuito', () => {
    expect(calculateCommissionCents(5000, undefined)).toBe(0);
    expect(calculateCommissionCents(0, { type: 'FIXED', value: 1500 })).toBe(0);
  });
});
