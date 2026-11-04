import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  depositLabel,
  hasVisiblePayment,
  onlineChargeCents,
  PaymentBadge,
  type AppointmentPayment,
} from './payment-status';

const payment = (status: AppointmentPayment['status']): AppointmentPayment => ({
  status,
  amountCents: 1500,
  holdUntil: null,
  checkoutUrl: null,
  paidAt: null,
  refundedAt: null,
});

describe('pagamento online da reserva', () => {
  it('mostra o sinal com o mesmo arredondamento da API (meio centavo para cima)', () => {
    expect(onlineChargeCents(4555, { amount: 'DEPOSIT', depositBps: 3000 })).toBe(1367);
    expect(onlineChargeCents(4555, { amount: 'FULL', depositBps: null })).toBe(4555);
    expect(depositLabel(3000)).toBe('sinal de 30%');
    expect(depositLabel(1250)).toBe('sinal de 12,5%');
  });

  it('o selo tem ícone, texto e valor; pagamento encerrado sem dinheiro não aparece', () => {
    render(<PaymentBadge payment={payment('PAID')} />);
    expect(screen.getByText(/Pago online · R\$\s15,00/)).toBeInTheDocument();
    expect(hasVisiblePayment(payment('EXPIRED'))).toBe(false);
    expect(hasVisiblePayment(payment('CANCELLED'))).toBe(false);
    expect(hasVisiblePayment(payment('REFUNDED'))).toBe(true);
    expect(hasVisiblePayment(null)).toBe(false);
  });
});
