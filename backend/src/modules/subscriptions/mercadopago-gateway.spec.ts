import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { MercadoPagoGateway } from './mercadopago-gateway.js';
import { signMercadoPagoNotification } from './mercadopago-signature.js';
import { centsToDecimal, InvalidNotificationError, PaymentGatewayError } from './payment-gateway.js';

const env: Partial<Env> = {
  MERCADOPAGO_ACCESS_TOKEN: 'APP_USR-token-de-teste',
  PAYMENT_WEBHOOK_SECRET: 'segredo-de-webhooks-de-teste',
  APP_PUBLIC_URL: 'https://tanaregua.app',
};
const config = { get: (key: keyof Env) => env[key] } as unknown as ConfigService<Env, true>;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('centsToDecimal', () => {
  it('converte centavos para o decimal do gateway sem erro de ponto flutuante', () => {
    expect(centsToDecimal(7990)).toBe(79.9);
    expect(centsToDecimal(12990)).toBe(129.9);
    expect(centsToDecimal(100)).toBe(1);
    expect(centsToDecimal(199_900)).toBe(1999);
    expect(centsToDecimal(5)).toBe(0.05);
    expect(() => centsToDecimal(1.5)).toThrow();
  });
});

describe('MercadoPagoGateway', () => {
  const fetchMock = vi.fn<typeof fetch>();
  let gateway: MercadoPagoGateway;

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    gateway = new MercadoPagoGateway(config);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const lastCall = () => {
    const [url, init] = fetchMock.mock.calls.at(-1)!;
    return {
      url: url instanceof Request ? url.url : url.toString(),
      method: init?.method,
      headers: init?.headers as Record<string, string>,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
  };

  it('cria a assinatura pendente no checkout hospedado, em reais e no ciclo certo', async () => {
    fetchMock.mockResolvedValueOnce(
      json(201, { id: 'pre-1', status: 'pending', init_point: 'https://www.mercadopago.com.br/checkout/x' }),
    );
    const checkout = await gateway.createSubscription({
      reference: 'checkout-1',
      payerEmail: 'dono@teste.com',
      reason: 'TaNaRegua - Plano Profissional (anual)',
      amountCents: 129_900,
      interval: 'YEARLY',
      backPath: '/painel/configuracoes?assinatura=retorno#plano',
    });

    expect(checkout).toEqual({ id: 'pre-1', checkoutUrl: 'https://www.mercadopago.com.br/checkout/x' });
    const call = lastCall();
    expect(call.url).toBe('https://api.mercadopago.com/preapproval');
    expect(call.method).toBe('POST');
    expect(call.headers['Authorization']).toBe('Bearer APP_USR-token-de-teste');
    expect(call.headers['X-Idempotency-Key']).toBe('checkout-1');
    expect(call.body).toEqual({
      reason: 'TaNaRegua - Plano Profissional (anual)',
      external_reference: 'checkout-1',
      payer_email: 'dono@teste.com',
      back_url: 'https://tanaregua.app/painel/configuracoes?assinatura=retorno#plano',
      status: 'pending',
      auto_recurring: {
        frequency: 12,
        frequency_type: 'months',
        transaction_amount: 1299,
        currency_id: 'BRL',
      },
    });
  });

  it('sem init_point na resposta, a criação falha (não há para onde mandar o pagador)', async () => {
    fetchMock.mockResolvedValueOnce(json(201, { id: 'pre-1', status: 'pending' }));
    await expect(
      gateway.createSubscription({
        reference: 'c',
        payerEmail: 'd@t.com',
        reason: 'r',
        amountCents: 100,
        interval: 'MONTHLY',
        backPath: '/',
      }),
    ).rejects.toBeInstanceOf(PaymentGatewayError);
  });

  it('consulta a assinatura e traduz a situação', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { id: 'pre-1', status: 'authorized' }));
    await expect(gateway.getSubscription('pre-1')).resolves.toEqual({ id: 'pre-1', status: 'authorized' });
    expect(lastCall().url).toBe('https://api.mercadopago.com/preapproval/pre-1');

    fetchMock.mockResolvedValueOnce(json(200, { id: 'pre-1', status: 'misterioso' }));
    await expect(gateway.getSubscription('pre-1')).rejects.toBeInstanceOf(PaymentGatewayError);
  });

  it('erro do Mercado Pago vira PaymentGatewayError com status e código, sem o corpo', async () => {
    fetchMock.mockResolvedValueOnce(json(401, { error: 'unauthorized', message: 'invalid access token' }));
    const error = await gateway.getSubscription('pre-1').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PaymentGatewayError);
    expect(error).toMatchObject({ status: 401, providerCode: 'unauthorized' });
    expect((error as Error).message).not.toContain('invalid access token');
  });

  it('repassa o novo valor por ciclo', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { id: 'pre-1', status: 'authorized' }));
    await gateway.updateSubscriptionAmount('pre-1', 9990);
    expect(lastCall()).toMatchObject({
      method: 'PUT',
      url: 'https://api.mercadopago.com/preapproval/pre-1',
      body: { auto_recurring: { transaction_amount: 99.9, currency_id: 'BRL' } },
    });
  });

  it('cancela só se ainda não estiver cancelada', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { id: 'pre-1', status: 'cancelled' }));
    await gateway.cancelSubscription('pre-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(json(200, { id: 'pre-1', status: 'authorized' }));
    fetchMock.mockResolvedValueOnce(json(200, { id: 'pre-1', status: 'cancelled' }));
    await gateway.cancelSubscription('pre-1');
    expect(lastCall()).toMatchObject({ method: 'PUT', body: { status: 'cancelled' } });
  });

  it('consulta a cobrança de um ciclo e traduz o resultado', async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, {
        id: 7001,
        preapproval_id: 'pre-1',
        status: 'processed',
        debit_date: '2026-11-29T10:00:00.000-03:00',
        payment: { id: 55, status: 'approved' },
      }),
    );
    await expect(gateway.getPayment('7001')).resolves.toEqual({
      id: '7001',
      subscriptionId: 'pre-1',
      status: 'approved',
      chargedAt: new Date('2026-11-29T13:00:00.000Z'),
    });
    expect(lastCall().url).toBe('https://api.mercadopago.com/authorized_payments/7001');

    fetchMock.mockResolvedValueOnce(
      json(200, { id: '7002', preapproval_id: 'pre-1', payment: { status: 'rejected' } }),
    );
    expect((await gateway.getPayment('7002')).status).toBe('rejected');
    fetchMock.mockResolvedValueOnce(json(200, { id: '7003', preapproval_id: 'pre-1', status: 'scheduled' }));
    expect((await gateway.getPayment('7003')).status).toBe('pending');
  });

  it('lê a notificação de assinatura e de cobrança só com a assinatura HMAC válida', () => {
    const headers = {
      'x-signature': signMercadoPagoNotification('pre-1', 'req-1', 'segredo-de-webhooks-de-teste'),
      'x-request-id': 'req-1',
    };
    const query = { type: 'subscription_preapproval', 'data.id': 'pre-1' };
    expect(gateway.parseNotification({ headers, query, body: { id: 987, data: { id: 'pre-1' } } })).toEqual({
      eventId: '987',
      kind: 'subscription',
      resourceId: 'pre-1',
    });
    expect(
      gateway.parseNotification({
        headers,
        query: { type: 'subscription_authorized_payment', 'data.id': 'pre-1' },
        body: { id: 988 },
      }),
    ).toEqual({ eventId: '988', kind: 'payment', resourceId: 'pre-1' });
    // Outro tipo (pagamento avulso): válido, mas não é da assinatura.
    expect(
      gateway.parseNotification({ headers, query: { type: 'payment', 'data.id': 'pre-1' }, body: {} }),
    ).toBeNull();
    expect(() =>
      gateway.parseNotification({ headers: { ...headers, 'x-request-id': 'outro' }, query, body: {} }),
    ).toThrow(InvalidNotificationError);
  });
});
