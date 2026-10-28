import { describe, expect, it } from 'vitest';
import { hasFeature, planIncluding, subscriptionStatusLabel, type Plan } from './plans';
import type { SessionProfile, SessionState } from './session/session-store';

const plans: Plan[] = [
  { key: 'essential', name: 'Essencial', features: [] },
  { key: 'professional', name: 'Profissional', features: ['online-payment', 'payroll', 'advanced-reports'] },
  {
    key: 'premium',
    name: 'Premium',
    features: ['online-payment', 'payroll', 'advanced-reports', 'assistant'],
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
