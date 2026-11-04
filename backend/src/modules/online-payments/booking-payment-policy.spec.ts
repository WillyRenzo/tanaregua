import { onlineChargeCents, paidCancellation } from './booking-payment-policy.js';

describe('onlineChargeCents', () => {
  it('cobra o total dos serviços', () => {
    expect(onlineChargeCents(4555, { amount: 'FULL', depositBps: null })).toBe(4555);
  });

  it('o sinal arredonda meio centavo para cima (30% de R$ 45,55 = R$ 13,67)', () => {
    expect(onlineChargeCents(4555, { amount: 'DEPOSIT', depositBps: 3000 })).toBe(1367);
  });

  it('o sinal abaixo do meio centavo arredonda para baixo (30% de R$ 45,54 = R$ 13,66)', () => {
    expect(onlineChargeCents(4554, { amount: 'DEPOSIT', depositBps: 3000 })).toBe(1366);
  });

  it('sem valor, nada a cobrar', () => {
    expect(onlineChargeCents(0, { amount: 'DEPOSIT', depositBps: 3000 })).toBe(0);
  });
});

describe('paidCancellation', () => {
  const startsAt = new Date('2026-11-10T13:00:00Z');
  const twoHours = 120;

  it('o cliente cancelando é sempre reembolsado (o prazo dele já foi conferido)', () => {
    expect(paidCancellation({ by: 'client' }, startsAt, twoHours)).toBe('refund');
  });

  it('a barbearia precisa dizer o motivo', () => {
    expect(paidCancellation({ by: 'staff' }, startsAt, twoHours)).toBe('needs-kind');
  });

  it('imprevisto da barbearia reembolsa mesmo em cima da hora', () => {
    const now = new Date('2026-11-10T12:59:00Z');
    expect(paidCancellation({ by: 'staff', kind: 'BARBERSHOP' }, startsAt, twoHours, now)).toBe('refund');
  });

  it('a pedido do cliente: reembolsa até o prazo dele, inclusive no limite', () => {
    const atDeadline = new Date('2026-11-10T11:00:00Z');
    expect(paidCancellation({ by: 'staff', kind: 'CLIENT_REQUEST' }, startsAt, twoHours, atDeadline)).toBe(
      'refund',
    );
  });

  it('a pedido do cliente depois do prazo: o valor fica com a barbearia', () => {
    const late = new Date('2026-11-10T11:00:01Z');
    expect(paidCancellation({ by: 'staff', kind: 'CLIENT_REQUEST' }, startsAt, twoHours, late)).toBe(
      'retain',
    );
  });
});
