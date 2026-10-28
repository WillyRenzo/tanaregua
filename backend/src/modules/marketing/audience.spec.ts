import { reachableBy, selectAudience, type MessagingContact } from './audience.js';

const now = new Date('2026-10-28T12:00:00Z');
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60_000);

const contact = (overrides: Partial<MessagingContact>): MessagingContact => ({
  id: 'c1',
  name: 'Cliente',
  email: 'cliente@exemplo.test',
  phone: '11988887777',
  birthDate: null,
  emailConsentAt: daysAgo(100),
  whatsappConsentAt: null,
  ...overrides,
});

describe('público de campanha', () => {
  const ana = contact({ id: 'ana', birthDate: '1990-11-03' });
  const bia = contact({ id: 'bia', birthDate: '1985-10-10' });
  const caio = contact({ id: 'caio' });
  const facts = {
    now,
    lastVisits: new Map([
      ['ana', daysAgo(45)],
      ['bia', daysAgo(10)],
    ]),
    serviceClientIds: new Set(['bia']),
  };
  const ids = (list: MessagingContact[]) => list.map((item) => item.id);

  it('todos', () => {
    expect(ids(selectAudience([ana, bia, caio], { kind: 'all' }, facts))).toEqual(['ana', 'bia', 'caio']);
  });

  it('sem visita há N dias: só quem já veio e não voltou desde então', () => {
    expect(ids(selectAudience([ana, bia, caio], { kind: 'inactive', days: 30 }, facts))).toEqual(['ana']);
    expect(ids(selectAudience([ana, bia, caio], { kind: 'inactive', days: 60 }, facts))).toEqual([]);
  });

  it('aniversariantes do mês', () => {
    expect(ids(selectAudience([ana, bia, caio], { kind: 'birthday-month', month: 10 }, facts))).toEqual([
      'bia',
    ]);
  });

  it('fez o serviço no período (fatos já filtrados pelo serviço)', () => {
    const audience = {
      kind: 'service',
      serviceId: '0199a000-0000-7000-8000-000000000000',
      days: 90,
    } as const;
    expect(ids(selectAudience([ana, bia, caio], audience, facts))).toEqual(['bia']);
  });

  it('só alcança pelo canal com consentimento e contato', () => {
    expect(reachableBy(contact({}), 'EMAIL')).toBe(true);
    expect(reachableBy(contact({ emailConsentAt: null }), 'EMAIL')).toBe(false);
    expect(reachableBy(contact({ email: null }), 'EMAIL')).toBe(false);
    expect(reachableBy(contact({}), 'WHATSAPP')).toBe(false);
    expect(reachableBy(contact({ whatsappConsentAt: daysAgo(1) }), 'WHATSAPP')).toBe(true);
    expect(reachableBy(contact({ whatsappConsentAt: daysAgo(1), phone: '123' }), 'WHATSAPP')).toBe(false);
  });
});
