import { signMercadoPagoNotification } from '../subscriptions/mercadopago-signature.js';
import { InvalidNotificationError } from '../subscriptions/payment-gateway.js';
import {
  MercadoPagoMerchantGateway,
  MerchantGatewayError,
  parseMercadoPagoPaymentNotification,
} from './merchant-gateway.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('MercadoPagoMerchantGateway', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const gateway = new MercadoPagoMerchantGateway();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('confere a conta com o token da barbearia e devolve id e apelido', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { id: 123456789, nickname: 'BARBEARIADOZE', email: 'x@y.z' }));
    await expect(gateway.verifyAccount({ accessToken: 'APP_USR-token' })).resolves.toEqual({
      id: '123456789',
      name: 'BARBEARIADOZE',
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url instanceof Request ? url.url : url.toString()).toBe('https://api.mercadopago.com/users/me');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer APP_USR-token' });
  });

  it('sem apelido, usa o id', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { id: '42' }));
    expect((await gateway.verifyAccount({ accessToken: 'APP_USR-token' })).name).toBe('Conta 42');
  });

  it('token recusado vira MerchantGatewayError com status e código, sem o corpo', async () => {
    fetchMock.mockResolvedValueOnce(json(401, { error: 'unauthorized', message: 'invalid access token' }));
    const error = await gateway
      .verifyAccount({ accessToken: 'APP_USR-token' })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MerchantGatewayError);
    expect(error).toMatchObject({ status: 401, providerCode: 'unauthorized' });
    expect((error as Error).message).not.toContain('invalid access token');
  });

  const credentials = { accessToken: 'APP_USR-token' };
  const urlOf = (input: Parameters<typeof fetch>[0]) =>
    input instanceof Request ? input.url : input.toString();
  const bodyOf = (call: Parameters<typeof fetch>) =>
    JSON.parse(call[1]?.body as string) as Record<string, unknown>;

  it('abre o Checkout Pro com o valor em reais, a referência, o prazo e sem boleto', async () => {
    fetchMock.mockResolvedValueOnce(
      json(201, { id: 'pref-1', init_point: 'https://mp.test/checkout/pref-1' }),
    );
    const expiresAt = new Date('2026-11-04T15:15:00.000Z');
    await expect(
      gateway.createCheckout(credentials, {
        reference: 'pagamento-1',
        title: 'Barbearia do Zé - Corte (sinal)',
        amountCents: 1367,
        expiresAt,
        notificationUrl: 'https://tanaregua.app/api/v1/online-payments/webhook/chave',
        backUrl: 'https://tanaregua.app/barbearia/meus-agendamentos?pagamento=1',
      }),
    ).resolves.toEqual({ id: 'pref-1', checkoutUrl: 'https://mp.test/checkout/pref-1' });

    const call = fetchMock.mock.calls[0]!;
    expect(urlOf(call[0])).toBe('https://api.mercadopago.com/checkout/preferences');
    expect(call[1]?.headers).toMatchObject({
      Authorization: 'Bearer APP_USR-token',
      'X-Idempotency-Key': 'pagamento-1:2026-11-04T15:15:00.000Z',
    });
    expect(bodyOf(call)).toMatchObject({
      items: [{ id: 'pagamento-1', quantity: 1, currency_id: 'BRL', unit_price: 13.67 }],
      external_reference: 'pagamento-1',
      notification_url: 'https://tanaregua.app/api/v1/online-payments/webhook/chave',
      expires: true,
      expiration_date_to: '2026-11-04T15:15:00.000Z',
      date_of_expiration: '2026-11-04T15:15:00.000Z',
      payment_methods: { excluded_payment_types: [{ id: 'ticket' }] },
    });
  });

  it('consulta o pagamento e traduz a situação e o valor', async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, {
        id: 987,
        status: 'approved',
        external_reference: 'pagamento-1',
        transaction_amount: 13.67,
      }),
    );
    await expect(gateway.getPayment(credentials, '987')).resolves.toEqual({
      id: '987',
      status: 'approved',
      reference: 'pagamento-1',
      amountCents: 1367,
    });
    fetchMock.mockResolvedValueOnce(json(200, { id: 988, status: 'charged_back', transaction_amount: 10 }));
    expect(await gateway.getPayment(credentials, '988')).toMatchObject({
      status: 'refunded',
      reference: null,
    });
    fetchMock.mockResolvedValueOnce(json(200, { id: 989, status: 'in_process', transaction_amount: 10 }));
    expect((await gateway.getPayment(credentials, '989')).status).toBe('pending');
  });

  it('reembolsa com a chave de idempotência', async () => {
    fetchMock.mockResolvedValueOnce(json(201, { id: 1, status: 'approved' }));
    await gateway.refund(credentials, '987', 'refund:pagamento-1');
    const call = fetchMock.mock.calls[0]!;
    expect(urlOf(call[0])).toBe('https://api.mercadopago.com/v1/payments/987/refunds');
    expect(call[1]).toMatchObject({ method: 'POST' });
    expect(call[1]?.headers).toMatchObject({ 'X-Idempotency-Key': 'refund:pagamento-1' });
  });
});

describe('parseMercadoPagoPaymentNotification', () => {
  const secret = 'segredo-da-conta';
  const incoming = (type: string, signature: string) => ({
    headers: { 'x-signature': signature, 'x-request-id': 'req-1' },
    query: { type, 'data.id': '987' },
    body: { id: 'evento-1', type, data: { id: '987' } },
  });

  it('com a assinatura da conta, devolve o pagamento que mudou', () => {
    const signature = signMercadoPagoNotification('987', 'req-1', secret);
    expect(parseMercadoPagoPaymentNotification(incoming('payment', signature), secret)).toEqual({
      eventId: 'evento-1',
      paymentId: '987',
    });
  });

  it('notificação que não é de pagamento é ignorada', () => {
    const signature = signMercadoPagoNotification('987', 'req-1', secret);
    expect(parseMercadoPagoPaymentNotification(incoming('merchant_order', signature), secret)).toBeNull();
  });

  it('assinatura com outro segredo é recusada', () => {
    const signature = signMercadoPagoNotification('987', 'req-1', 'outro-segredo');
    expect(() => parseMercadoPagoPaymentNotification(incoming('payment', signature), secret)).toThrow(
      InvalidNotificationError,
    );
  });
});
