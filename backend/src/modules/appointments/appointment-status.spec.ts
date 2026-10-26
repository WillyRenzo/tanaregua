import { assertTransition, canTransition, isReschedulable } from './appointment-status.js';

describe('appointment-status', () => {
  it.each([
    ['SCHEDULED', 'CONFIRMED'],
    ['SCHEDULED', 'CANCELLED'],
    ['CONFIRMED', 'IN_SERVICE'],
    ['CONFIRMED', 'NO_SHOW'],
    ['IN_SERVICE', 'COMPLETED'],
  ] as const)('permite %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    ['COMPLETED', 'CANCELLED'],
    ['CANCELLED', 'SCHEDULED'],
    ['NO_SHOW', 'CONFIRMED'],
    ['IN_SERVICE', 'CANCELLED'],
    ['SCHEDULED', 'COMPLETED'],
  ] as const)('bloqueia %s → %s', (from, to) => {
    expect(() => assertTransition(from, to)).toThrow(/Não é possível/);
  });

  it('só permite reagendar antes do atendimento começar', () => {
    expect(isReschedulable('SCHEDULED')).toBe(true);
    expect(isReschedulable('CONFIRMED')).toBe(true);
    expect(isReschedulable('IN_SERVICE')).toBe(false);
    expect(isReschedulable('CANCELLED')).toBe(false);
  });
});
