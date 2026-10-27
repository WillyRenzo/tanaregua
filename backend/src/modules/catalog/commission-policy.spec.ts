import {
  calculateCommissionCents,
  resolveCommissionRule,
  type CommissionRuleTerms,
} from './commission-policy.js';

const rule = (overrides: Partial<CommissionRuleTerms>): CommissionRuleTerms => ({
  membershipId: null,
  serviceId: null,
  productId: null,
  type: 'PERCENT',
  value: 4000,
  ...overrides,
});

describe('resolveCommissionRule', () => {
  const memberDefault = rule({ membershipId: 'ana', value: 3000 });
  const serviceRule = rule({ serviceId: 'corte', value: 4000 });
  const specific = rule({ membershipId: 'ana', serviceId: 'corte', value: 5000 });

  it('prefere a regra específica funcionário+serviço', () => {
    expect(resolveCommissionRule([memberDefault, serviceRule, specific], 'ana', { serviceId: 'corte' })).toBe(
      specific,
    );
  });

  it('usa a regra do serviço antes do padrão do funcionário', () => {
    expect(resolveCommissionRule([memberDefault, serviceRule], 'ana', { serviceId: 'corte' })).toBe(
      serviceRule,
    );
  });

  it('cai no padrão do funcionário quando o serviço não tem regra', () => {
    expect(resolveCommissionRule([memberDefault, serviceRule], 'ana', { serviceId: 'barba' })).toBe(
      memberDefault,
    );
  });

  it('não aplica regra de outro funcionário', () => {
    expect(resolveCommissionRule([memberDefault, specific], 'bia', { serviceId: 'barba' })).toBeUndefined();
  });

  it('o padrão do funcionário não pega regra de funcionário+produto', () => {
    const anaPomada = rule({ membershipId: 'ana', productId: 'pomada', value: 1000 });
    expect(resolveCommissionRule([anaPomada], 'ana', { serviceId: 'corte' })).toBeUndefined();
  });
});

describe('resolveCommissionRule para produtos', () => {
  const memberDefault = rule({ membershipId: 'ana', value: 3500 });
  const productRule = rule({ productId: 'pomada', type: 'FIXED', value: 500 });
  const specific = rule({ membershipId: 'ana', productId: 'pomada', value: 1000 });

  it('prefere funcionário+produto e depois a regra do produto', () => {
    expect(resolveCommissionRule([productRule, specific], 'ana', { productId: 'pomada' })).toBe(specific);
    expect(resolveCommissionRule([productRule, specific], 'bia', { productId: 'pomada' })).toBe(productRule);
  });

  it('o padrão do funcionário NÃO vale para produto (business-rules §4)', () => {
    expect(resolveCommissionRule([memberDefault], 'ana', { productId: 'pomada' })).toBeUndefined();
  });

  it('venda de balcão (sem profissional) nunca gera comissão', () => {
    expect(resolveCommissionRule([productRule, specific], null, { productId: 'pomada' })).toBeUndefined();
  });

  it('regra de serviço não vale para produto', () => {
    const serviceRule = rule({ serviceId: 'corte', value: 4000 });
    expect(resolveCommissionRule([serviceRule], 'ana', { productId: 'corte' })).toBeUndefined();
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
