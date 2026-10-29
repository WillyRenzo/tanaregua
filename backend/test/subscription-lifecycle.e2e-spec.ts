import { randomInt, randomUUID } from 'node:crypto';
import request from 'supertest';
import { buildOpenApiDocument } from '../src/app.setup.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { OutboxProcessor } from '../src/modules/notifications/outbox.processor.js';
import { addInterval } from '../src/modules/subscriptions/access.js';
import { FakePaymentGateway, PaymentGateway } from '../src/modules/subscriptions/payment-gateway.js';
import { as, createTestApp, registerTenant, type Tenant, type TestApp } from './helpers/app.js';
import { login } from './helpers/isolation.js';
import { createTestPlan, ownerClient } from './helpers/platform.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

type Operation = { responses: Record<string, unknown> };

/**
 * Ciclo de vida da assinatura (business-rules §12, decisões de 30/10/2026): teste grátis,
 * período pago e carência, modo só leitura, troca de plano e cancelamento.
 */
describe('Ciclo de vida da assinatura (e2e)', () => {
  let app: TestApp;
  let owner: PrismaClient;
  let gateway: FakePaymentGateway;
  let processor: OutboxProcessor;

  beforeAll(async () => {
    app = await createTestApp();
    owner = ownerClient();
    gateway = app.get(PaymentGateway) as FakePaymentGateway;
    processor = app.get(OutboxProcessor);
  });

  afterAll(async () => {
    await owner.$disconnect();
    await app.close();
  });

  /** Dois planos só deste teste, com posições em ordem (o maior é o upgrade). */
  async function plans(prices: { basic: number; top: number }) {
    const created: string[] = [];
    for (const amountCents of [prices.basic, prices.top]) {
      const key = await createTestPlan(owner);
      const plan = await owner.plan.findUniqueOrThrow({ where: { key } });
      await owner.planPrice.create({ data: { planId: plan.id, interval: 'MONTHLY', amountCents } });
      created.push(key);
    }
    const [basic, top] = created as [string, string];
    // Posições próprias, acima das sorteadas por createTestPlan (position é unique).
    const base = 2_000_000 + randomInt(1_000_000_000) * 2;
    await owner.plan.update({ where: { key: basic }, data: { position: base } });
    await owner.plan.update({ where: { key: top }, data: { position: base + 1 } });
    return { basic, top };
  }

  async function drain(barbershopId: string) {
    while ((await processor.processBatch({ barbershopId })) > 0) {
      // processa até esvaziar a fila desta barbearia
    }
  }

  async function subscribe(shop: Tenant, planKey: string) {
    const response = await as(app, shop.token)
      .post('/v1/subscription/checkout')
      .send({ planKey, interval: 'MONTHLY' })
      .expect(201);
    const id = (response.body.checkoutUrl as string).split('/').at(-1)!;
    await request(app.getHttpServer()).get(`/v1/billing/fake-checkout/${id}`).expect(303);
    await drain(shop.barbershopId);
    return id;
  }

  const webhook = (notification: ReturnType<FakePaymentGateway['notification']>) =>
    request(app.getHttpServer())
      .post('/v1/billing/webhook')
      .query(notification.query)
      .set(notification.headers)
      .send(notification.body);

  const detail = async (shop: Tenant) => (await as(app, shop.token).get('/v1/subscription').expect(200)).body;
  const row = (shop: Tenant) =>
    owner.subscription.findUniqueOrThrow({ where: { barbershopId: shop.barbershopId } });
  const setRow = (shop: Tenant, data: Parameters<PrismaClient['subscription']['update']>[0]['data']) =>
    owner.subscription.update({ where: { barbershopId: shop.barbershopId }, data });
  const createClient = (shop: Tenant) =>
    as(app, shop.token)
      .post('/v1/clients')
      .send({ name: `Cliente ${randomUUID().slice(0, 6)}` });

  describe('teste grátis e modo só leitura', () => {
    it('no teste grátis tudo funciona; vencido, o painel só consulta e a página pública continua', async () => {
      const shop = await registerTenant(app);
      await createClient(shop).expect(201);

      await setRow(shop, { trialEndsAt: daysAgo(1) });
      const me = await as(app, shop.token).get('/v1/auth/me').expect(200);
      expect(me.body.subscription.access).toEqual({ state: 'read-only', until: null });

      // Consulta continua; escrita responde 402 com o tipo que o painel reconhece.
      await as(app, shop.token).get('/v1/clients').expect(200);
      const blocked = await createClient(shop).expect(402);
      expect(blocked.body).toMatchObject({
        type: 'https://tanaregua.app/problems/subscription-inactive',
        status: 402,
      });

      // Página pública: o cliente cria conta e chega à validação da reserva (400 = passou do guard).
      await request(app.getHttpServer()).get(`/v1/public/${shop.slug}`).expect(200);
      const client = await request(app.getHttpServer())
        .post(`/v1/public/${shop.slug}/auth/register`)
        .send({
          name: 'Paula',
          email: `c-${randomUUID().slice(0, 8)}@teste.com`,
          password: 'senha-forte-123',
        })
        .expect(201);
      await as(app, client.body.accessToken as string)
        .post(`/v1/public/${shop.slug}/bookings`)
        .send({})
        .expect(400);
    });

    it('assinar é a saída do modo só leitura e encerra o teste, com o período pago começando agora', async () => {
      const { basic } = await plans({ basic: 5000, top: 9000 });
      const shop = await registerTenant(app);
      await setRow(shop, { trialEndsAt: daysAgo(1) });

      const before = new Date();
      await subscribe(shop, basic);
      const subscription = await row(shop);
      expect(subscription).toMatchObject({ status: 'ACTIVE', trialEndsAt: null });
      expect(subscription.paidThrough!.getTime()).toBeGreaterThanOrEqual(
        addInterval(before, 'MONTHLY').getTime(),
      );
      expect((await detail(shop)).access).toEqual({
        state: 'active',
        until: subscription.paidThrough!.toISOString(),
      });
      await createClient(shop).expect(201);
    });

    it('assinar durante o teste cobra na hora: o teste acaba ali', async () => {
      const { top } = await plans({ basic: 5000, top: 9000 });
      const shop = await registerTenant(app);
      await subscribe(shop, top);
      expect(await detail(shop)).toMatchObject({
        status: 'ACTIVE',
        access: { state: 'active' },
        plan: { key: top },
        canSubscribe: false,
        canChangePlan: true,
      });
    });
  });

  describe('cobranças de cada ciclo e carência', () => {
    it('cobrança aprovada estende o período pago; recusada não; repetida é ignorada', async () => {
      const { basic } = await plans({ basic: 5000, top: 9000 });
      const shop = await registerTenant(app);
      const id = await subscribe(shop, basic);
      const paidThrough = (await row(shop)).paidThrough!;

      const rejected = gateway.charge(id, 'rejected', paidThrough);
      await webhook(gateway.paymentNotification(rejected)).expect(200);
      await drain(shop.barbershopId);
      expect((await row(shop)).paidThrough).toEqual(paidThrough);

      const approved = gateway.charge(id, 'approved', paidThrough);
      const notification = gateway.paymentNotification(approved, 'evento-ciclo-2');
      await webhook(notification).expect(200);
      await webhook(gateway.paymentNotification(approved, 'evento-ciclo-2')).expect(200);
      await drain(shop.barbershopId);
      expect((await row(shop)).paidThrough).toEqual(addInterval(paidThrough, 'MONTHLY'));
    });

    it('cobrança desconhecida no gateway responde 502 para ele reenviar; nada é gravado', async () => {
      const response = await webhook(gateway.paymentNotification('fake-payment-nao-existe')).expect(502);
      expect(response.body.type).toBe('https://tanaregua.app/problems/billing-gateway-unavailable');
    });

    it('período pago vencido sem cobrança aprovada: 7 dias de carência e depois só leitura', async () => {
      const { basic } = await plans({ basic: 5000, top: 9000 });
      const shop = await registerTenant(app);
      await subscribe(shop, basic);

      await setRow(shop, { paidThrough: daysAgo(3) });
      expect((await detail(shop)).access.state).toBe('grace');
      await createClient(shop).expect(201);

      await setRow(shop, { paidThrough: daysAgo(8) });
      expect((await detail(shop)).access.state).toBe('read-only');
      await createClient(shop).expect(402);
    });
  });

  describe('troca de plano', () => {
    it('upgrade vale na hora; o gateway cobra o valor novo a partir da próxima cobrança', async () => {
      const { basic, top } = await plans({ basic: 5000, top: 9000 });
      const shop = await registerTenant(app);
      const id = await subscribe(shop, basic);

      const changed = await as(app, shop.token)
        .post('/v1/subscription/plan')
        .send({ planKey: top })
        .expect(200);
      expect(changed.body).toMatchObject({ plan: { key: top }, amountCents: 9000, scheduledPlan: null });
      await drain(shop.barbershopId);
      expect(gateway.inspect(id).amountCents).toBe(9000);
    });

    it('downgrade fica para o fim do período pago; escolher o plano atual desfaz', async () => {
      const { basic, top } = await plans({ basic: 5000, top: 9000 });
      const shop = await registerTenant(app);
      const id = await subscribe(shop, top);
      const paidThrough = (await row(shop)).paidThrough!;

      const scheduled = await as(app, shop.token)
        .post('/v1/subscription/plan')
        .send({ planKey: basic })
        .expect(200);
      expect(scheduled.body).toMatchObject({
        plan: { key: top },
        amountCents: 5000,
        scheduledPlan: { plan: { key: basic }, effectiveAt: paidThrough.toISOString() },
      });
      await drain(shop.barbershopId);
      expect(gateway.inspect(id).amountCents).toBe(5000);

      const undone = await as(app, shop.token)
        .post('/v1/subscription/plan')
        .send({ planKey: top })
        .expect(200);
      expect(undone.body).toMatchObject({ plan: { key: top }, amountCents: 9000, scheduledPlan: null });
      await drain(shop.barbershopId);
      expect(gateway.inspect(id).amountCents).toBe(9000);
      // O evento do downgrade desfeito, mesmo vencido, não muda nada.
      await owner.outboxEvent.updateMany({
        where: { barbershopId: shop.barbershopId, type: 'SubscriptionPlanChangeDue', status: 'PENDING' },
        data: { nextAttemptAt: new Date() },
      });
      await drain(shop.barbershopId);
      expect((await detail(shop)).plan.key).toBe(top);
    });

    it('no fim do período pago, o downgrade agendado passa a valer', async () => {
      const { basic, top } = await plans({ basic: 5000, top: 9000 });
      const shop = await registerTenant(app);
      await subscribe(shop, top);
      await as(app, shop.token).post('/v1/subscription/plan').send({ planKey: basic }).expect(200);

      await setRow(shop, { scheduledPlanAt: new Date(Date.now() - 60_000) });
      await owner.outboxEvent.updateMany({
        where: { barbershopId: shop.barbershopId, type: 'SubscriptionPlanChangeDue', status: 'PENDING' },
        data: { nextAttemptAt: new Date() },
      });
      await drain(shop.barbershopId);
      expect(await detail(shop)).toMatchObject({
        plan: { key: basic },
        scheduledPlan: null,
        amountCents: 5000,
      });
    });

    it('sem assinatura paga, ou com plano fora do ciclo, a troca é recusada', async () => {
      const shop = await registerTenant(app);
      const { top } = await plans({ basic: 5000, top: 9000 });
      const trial = await as(app, shop.token)
        .post('/v1/subscription/plan')
        .send({ planKey: top })
        .expect(409);
      expect(trial.body.type).toBe('https://tanaregua.app/problems/plan-change-unavailable');

      const { basic } = await plans({ basic: 5000, top: 9000 });
      await subscribe(shop, basic);
      const yearlyOnly = await createTestPlan(owner);
      const plan = await owner.plan.findUniqueOrThrow({ where: { key: yearlyOnly } });
      await owner.planPrice.create({ data: { planId: plan.id, interval: 'YEARLY', amountCents: 90000 } });
      const notForSale = await as(app, shop.token)
        .post('/v1/subscription/plan')
        .send({ planKey: yearlyOnly })
        .expect(422);
      expect(notForSale.body.type).toBe('https://tanaregua.app/problems/plan-not-for-sale');
    });
  });

  describe('cancelamento', () => {
    it('cancela no gateway e usa até o fim do período pago; depois, só leitura', async () => {
      const { basic } = await plans({ basic: 5000, top: 9000 });
      const shop = await registerTenant(app);
      const id = await subscribe(shop, basic);
      const paidThrough = (await row(shop)).paidThrough!;

      const canceled = await as(app, shop.token).post('/v1/subscription/cancel').expect(200);
      expect(canceled.body).toMatchObject({
        status: 'CANCELED',
        access: { state: 'canceled', until: paidThrough.toISOString() },
        canSubscribe: true,
        canChangePlan: false,
      });
      await drain(shop.barbershopId);
      expect(gateway.inspect(id).status).toBe('cancelled');
      await createClient(shop).expect(201);

      // Uma notificação antiga ("autorizada") que chegue depois não reativa a assinatura.
      gateway.setStatus(id, 'authorized');
      await webhook(gateway.notification(id)).expect(200);
      await drain(shop.barbershopId);
      expect((await row(shop)).status).toBe('CANCELED');

      await setRow(shop, { paidThrough: daysAgo(1) });
      await createClient(shop).expect(402);
      // Cancelar de novo não faz sentido; assinar de novo é a saída.
      await as(app, shop.token).post('/v1/subscription/cancel').expect(409);
      await subscribe(shop, basic);
      await createClient(shop).expect(201);
    });

    it('só quem cuida da assinatura troca de plano e cancela', async () => {
      const shop = await registerTenant(app);
      const email = `recepcao-${randomUUID().slice(0, 8)}@teste.com`;
      await as(app, shop.token)
        .post('/v1/staff')
        .send({
          name: 'Recepção',
          email,
          password: 'senha-forte-123',
          roleKey: 'receptionist',
          isProfessional: false,
        })
        .expect(201);
      const receptionist = await login(app, email, 'senha-forte-123');
      await as(app, receptionist).post('/v1/subscription/cancel').expect(403);
      await as(app, receptionist).post('/v1/subscription/plan').send({ planKey: 'premium' }).expect(403);
    });
  });

  it('o contrato documenta o 402 nas escritas do painel, fora as liberadas no modo só leitura', () => {
    const document = buildOpenApiDocument(app);
    const op = (path: string, method: string) =>
      (document.paths[path] as Record<string, Operation>)[method]!.responses;
    expect(op('/v1/clients', 'post')['402']).toBeDefined();
    expect(op('/v1/clients', 'get')['402']).toBeUndefined();
    expect(op('/v1/subscription/checkout', 'post')['402']).toBeUndefined();
    expect(op('/v1/subscription/cancel', 'post')['402']).toBeUndefined();
    expect(op('/v1/public/{slug}/bookings', 'post')['402']).toBeUndefined();
  });
});
