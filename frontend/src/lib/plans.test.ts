import { describe, expect, it } from 'vitest';
import { hasFeature, planIncluding, subscriptionStatusLabel, yearlyDiscount, type Plan } from './plans';
import type { SessionProfile, SessionState } from './session/session-store';

const prices = { monthlyCents: null, yearlyCents: null };

const plans: Plan[] = [
  { key: 'essential', name: 'Essencial', features: [], prices },
  {
    key: 'professional',
    name: 'Profissional',
    features: ['online-payment', 'payroll', 'advanced-reports'],
    prices,
  },
  {
    key: 'premium',
    name: 'Premium',
    features: ['online-payment', 'payroll', 'advanced-reports', 'assistant'],
    prices,
  },
];

const session = (subscription: SessionProfile['subscription']): SessionState => ({
  status: 'authenticated',
  accessToken: 'token',
  profile: {
    user: { id: 'u', name: 'Dono', email: 'dono@teste.com' },
    barbershop: { id: 'b', name: 'Barbearia', slug: 'barbearia', timezone: 'America/Sao_Paulo' },
    membership: { id: 'm', isProfessional: false, role: { key: 'owner', name: 'Dono' } },
    permissions: ['reports:read'],
    subscription,
  },
});

describe('hasFeature', () => {
  it('vale o que a assinatura libera agora', () => {
    const premium = session({
      plan: { key: 'premium', name: 'Premium' },
      status: 'ACTIVE',
      features: ['assistant'],
    });
    expect(hasFeature(premium, 'assistant')).toBe(true);
    expect(hasFeature(premium, 'payroll')).toBe(false);
  });

  it('sem sessão ou sem assinatura, nada está liberado', () => {
    expect(hasFeature({ status: 'loading' }, 'assistant')).toBe(false);
    expect(hasFeature({ status: 'anonymous' }, 'assistant')).toBe(false);
    expect(hasFeature(session(null), 'assistant')).toBe(false);
  });
});

describe('planIncluding', () => {
  it('aponta o plano mais básico que tem o recurso', () => {
    expect(planIncluding('payroll', plans)?.name).toBe('Profissional');
    expect(planIncluding('assistant', plans)?.name).toBe('Premium');
  });

  it('recurso que nenhum plano tem não aponta plano', () => {
    expect(planIncluding('assistant', plans.slice(0, 2))).toBeUndefined();
  });
});

describe('subscriptionStatusLabel', () => {
  it('só destaca o que não é a situação normal', () => {
    expect(subscriptionStatusLabel('ACTIVE')).toBeNull();
    expect(subscriptionStatusLabel('TRIALING')).toBe('Em período de teste');
    expect(subscriptionStatusLabel('PAST_DUE')).toBe('Pagamento em atraso');
    expect(subscriptionStatusLabel('CANCELED')).toBe('Assinatura cancelada');
  });
});

describe('yearlyDiscount', () => {
  it('compara o anual com 12 mensalidades, em basis points', () => {
    // 12 x R$ 99,90 = R$ 1.198,80; o anual de R$ 999,00 sai 16,67% mais barato.
    expect(yearlyDiscount(9990, 99900)).toBe(1667);
    expect(yearlyDiscount(10000, 120000)).toBe(0);
  });

  it('é negativo quando o anual sai mais caro', () => {
    expect(yearlyDiscount(10000, 130000)).toBe(-833);
  });

  it('sem um dos preços, não há o que comparar', () => {
    expect(yearlyDiscount(null, 99900)).toBeNull();
    expect(yearlyDiscount(9990, null)).toBeNull();
  });
});
