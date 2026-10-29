import { accessOf, addInterval, trialEnd, type AccessInput } from './access.js';

const now = new Date('2026-11-10T12:00:00Z');
const at = (iso: string) => new Date(iso);
const paid = (overrides: Partial<AccessInput>): AccessInput => ({
  status: 'ACTIVE',
  trialEndsAt: null,
  paidThrough: at('2026-12-01T00:00:00Z'),
  gatewaySubscriptionId: 'gw-1',
  ...overrides,
});

describe('accessOf', () => {
  it('teste grátis vale até o fim e depois vira só leitura', () => {
    const trial = {
      ...paid({}),
      status: 'TRIALING' as const,
      paidThrough: null,
      gatewaySubscriptionId: null,
    };
    expect(accessOf({ ...trial, trialEndsAt: at('2026-11-20T00:00:00Z') }, now)).toEqual({
      state: 'trial',
      until: at('2026-11-20T00:00:00Z'),
    });
    expect(accessOf({ ...trial, trialEndsAt: at('2026-11-10T12:00:00Z') }, now)).toEqual({
      state: 'read-only',
      until: null,
    });
  });

  it('assinatura paga em dia vale até o fim do período pago', () => {
    expect(accessOf(paid({}), now)).toEqual({ state: 'active', until: at('2026-12-01T00:00:00Z') });
  });

  it('sem cobrança aprovada, 7 dias de carência e depois só leitura', () => {
    const late = paid({ paidThrough: at('2026-11-05T00:00:00Z') });
    expect(accessOf(late, now)).toEqual({ state: 'grace', until: at('2026-11-12T00:00:00Z') });
    expect(accessOf(late, at('2026-11-12T00:00:00Z'))).toEqual({ state: 'read-only', until: null });
    // Pausada no gateway (em atraso): mesma regra, pela data.
    expect(accessOf({ ...late, status: 'PAST_DUE' }, now).state).toBe('grace');
  });

  it('cancelada usa até o fim do período pago, sem carência', () => {
    expect(accessOf(paid({ status: 'CANCELED' }), now)).toEqual({
      state: 'canceled',
      until: at('2026-12-01T00:00:00Z'),
    });
    expect(accessOf(paid({ status: 'CANCELED', paidThrough: at('2026-11-09T00:00:00Z') }), now).state).toBe(
      'read-only',
    );
  });

  it('ativa sem gateway é cortesia e não expira; cancelada sem período pago é só leitura', () => {
    const courtesy = paid({ gatewaySubscriptionId: null, paidThrough: null });
    expect(accessOf(courtesy, now)).toEqual({ state: 'active', until: null });
    expect(accessOf({ ...courtesy, status: 'CANCELED' }, now).state).toBe('read-only');
  });
});

describe('addInterval', () => {
  it('soma um mês ou um ano, sem passar do fim do mês', () => {
    expect(addInterval(at('2026-01-31T10:00:00Z'), 'MONTHLY')).toEqual(at('2026-02-28T10:00:00Z'));
    expect(addInterval(at('2026-12-15T10:00:00Z'), 'MONTHLY')).toEqual(at('2027-01-15T10:00:00Z'));
    expect(addInterval(at('2028-02-29T10:00:00Z'), 'YEARLY')).toEqual(at('2029-02-28T10:00:00Z'));
  });

  it('o teste grátis dura 14 dias', () => {
    expect(trialEnd(now)).toEqual(at('2026-11-24T12:00:00Z'));
  });
});
