import { sessionValues } from './packages.service.js';

describe('sessionValues', () => {
  it('divide o preço pago pelo peso de cada serviço (preço de tabela × quantidade)', () => {
    // 4 cortes (R$ 50) + 2 barbas (R$ 35) = R$ 270 de tabela; pacote vendido por R$ 220.
    const values = sessionValues(22000, [
      { serviceId: 'corte', quantity: 4, listPriceCents: 5000 },
      { serviceId: 'barba', quantity: 2, listPriceCents: 3500 },
    ]);
    expect(values.get('corte')).toBe(4074);
    expect(values.get('barba')).toBe(2851);
  });

  it('nunca distribui mais do que foi pago (arredonda para baixo)', () => {
    const lines = [
      { serviceId: 'a', quantity: 3, listPriceCents: 3333 },
      { serviceId: 'b', quantity: 7, listPriceCents: 1999 },
    ];
    const values = sessionValues(9999, lines);
    const distributed = lines.reduce((sum, line) => sum + values.get(line.serviceId)! * line.quantity, 0);
    expect(distributed).toBeLessThanOrEqual(9999);
  });

  it('sem preço de tabela, divide igualmente entre as sessões', () => {
    const values = sessionValues(1000, [
      { serviceId: 'a', quantity: 3, listPriceCents: 0 },
      { serviceId: 'b', quantity: 1, listPriceCents: 0 },
    ]);
    expect([values.get('a'), values.get('b')]).toEqual([250, 250]);
  });

  it('pacote gratuito vale zero por sessão', () => {
    expect(sessionValues(0, [{ serviceId: 'a', quantity: 2, listPriceCents: 5000 }]).get('a')).toBe(0);
  });
});
