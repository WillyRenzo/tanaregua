import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { LogMailSender } from '../src/modules/notifications/mail-sender.js';
import { OutboxProcessor } from '../src/modules/notifications/outbox.processor.js';
import { CHECKOUT_BACK_PATH } from '../src/modules/subscriptions/billing.service.js';
import { FakePaymentGateway, PaymentGateway } from '../src/modules/subscriptions/payment-gateway.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { as, createTestApp, registerTenant, type Tenant, type TestApp } from './helpers/app.js';
import { login } from './helpers/isolation.js';
import {
  createTestPlan,
  createTestPlatformAdmin,
  ownerClient,
  platformLogin,
  type TestPlatformAdmin,
} from './helpers/platform.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Cobrança recorrente da assinatura (business-rules §5 e §12) com o gateway simulado. */
describe('Cobrança da assinatura (e2e)', () => {
  let app: TestApp;
  let prisma: PrismaService;
  let owner: PrismaClient;
  let gateway: FakePaymentGateway;
  let processor: OutboxProcessor;
  let mail: LogMailSender;
  let admin: TestPlatformAdmin;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    owner = ownerClient();
    gateway = app.get(PaymentGateway) as FakePaymentGateway;
    processor = app.get(OutboxProcessor);
    mail = app.get(LogMailSender);
    admin = await createTestPlatformAdmin(owner);
  });

  afterAll(async () => {
    await owner.$disconnect();
    await app.close();
  });

  /** Plano só deste teste, com preços (os planos reais são compartilhados entre as suítes). */
  async function pricedPlan(prices: { monthly?: number; yearly?: number }): Promise<string> {
    const key = await createTestPlan(owner);
    const plan = await owner.plan.findUniqueOrThrow({ where: { key } });
    if (prices.monthly) {
      await owner.planPrice.create({
        data: { planId: plan.id, interval: 'MONTHLY', amountCents: prices.monthly },
      });
    }
    if (prices.yearly) {
      await owner.planPrice.create({
        data: { planId: plan.id, interval: 'YEARLY', amountCents: prices.yearly },
      });
    }
    return key;
  }

  async function drain(barbershopId: string): Promise<void> {
    while ((await processor.processBatch({ barbershopId })) > 0) {
      // processa até esvaziar a fila desta barbearia
    }
  }

  const gatewayIdOf = (checkoutUrl: string) => checkoutUrl.split('/').at(-1)!;

  async function checkout(shop: Tenant, planKey: string, interval: 'MONTHLY' | 'YEARLY' = 'MONTHLY') {
    const response = await as(app, shop.token)
      .post('/v1/subscription/checkout')
      .send({ planKey, interval })
      .expect(201);
    return gatewayIdOf(response.body.checkoutUrl as string);
  }

  /** Assina o plano pelo checkout simulado, como o navegador faria, e processa a fila. */
  async function subscribe(shop: Tenant, planKey: string, interval: 'MONTHLY' | 'YEARLY' = 'MONTHLY') {
    const id = await checkout(shop, planKey, interval);
    await request(app.getHttpServer()).get(`/v1/billing/fake-checkout/${id}`).expect(303);
    await drain(shop.barbershopId);
    return id;
  }

  function notify(id: string, eventId?: string) {
    const notification = gateway.notification(id, eventId);
    return request(app.getHttpServer())
      .post('/v1/billing/webhook')
      .query(notification.query)
      .set(notification.headers)
      .send(notification.body);
  }

  const detail = async (shop: Tenant) => (await as(app, shop.token).get('/v1/subscription').expect(200)).body;

  it('barbearia nova aparece sem cobrança e pode assinar; só quem tem a permissão vê', async () => {
    const shop = await registerTenant(app);
    expect(await detail(shop)).toEqual({
      plan: { key: 'essential', name: 'Essencial' },
      status: 'ACTIVE',
      interval: null,
      amountCents: null,
      scheduledChange: null,
      pendingCheckout: null,
      onlineBilling: true,
      canSubscribe: true,
    });

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
    await as(app, receptionist).get('/v1/subscription').expect(403);
    await as(app, receptionist)
      .post('/v1/subscription/checkout')
      .send({ planKey: 'essential', interval: 'MONTHLY' })
      .expect(403);
  });

  it('o checkout usa o preço do catálogo e o retorno do navegador não muda o plano', async () => {
    const shop = await registerTenant(app);
    const planKey = await pricedPlan({ monthly: 5000 });
    const id = await checkout(shop, planKey);

    expect(gateway.inspect(id)).toMatchObject({ status: 'pending', amountCents: 5000, interval: 'MONTHLY' });
    const pending = await detail(shop);
    expect(pending.pendingCheckout).toMatchObject({
      plan: { key: planKey },
      interval: 'MONTHLY',
      amountCents: 5000,
      checkoutUrl: `/api/v1/billing/fake-checkout/${id}`,
    });

    // Clique duplo: o mesmo checkout volta, sem criar outro no gateway.
    expect(await checkout(shop, planKey)).toBe(id);

    const back = await request(app.getHttpServer()).get(`/v1/billing/fake-checkout/${id}`).expect(303);
    expect(back.headers['location']).toBe(CHECKOUT_BACK_PATH);
    // Antes da consulta ao gateway (fila), nada muda: o retorno do navegador não vale.
    expect((await detail(shop)).plan.key).toBe('essential');

    await drain(shop.barbershopId);
    expect(await detail(shop)).toMatchObject({
      plan: { key: planKey },
      status: 'ACTIVE',
      interval: 'MONTHLY',
      amountCents: 5000,
      pendingCheckout: null,
      canSubscribe: false,
    });
    const me = await as(app, shop.token).get('/v1/auth/me').expect(200);
    expect(me.body.subscription.features).toEqual(['payroll']);

    // Com assinatura paga, outro checkout seria cobrança dupla: a troca de plano vem depois.
    const again = await as(app, shop.token)
      .post('/v1/subscription/checkout')
      .send({ planKey, interval: 'MONTHLY' })
      .expect(409);
    expect(again.body.type).toBe('https://tanaregua.app/problems/plan-change-unavailable');
  });

  it('plano fora de venda no ciclo ou inexistente não abre checkout', async () => {
    const shop = await registerTenant(app);
    const planKey = await pricedPlan({ monthly: 5000 });
    const response = await as(app, shop.token)
      .post('/v1/subscription/checkout')
      .send({ planKey, interval: 'YEARLY' })
      .expect(422);
    expect(response.body.type).toBe('https://tanaregua.app/problems/plan-not-for-sale');
    await as(app, shop.token)
      .post('/v1/subscription/checkout')
      .send({ planKey: 'nao-existe', interval: 'MONTHLY' })
      .expect(404);
    await as(app, shop.token)
      .post('/v1/subscription/checkout')
      .send({ planKey, interval: 'MONTHLY', amountCents: 1 })
      .expect(400);
  });

  describe('notificações do gateway', () => {
    it('recusa notificação sem assinatura válida e não enfileira nada', async () => {
      const shop = await registerTenant(app);
      const id = await subscribe(shop, await pricedPlan({ monthly: 5000 }));
      gateway.setStatus(id, 'cancelled');
      const notification = gateway.notification(id);

      await request(app.getHttpServer())
        .post('/v1/billing/webhook')
        .query(notification.query)
        .set({ ...notification.headers, 'x-request-id': 'outro-pedido' })
        .send(notification.body)
        .expect(401);
      await request(app.getHttpServer()).post('/v1/billing/webhook').query(notification.query).expect(401);
      await drain(shop.barbershopId);
      expect((await detail(shop)).status).toBe('ACTIVE');
    });

    it('aplica a situação consultada no gateway e ignora a mesma notificação repetida', async () => {
      const shop = await registerTenant(app);
      const id = await subscribe(shop, await pricedPlan({ monthly: 5000 }));

      gateway.setStatus(id, 'paused');
      const eventId = randomUUID();
      await notify(id, eventId).expect(200, { received: true });
      await notify(id, eventId).expect(200, { received: true });
      const queued = await owner.outboxEvent.count({
        where: { barbershopId: shop.barbershopId, type: 'GatewaySubscriptionChanged', status: 'PENDING' },
      });
      expect(queued).toBe(1);
      await drain(shop.barbershopId);
      expect((await detail(shop)).status).toBe('PAST_DUE');

      gateway.setStatus(id, 'cancelled');
      await notify(id).expect(200);
      await drain(shop.barbershopId);
      expect(await detail(shop)).toMatchObject({ status: 'CANCELED', canSubscribe: true });
      const me = await as(app, shop.token).get('/v1/auth/me').expect(200);
      expect(me.body.subscription.features).toEqual([]);
    });

    it('notificação de assinatura desconhecida é aceita e ignorada', async () => {
      const unknown = (
        await gateway.createSubscription({
          reference: randomUUID(),
          payerEmail: 'x@teste.com',
          reason: 'r',
          amountCents: 100,
          interval: 'MONTHLY',
          backPath: '/',
        })
      ).id;
      await notify(unknown).expect(200, { received: true });
    });

    it('a notificação de uma barbearia nunca mexe na assinatura de outra', async () => {
      const a = await registerTenant(app);
      const b = await registerTenant(app);
      const planKey = await pricedPlan({ monthly: 5000 });
      const idA = await subscribe(a, planKey);
      await subscribe(b, planKey);

      gateway.setStatus(idA, 'cancelled');
      await notify(idA).expect(200);
      await drain(a.barbershopId);
      await drain(b.barbershopId);
      expect((await detail(a)).status).toBe('CANCELED');
      expect((await detail(b)).status).toBe('ACTIVE');
    });
  });

  it('checkout substituído é cancelado no gateway e não ativa mesmo se for aprovado depois', async () => {
    const shop = await registerTenant(app);
    const planKey = await pricedPlan({ monthly: 5000, yearly: 50_000 });
    const first = await checkout(shop, planKey, 'MONTHLY');
    const second = await checkout(shop, planKey, 'YEARLY');
    expect(second).not.toBe(first);
    await drain(shop.barbershopId);
    expect(gateway.inspect(first).status).toBe('cancelled');
    expect((await detail(shop)).pendingCheckout).toMatchObject({ interval: 'YEARLY' });

    // A aba antiga aprova o primeiro mesmo assim: não ativa e é cancelado de novo no gateway.
    gateway.setStatus(first, 'authorized');
    await notify(first).expect(200);
    await drain(shop.barbershopId);
    expect((await detail(shop)).plan.key).toBe('essential');
    expect(gateway.inspect(first).status).toBe('cancelled');

    await request(app.getHttpServer()).get(`/v1/billing/fake-checkout/${second}`).expect(303);
    await drain(shop.barbershopId);
    expect(await detail(shop)).toMatchObject({
      plan: { key: planKey },
      interval: 'YEARLY',
      amountCents: 50_000,
    });
  });

  it('o checkout simulado de id inexistente responde 404', async () => {
    await request(app.getHttpServer()).get('/v1/billing/fake-checkout/fake-nao-existe').expect(404);
  });

  describe('reajuste de preço (aviso de 30 dias)', () => {
    async function setPrices(
      planKey: string,
      monthlyCents: number | null,
      yearlyCents: number | null = null,
      status = 200,
    ) {
      const { token } = await platformLogin(app, admin);
      return request(app.getHttpServer())
        .put(`/v1/platform/plans/${planKey}/prices`)
        .set('Authorization', `Bearer ${token}`)
        .send({ monthlyCents, yearlyCents })
        .expect(status);
    }

    /** Leva o reajuste agendado para o passado, como se os 30 dias tivessem passado. */
    async function fastForward(barbershopId: string) {
      await owner.subscription.updateMany({
        where: { barbershopId, scheduledAmountAt: { not: null } },
        data: { scheduledAmountAt: new Date(Date.now() - 60_000) },
      });
      await owner.outboxEvent.updateMany({
        where: { barbershopId, type: 'SubscriptionPriceChangeDue', status: 'PENDING' },
        data: { nextAttemptAt: new Date() },
      });
    }

    it('avisa o dono por e-mail agora e repassa o novo valor ao gateway 30 dias depois', async () => {
      const shop = await registerTenant(app);
      const planKey = await pricedPlan({ monthly: 5000 });
      const id = await subscribe(shop, planKey);

      const before = Date.now();
      await setPrices(planKey, 6000);
      const scheduled = (await detail(shop)).scheduledChange;
      expect(scheduled.amountCents).toBe(6000);
      const effectiveAt = new Date(scheduled.effectiveAt).getTime();
      expect(effectiveAt).toBeGreaterThanOrEqual(before + 30 * DAY_MS - 1000);
      expect(effectiveAt).toBeLessThanOrEqual(Date.now() + 30 * DAY_MS);

      await drain(shop.barbershopId);
      const notice = mail.sent.find((message) => message.to === shop.email);
      expect(notice?.subject).toBe('Reajuste da sua assinatura do TaNaRegua');
      // O Intl separa "R$" do valor com espaço não separável.
      expect(notice?.text).toMatch(/de R\$\s50,00 para R\$\s60,00/);
      // Antes da data, o gateway continua cobrando o valor antigo.
      expect(gateway.inspect(id).amountCents).toBe(5000);
      expect((await detail(shop)).amountCents).toBe(5000);

      await fastForward(shop.barbershopId);
      await drain(shop.barbershopId);
      expect(gateway.inspect(id).amountCents).toBe(6000);
      expect(await detail(shop)).toMatchObject({ amountCents: 6000, scheduledChange: null });
    });

    it('salvar o mesmo preço não avisa de novo; voltar ao valor pago desfaz o reajuste', async () => {
      const shop = await registerTenant(app);
      const planKey = await pricedPlan({ monthly: 5000 });
      const id = await subscribe(shop, planKey);

      await setPrices(planKey, 6000);
      await setPrices(planKey, 6000);
      const notices = await owner.outboxEvent.count({
        where: { barbershopId: shop.barbershopId, type: 'SubscriptionPriceChangeNotice' },
      });
      expect(notices).toBe(1);

      await setPrices(planKey, 5000);
      expect((await detail(shop)).scheduledChange).toBeNull();
      await fastForward(shop.barbershopId);
      await drain(shop.barbershopId);
      expect(gateway.inspect(id).amountCents).toBe(5000);
      expect((await detail(shop)).amountCents).toBe(5000);
    });

    it('o reajuste só vale para o plano e o ciclo alterados, e não para assinatura cancelada', async () => {
      const monthly = await registerTenant(app);
      const yearly = await registerTenant(app);
      const canceled = await registerTenant(app);
      const planKey = await pricedPlan({ monthly: 5000, yearly: 50_000 });
      await subscribe(monthly, planKey, 'MONTHLY');
      await subscribe(yearly, planKey, 'YEARLY');
      const canceledId = await subscribe(canceled, planKey, 'MONTHLY');
      gateway.setStatus(canceledId, 'cancelled');
      await notify(canceledId).expect(200);
      await drain(canceled.barbershopId);

      await setPrices(planKey, 6000, 50_000);
      expect((await detail(monthly)).scheduledChange?.amountCents).toBe(6000);
      expect((await detail(yearly)).scheduledChange).toBeNull();
      expect((await detail(canceled)).scheduledChange).toBeNull();
    });

    it('quem aprova o checkout depois de um reajuste também é avisado do valor novo', async () => {
      const shop = await registerTenant(app);
      const planKey = await pricedPlan({ monthly: 5000 });
      const id = await checkout(shop, planKey);
      await setPrices(planKey, 6000);

      await request(app.getHttpServer()).get(`/v1/billing/fake-checkout/${id}`).expect(303);
      await drain(shop.barbershopId);
      expect(await detail(shop)).toMatchObject({ amountCents: 5000, scheduledChange: { amountCents: 6000 } });
      expect(mail.sent.some((message) => message.to === shop.email)).toBe(true);
    });

    it('o ciclo com assinatura paga não sai de venda', async () => {
      const shop = await registerTenant(app);
      const planKey = await pricedPlan({ monthly: 5000, yearly: 50_000 });
      await subscribe(shop, planKey, 'MONTHLY');

      const refused = await setPrices(planKey, null, 50_000, 409);
      expect(refused.body.type).toBe('https://tanaregua.app/problems/plan-price-in-use');
      expect(refused.body.detail).toContain('1 assinatura ativa');
      // O ciclo sem assinante sai normalmente.
      await setPrices(planKey, 5000, null);
    });
  });

  describe('banco', () => {
    it('o checkout é isolado por barbearia (RLS) e nunca é apagado pela aplicação', async () => {
      const a = await registerTenant(app);
      const b = await registerTenant(app);
      const planKey = await pricedPlan({ monthly: 5000 });
      await checkout(a, planKey);

      const seenByB = await prisma.withContext({ barbershopId: b.barbershopId }, (tx) =>
        tx.subscriptionCheckout.count({ where: { barbershopId: a.barbershopId } }),
      );
      expect(seenByB).toBe(0);
      const withoutTenant = await prisma.withContext({}, (tx) => tx.subscriptionCheckout.count());
      expect(withoutTenant).toBe(0);
      await expect(
        prisma.withContext({ barbershopId: a.barbershopId }, (tx) =>
          tx.subscriptionCheckout.deleteMany({ where: { barbershopId: a.barbershopId } }),
        ),
      ).rejects.toThrow(/permission denied/i);
    });

    it('as funções da plataforma recusam quem não é a administração', async () => {
      const shop = await registerTenant(app);
      const plan = await owner.plan.findUniqueOrThrow({ where: { key: 'essential' } });
      await expect(
        prisma.withContext(
          { barbershopId: shop.barbershopId },
          (tx) =>
            tx.$queryRaw`SELECT plan_cycle_subscriber_count(${plan.id}::uuid, 'MONTHLY'::"BillingInterval")`,
        ),
      ).rejects.toThrow(/administração da plataforma/);
      await expect(
        prisma.withContext(
          { barbershopId: shop.barbershopId },
          (tx) =>
            tx.$queryRaw`SELECT * FROM schedule_plan_price_change(${plan.id}::uuid, 'MONTHLY'::"BillingInterval", 1, now())`,
        ),
      ).rejects.toThrow(/administração da plataforma/);
    });

    it('os campos do gateway andam juntos (CHECK)', async () => {
      const shop = await registerTenant(app);
      await expect(
        owner.subscription.update({
          where: { barbershopId: shop.barbershopId },
          data: { gatewayProvider: 'fake', gatewaySubscriptionId: 'x' },
        }),
      ).rejects.toThrow(/subscriptions_gateway_complete/);
    });
  });
});
