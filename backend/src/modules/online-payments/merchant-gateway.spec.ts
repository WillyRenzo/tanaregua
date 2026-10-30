import { MercadoPagoMerchantGateway, MerchantGatewayError } from './merchant-gateway.js';

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
});
