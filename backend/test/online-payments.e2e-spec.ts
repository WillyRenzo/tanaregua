import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { buildOpenApiDocument } from '../src/app.setup.js';
import { FAKE_MERCHANT_INVALID_TOKEN } from '../src/modules/online-payments/merchant-gateway.js';
import { SubscriptionsService } from '../src/modules/subscriptions/subscriptions.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { as, createTestApp, registerTenant, type Tenant, type TestApp } from './helpers/app.js';
import { login } from './helpers/isolation.js';

const CREDENTIALS = {
  accessToken: 'APP_USR-token-de-producao-da-barbearia-123456',
  webhookSecret: 'segredo-de-webhooks-da-barbearia',
};

type Operation = { description?: string };

/** Conta da barbearia no gateway e configuração do pagamento da reserva online (business-rules §5). */
describe('Pagamento online: conta e configuração (e2e)', () => {
  let app: TestApp;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  const connect = (shop: Tenant, body: object = CREDENTIALS) =>
    as(app, shop.token).put('/v1/online-payments/account').send(body);

  it('sem conta, mostra o pagamento desligado; conecta conferindo no gateway e nunca devolve as credenciais', async () => {
    const shop = await registerTenant(app);
    expect((await as(app, shop.token).get('/v1/online-payments').expect(200)).body).toEqual({
      available: true,
      account: null,
      settings: { mode: 'OFF', amount: 'FULL', depositBps: null },
    });

    const connected = await connect(shop).expect(200);
    expect(connected.body).toEqual({
      available: true,
      account: {
        provider: 'fake',
        accountId: expect.stringMatching(/^fake-/),
        accountName: 'Conta de teste',
        connectedAt: expect.any(String),
      },
      settings: { mode: 'OFF', amount: 'FULL', depositBps: null },
    });
    expect(JSON.stringify(connected.body)).not.toContain(CREDENTIALS.accessToken);
    expect(JSON.stringify(connected.body)).not.toContain(CREDENTIALS.webhookSecret);

    // No banco, só cifrado (ligado ao tenant) e com uma chave opaca para a URL de notificação.
    const row = await prisma.withContext({ barbershopId: shop.barbershopId }, (tx) =>
      tx.paymentAccount.findFirstOrThrow({ where: { barbershopId: shop.barbershopId } }),
    );
    expect(row.accessTokenSealed).not.toContain(CREDENTIALS.accessToken);
    expect(row.webhookSecretSealed).not.toContain(CREDENTIALS.webhookSecret);
    expect(row.webhookKey).toMatch(/^[\w-]{32}$/);
    expect(row.webhookKey).not.toContain(shop.barbershopId);
  });

  it('credencial recusada pelo gateway responde 422 e não grava nada', async () => {
    const shop = await registerTenant(app);
    const refused = await connect(shop, { ...CREDENTIALS, accessToken: FAKE_MERCHANT_INVALID_TOKEN }).expect(
      422,
    );
    expect(refused.body.type).toBe('https://tanaregua.app/problems/payment-account-invalid-credentials');
    expect((await as(app, shop.token).get('/v1/online-payments').expect(200)).body.account).toBeNull();
    await connect(shop, { accessToken: 'curto', webhookSecret: 'curto' }).expect(400);
  });

  it('configura desligado, opcional ou exigido, com o total ou um sinal de 1% a 99%', async () => {
    const shop = await registerTenant(app);
    const settings = (body: object) => as(app, shop.token).put('/v1/online-payments/settings').send(body);

    const notConnected = await settings({ mode: 'OPTIONAL', amount: 'FULL', depositBps: null }).expect(422);
    expect(notConnected.body.type).toBe('https://tanaregua.app/problems/payment-account-not-connected');

    await connect(shop).expect(200);
    expect(
      (await settings({ mode: 'REQUIRED', amount: 'DEPOSIT', depositBps: 3000 }).expect(200)).body.settings,
    ).toEqual({ mode: 'REQUIRED', amount: 'DEPOSIT', depositBps: 3000 });
    await settings({ mode: 'OPTIONAL', amount: 'DEPOSIT', depositBps: null }).expect(400);
    await settings({ mode: 'OPTIONAL', amount: 'FULL', depositBps: 3000 }).expect(400);
    await settings({ mode: 'OPTIONAL', amount: 'DEPOSIT', depositBps: 10_000 }).expect(400);
    await settings({ mode: 'OPTIONAL', amount: 'DEPOSIT', depositBps: 50 }).expect(400);

    // Reconectar troca as credenciais e mantém a configuração; desconectar desliga tudo.
    await connect(shop).expect(200);
    expect((await as(app, shop.token).get('/v1/online-payments').expect(200)).body.settings.mode).toBe(
      'REQUIRED',
    );
    await as(app, shop.token).delete('/v1/online-payments/account').expect(204);
    expect((await as(app, shop.token).get('/v1/online-payments').expect(200)).body).toMatchObject({
      account: null,
      settings: { mode: 'OFF' },
    });
  });

  it('o banco recusa sinal fora da faixa ou sem o valor do sinal (CHECK)', async () => {
    const shop = await registerTenant(app);
    await connect(shop).expect(200);
    const update = (data: { amount: 'FULL' | 'DEPOSIT'; depositBps: number | null }) =>
      prisma.withContext({ barbershopId: shop.barbershopId }, (tx) =>
        tx.paymentAccount.update({ where: { barbershopId: shop.barbershopId }, data }),
      );
    await expect(update({ amount: 'DEPOSIT', depositBps: null })).rejects.toThrow();
    await expect(update({ amount: 'FULL', depositBps: 3000 })).rejects.toThrow();
    await expect(update({ amount: 'DEPOSIT', depositBps: 9950 })).rejects.toThrow();
  });

  it('só no plano com o recurso: fora dele, 403 plan-upgrade-required', async () => {
    const shop = await registerTenant(app);
    await app.get(SubscriptionsService).grantPlan(shop.barbershopId, 'essential');
    const response = await as(app, shop.token).get('/v1/online-payments').expect(403);
    expect(response.body.type).toBe('https://tanaregua.app/problems/plan-upgrade-required');
    await connect(shop).expect(403);
  });

  it('só quem configura a barbearia mexe; recepção e profissional não', async () => {
    const shop = await registerTenant(app);
    for (const roleKey of ['receptionist', 'professional']) {
      const email = `${roleKey}-${randomUUID().slice(0, 8)}@teste.com`;
      await as(app, shop.token)
        .post('/v1/staff')
        .send({
          name: roleKey,
          email,
          password: 'senha-forte-123',
          roleKey,
          isProfessional: roleKey === 'professional',
        })
        .expect(201);
      const token = await login(app, email, 'senha-forte-123');
      await as(app, token).get('/v1/online-payments').expect(403);
      await as(app, token).put('/v1/online-payments/account').send(CREDENTIALS).expect(403);
    }
    await request(app.getHttpServer()).get('/v1/online-payments').expect(401);
  });

  it('a conta de uma barbearia não aparece para outra (API e RLS)', async () => {
    const a = await registerTenant(app);
    const b = await registerTenant(app);
    await connect(a).expect(200);
    expect((await as(app, b.token).get('/v1/online-payments').expect(200)).body.account).toBeNull();
    // Desconectar em B não mexe na conta de A.
    await as(app, b.token).delete('/v1/online-payments/account').expect(204);
    expect((await as(app, a.token).get('/v1/online-payments').expect(200)).body.account).not.toBeNull();
    const seenByB = await prisma.withContext({ barbershopId: b.barbershopId }, (tx) =>
      tx.paymentAccount.findMany({ select: { barbershopId: true } }),
    );
    expect(seenByB).toEqual([]);
  });

  it('o contrato mostra a permissão e o recurso do plano', () => {
    const document = buildOpenApiDocument(app);
    const operation = (document.paths['/v1/online-payments/account'] as Record<string, Operation>)['put']!;
    expect(operation.description).toContain('`barbershop:manage`');
    expect(operation.description).toContain('**Recurso do plano:** `online-payment`');
  });
});
