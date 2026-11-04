import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { localTimeToInstant } from '../src/modules/appointments/availability.js';
import { OutboxProcessor } from '../src/modules/notifications/outbox.processor.js';
import { FakeMerchantGateway, MerchantGateway } from '../src/modules/online-payments/merchant-gateway.js';
import { signMercadoPagoNotification } from '../src/modules/subscriptions/mercadopago-signature.js';
import { SubscriptionsService } from '../src/modules/subscriptions/subscriptions.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { as, createTestApp, registerTenant, type Tenant, type TestApp } from './helpers/app.js';
import { expectTenantIsolation } from './helpers/isolation.js';
import { ownerClient } from './helpers/platform.js';

const SP = 'America/Sao_Paulo';
const futureDate = (days: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: SP }).format(new Date(Date.now() + days * 24 * 3600_000));
const at = (date: string, clock: string) => {
  const [h, m] = clock.split(':').map(Number);
  return localTimeToInstant(date, h! * 60 + m!, SP).toISOString();
};

const WEBHOOK_SECRET = 'segredo-de-webhooks-da-barbearia';

type Payment = {
  status: string;
  amountCents: number;
  holdUntil: string | null;
  checkoutUrl: string | null;
  paidAt: string | null;
  refundedAt: string | null;
};

/** Pagamento online da reserva (business-rules §5, decisões de 30/10 e 04/11/2026). */
describe('Pagamento online da reserva (e2e)', () => {
  let app: TestApp;
  let prisma: PrismaService;
  let gateway: FakeMerchantGateway;
  let day = 20;
  const nextDay = () => futureDate(day++);
  const server = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    gateway = app.get(MerchantGateway) as FakeMerchantGateway;
  });

  afterAll(async () => {
    await app.close();
  });

  /** Barbearia com expediente todo dia das 9h às 12h, um corte de R$ 50 e a conta conectada. */
  const setupShop = async (settings: { mode: string; amount: string; depositBps: number | null }) => {
    const shop = await registerTenant(app);
    const everyDay = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: '09:00', end: '12:00' }));
    await as(app, shop.token)
      .put(`/v1/staff/${shop.membershipId}/schedule`)
      .send({ intervals: everyDay })
      .expect(200);
    const corte = (
      await as(app, shop.token)
        .post('/v1/services')
        .send({ name: 'Corte', priceCents: 5000, durationMinutes: 30 })
        .expect(201)
    ).body.id as string;
    await as(app, shop.token)
      .put('/v1/online-payments/account')
      .send({ accessToken: `APP_USR-token-${shop.slug}`, webhookSecret: WEBHOOK_SECRET })
      .expect(200);
    await as(app, shop.token).put('/v1/online-payments/settings').send(settings).expect(200);
    return { ...shop, corte };
  };

  const registerClient = async (slug: string) => {
    const response = await server()
      .post(`/v1/public/${slug}/auth/register`)
      .send({
        name: 'Paula Cliente',
        email: `cliente-${randomUUID().slice(0, 8)}@teste.com`,
        password: 'senha-forte-123',
      })
      .expect(201);
    return response.body.accessToken as string;
  };

  const book = (shop: Tenant & { corte: string }, token: string, startsAt: string, payOnline?: boolean) =>
    as(app, token)
      .post(`/v1/public/${shop.slug}/bookings`)
      .set('Idempotency-Key', randomUUID())
      .send({ serviceIds: [shop.corte], startsAt, ...(payOnline === undefined ? {} : { payOnline }) });

  const process = async (shop: Tenant) => {
    const processor = app.get(OutboxProcessor);
    while ((await processor.processBatch({ barbershopId: shop.barbershopId })) > 0) {
      // processa até esvaziar (um evento pode gerar outro, ex.: aprovado → reembolso)
    }
  };

  const pending = (shop: Tenant, type: string) =>
    prisma.outboxEvent.count({ where: { barbershopId: shop.barbershopId, type, status: 'PENDING' } });

  const myAppointment = async (shop: Tenant, token: string, id: string) => {
    const mine = await as(app, token).get(`/v1/public/${shop.slug}/me/appointments`).expect(200);
    return mine.body.find((appointment: { id: string }) => appointment.id === id) as {
      status: string;
      payment: Payment | null;
    };
  };

  /** O cliente paga no checkout simulado (o gateway aprova e avisa). */
  const payAtCheckout = async (checkoutUrl: string) => {
    const back = await server().get(checkoutUrl.replace('/api', '')).expect(303);
    return back.headers.location as string;
  };

  const webhookKey = async (shop: Tenant) =>
    (
      await prisma.withContext({ barbershopId: shop.barbershopId }, (tx) =>
        tx.paymentAccount.findFirstOrThrow({ where: { barbershopId: shop.barbershopId } }),
      )
    ).webhookKey;

  it('a página pública mostra como a reserva é paga, e nada sem conta, desligado ou fora do plano', async () => {
    const shop = await setupShop({ mode: 'OPTIONAL', amount: 'DEPOSIT', depositBps: 3000 });
    expect((await server().get(`/v1/public/${shop.slug}`).expect(200)).body.onlinePayment).toEqual({
      mode: 'OPTIONAL',
      amount: 'DEPOSIT',
      depositBps: 3000,
    });

    const off = await setupShop({ mode: 'OFF', amount: 'FULL', depositBps: null });
    expect((await server().get(`/v1/public/${off.slug}`).expect(200)).body.onlinePayment).toBeNull();

    const noAccount = await registerTenant(app);
    expect((await server().get(`/v1/public/${noAccount.slug}`).expect(200)).body.onlinePayment).toBeNull();

    // Plano sem o recurso: novas reservas não cobram (decisão de 04/11/2026).
    await app.get(SubscriptionsService).grantPlan(shop.barbershopId, 'essential');
    expect((await server().get(`/v1/public/${shop.slug}`).expect(200)).body.onlinePayment).toBeNull();
    const client = await registerClient(shop.slug);
    const booked = await book(shop, client, at(nextDay(), '10:00'), true).expect(201);
    expect(booked.body.payment).toBeNull();
  });

  it('opcional: quem escolhe o balcão não paga; quem paga agora vai ao checkout com o sinal arredondado', async () => {
    const shop = await setupShop({ mode: 'OPTIONAL', amount: 'DEPOSIT', depositBps: 3333 });
    const client = await registerClient(shop.slug);

    const counter = await book(shop, client, at(nextDay(), '10:00')).expect(201);
    expect(counter.body.payment).toBeNull();

    const date = nextDay();
    const online = await book(shop, client, at(date, '10:00'), true).expect(201);
    // 33,33% de R$ 50 = R$ 16,665: meio centavo para cima.
    expect(online.body.payment).toMatchObject({ status: 'PENDING', amountCents: 1667, holdUntil: null });
    expect(online.body.payment.checkoutUrl).toMatch(/^\/api\/v1\/online-payments\/fake-checkout\//);
    // No opcional, a reserva já vale: o e-mail de confirmação não espera o pagamento.
    expect(
      await prisma.outboxEvent.count({
        where: { type: 'AppointmentBooked', payload: { path: ['appointmentId'], equals: online.body.id } },
      }),
    ).toBe(1);

    const checkout = gateway.inspect(
      (
        await prisma.withContext({ barbershopId: shop.barbershopId }, (tx) =>
          tx.bookingPayment.findFirstOrThrow({ where: { appointmentId: online.body.id } }),
        )
      ).id,
    )!;
    expect(checkout).toMatchObject({
      amountCents: 1667,
      title: expect.stringContaining('Corte (sinal)'),
      notificationUrl: `http://localhost:3000/api/v1/online-payments/webhook/${await webhookKey(shop)}`,
      backUrl: `http://localhost:3000/${shop.slug}/meus-agendamentos?pagamento=${online.body.id}`,
    });
    // O checkout do opcional vale por até 24 horas (e nunca depois do horário).
    expect(new Date(checkout.expiresAt).getTime() - Date.now()).toBeGreaterThan(23 * 3600_000);

    expect(await payAtCheckout(online.body.payment.checkoutUrl)).toBe(
      `/${shop.slug}/meus-agendamentos?pagamento=${online.body.id}`,
    );
    await process(shop);
    const paid = await myAppointment(shop, client, online.body.id);
    expect(paid.payment).toMatchObject({ status: 'PAID', amountCents: 1667, checkoutUrl: null });
    expect(paid.payment!.paidAt).not.toBeNull();
  });

  it('opcional: quem não pagou na reserva paga depois em "Meus agendamentos", com o checkout reaproveitado', async () => {
    const shop = await setupShop({ mode: 'OPTIONAL', amount: 'FULL', depositBps: null });
    const client = await registerClient(shop.slug);
    const booked = await book(shop, client, at(nextDay(), '10:00')).expect(201);

    const pay = () =>
      as(app, client).post(`/v1/public/${shop.slug}/me/appointments/${booked.body.id}/payment`);
    const first = await pay().expect(200);
    expect(first.body.payment).toMatchObject({ status: 'PENDING', amountCents: 5000 });
    const second = await pay().expect(200);
    expect(second.body.payment.checkoutUrl).toBe(first.body.payment.checkoutUrl);

    await payAtCheckout(first.body.payment.checkoutUrl);
    await process(shop);
    const paidAgain = await pay().expect(422);
    expect(paidAgain.body.type).toBe('https://tanaregua.app/problems/payment-not-open');

    // Desligado depois: quem não pagou não consegue mais pagar online.
    const other = await book(shop, client, at(nextDay(), '10:00')).expect(201);
    await as(app, shop.token)
      .put('/v1/online-payments/settings')
      .send({ mode: 'OFF', amount: 'FULL', depositBps: null })
      .expect(200);
    const off = await as(app, client)
      .post(`/v1/public/${shop.slug}/me/appointments/${other.body.id}/payment`)
      .expect(422);
    expect(off.body.type).toBe('https://tanaregua.app/problems/online-payment-off');
  });

  it('exigido: segura o horário por 15 minutos e só confirma por e-mail com o pagamento', async () => {
    const shop = await setupShop({ mode: 'REQUIRED', amount: 'FULL', depositBps: null });
    const client = await registerClient(shop.slug);
    const date = nextDay();
    const before = Date.now();
    const booked = await book(shop, client, at(date, '10:00'), false).expect(201);
    expect(booked.body.payment).toMatchObject({ status: 'PENDING', amountCents: 5000 });
    const holdUntil = new Date(booked.body.payment.holdUntil).getTime();
    expect(holdUntil - before).toBeGreaterThanOrEqual(15 * 60_000 - 1000);
    expect(holdUntil - before).toBeLessThanOrEqual(15 * 60_000 + 5000);

    // O horário fica ocupado enquanto segurado.
    const availability = await server()
      .get(`/v1/public/${shop.slug}/availability`)
      .query({ date, serviceIds: shop.corte })
      .expect(200);
    expect(availability.body.professionals[0].starts).not.toContain(at(date, '10:00'));
    const confirmations = () =>
      prisma.outboxEvent.count({
        where: { type: 'AppointmentBooked', payload: { path: ['appointmentId'], equals: booked.body.id } },
      });
    expect(await confirmations()).toBe(0);

    await payAtCheckout(booked.body.payment.checkoutUrl);
    await process(shop);
    expect((await myAppointment(shop, client, booked.body.id)).payment?.status).toBe('PAID');
    expect(await confirmations()).toBe(1);

    // O prazo vencido não derruba uma reserva já paga.
    const owner = ownerClient();
    await owner.outboxEvent.updateMany({
      where: { barbershopId: shop.barbershopId, type: 'BookingPaymentHoldExpired' },
      data: { nextAttemptAt: new Date(Date.now() - 1000) },
    });
    await owner.bookingPayment.updateMany({
      where: { barbershopId: shop.barbershopId },
      data: { holdUntil: new Date(Date.now() - 1000) },
    });
    await owner.$disconnect();
    await process(shop);
    expect(await myAppointment(shop, client, booked.body.id)).toMatchObject({
      status: 'SCHEDULED',
      payment: { status: 'PAID' },
    });
  });

  describe('exigido sem pagamento no prazo', () => {
    /** Faz o prazo do pagamento da reserva já ter passado e roda o outbox. */
    const expire = async (shop: Tenant, appointmentId: string) => {
      const owner = ownerClient();
      const payment = await owner.bookingPayment.findFirstOrThrow({ where: { appointmentId } });
      await owner.bookingPayment.update({
        where: { id: payment.id },
        data: { holdUntil: new Date(Date.now() - 1000) },
      });
      await owner.outboxEvent.updateMany({
        where: {
          barbershopId: shop.barbershopId,
          type: 'BookingPaymentHoldExpired',
          payload: { path: ['bookingPaymentId'], equals: payment.id },
        },
        data: { nextAttemptAt: new Date(Date.now() - 1000) },
      });
      await owner.$disconnect();
      await process(shop);
    };

    it('a reserva cai e o horário volta; pago depois, confirma se o horário ainda está livre', async () => {
      const shop = await setupShop({ mode: 'REQUIRED', amount: 'FULL', depositBps: null });
      const client = await registerClient(shop.slug);
      const date = nextDay();
      const booked = await book(shop, client, at(date, '10:00')).expect(201);

      await expire(shop, booked.body.id);
      expect(await myAppointment(shop, client, booked.body.id)).toMatchObject({
        status: 'CANCELLED',
        payment: { status: 'EXPIRED', checkoutUrl: null },
      });
      const availability = await server()
        .get(`/v1/public/${shop.slug}/availability`)
        .query({ date, serviceIds: shop.corte })
        .expect(200);
      expect(availability.body.professionals[0].starts).toContain(at(date, '10:00'));

      // Um Pix pago no minuto 17: o horário continua livre, a reserva volta a valer.
      await payAtCheckout(booked.body.payment.checkoutUrl);
      await process(shop);
      expect(await myAppointment(shop, client, booked.body.id)).toMatchObject({
        status: 'SCHEDULED',
        payment: { status: 'PAID' },
      });
    });

    it('pago depois de outro cliente pegar o horário: reembolso integral automático', async () => {
      const shop = await setupShop({ mode: 'REQUIRED', amount: 'FULL', depositBps: null });
      const client = await registerClient(shop.slug);
      const date = nextDay();
      const booked = await book(shop, client, at(date, '10:00')).expect(201);
      await expire(shop, booked.body.id);

      const other = await registerClient(shop.slug);
      await book(shop, other, at(date, '10:00')).expect(201);

      await payAtCheckout(booked.body.payment.checkoutUrl);
      await process(shop);
      const refunded = await myAppointment(shop, client, booked.body.id);
      expect(refunded).toMatchObject({ status: 'CANCELLED', payment: { status: 'REFUNDED' } });
      expect(refunded.payment!.refundedAt).not.toBeNull();
    });
  });

  it('o cliente cancela no prazo: reembolso integral automático, uma vez só no gateway', async () => {
    const shop = await setupShop({ mode: 'REQUIRED', amount: 'DEPOSIT', depositBps: 5000 });
    const client = await registerClient(shop.slug);
    const booked = await book(shop, client, at(nextDay(), '10:00')).expect(201);
    await payAtCheckout(booked.body.payment.checkoutUrl);
    await process(shop);

    const cancelled = await as(app, client)
      .post(`/v1/public/${shop.slug}/me/appointments/${booked.body.id}/cancel`)
      .expect(200);
    expect(cancelled.body.payment).toMatchObject({ status: 'REFUND_PENDING', amountCents: 2500 });
    await process(shop);
    expect((await myAppointment(shop, client, booked.body.id)).payment?.status).toBe('REFUNDED');
    const bookingPaymentId = (
      await prisma.withContext({ barbershopId: shop.barbershopId }, (tx) =>
        tx.bookingPayment.findFirstOrThrow({ where: { appointmentId: booked.body.id } }),
      )
    ).id;
    expect(gateway.refunds.get(`refund:${bookingPaymentId}`)).toBeDefined();
  });

  it('cancelar uma reserva ainda não paga encerra o pagamento; um pagamento que chegue depois é devolvido', async () => {
    const shop = await setupShop({ mode: 'OPTIONAL', amount: 'FULL', depositBps: null });
    const client = await registerClient(shop.slug);
    const booked = await book(shop, client, at(nextDay(), '10:00'), true).expect(201);
    const cancelled = await as(app, client)
      .post(`/v1/public/${shop.slug}/me/appointments/${booked.body.id}/cancel`)
      .expect(200);
    expect(cancelled.body.payment.status).toBe('CANCELLED');

    await payAtCheckout(booked.body.payment.checkoutUrl);
    await process(shop);
    expect((await myAppointment(shop, client, booked.body.id)).payment?.status).toBe('REFUNDED');
  });

  describe('a barbearia cancela uma reserva paga', () => {
    const paidBooking = async (date: string) => {
      const shop = await setupShop({ mode: 'REQUIRED', amount: 'FULL', depositBps: null });
      const client = await registerClient(shop.slug);
      const booked = await book(shop, client, at(date, '10:00')).expect(201);
      await payAtCheckout(booked.body.payment.checkoutUrl);
      await process(shop);
      const cancel = (body: object) =>
        as(app, shop.token)
          .post(`/v1/appointments/${booked.body.id}/status`)
          .send({ status: 'CANCELLED', ...body });
      return { shop, client, booked, cancel };
    };

    it('o painel precisa dizer o motivo; imprevisto da barbearia reembolsa', async () => {
      const { shop, booked, cancel } = await paidBooking(nextDay());
      const missing = await cancel({}).expect(422);
      expect(missing.body.type).toBe('https://tanaregua.app/problems/cancellation-kind-required');

      const cancelled = await cancel({ cancellation: 'BARBERSHOP' }).expect(200);
      expect(cancelled.body).toMatchObject({ status: 'CANCELLED', payment: { status: 'REFUND_PENDING' } });
      await process(shop);
      const day = await as(app, shop.token).get(`/v1/appointments/${booked.body.id}`).expect(200);
      expect(day.body.payment.status).toBe('REFUNDED');
    });

    it('a pedido do cliente fora do prazo dele: o valor fica com a barbearia', async () => {
      const { shop, cancel } = await paidBooking(futureDate(2));
      // Prazo de cancelamento de 7 dias: a reserva daqui a 2 dias já passou dele.
      await as(app, shop.token)
        .patch('/v1/barbershop')
        .send({ cancellationMinNoticeMinutes: 7 * 24 * 60 })
        .expect(200);
      const cancelled = await cancel({ cancellation: 'CLIENT_REQUEST' }).expect(200);
      expect(cancelled.body.payment).toMatchObject({ status: 'PAID', refundedAt: null });
      expect(await pending(shop, 'BookingPaymentRefund')).toBe(0);
    });

    it('a pedido do cliente dentro do prazo dele: reembolsa', async () => {
      const { cancel } = await paidBooking(nextDay());
      const cancelled = await cancel({ cancellation: 'CLIENT_REQUEST' }).expect(200);
      expect(cancelled.body.payment.status).toBe('REFUND_PENDING');
    });
  });

  describe('notificação do gateway na URL da conta', () => {
    const notify = (key: string, paymentId: string, secret = WEBHOOK_SECRET) => {
      const requestId = randomUUID();
      return server()
        .post(`/v1/online-payments/webhook/${key}`)
        .query({ type: 'payment', 'data.id': paymentId })
        .set('x-request-id', requestId)
        .set('x-signature', signMercadoPagoNotification(paymentId, requestId, secret))
        .send({ id: `evento-${paymentId}`, type: 'payment', data: { id: paymentId } });
    };

    it('confere a assinatura com o segredo da conta, ignora repetidas e aplica pela consulta ao gateway', async () => {
      const shop = await setupShop({ mode: 'OPTIONAL', amount: 'FULL', depositBps: null });
      const client = await registerClient(shop.slug);
      const booked = await book(shop, client, at(nextDay(), '10:00'), true).expect(201);
      const checkoutId = booked.body.payment.checkoutUrl.split('/').at(-1);
      const { paymentId } = gateway.approve(checkoutId);
      const key = await webhookKey(shop);

      await notify(key, paymentId, 'segredo-errado').expect(401);
      await notify('chave-que-nao-existe', paymentId).expect(404);
      expect(await pending(shop, 'BookingPaymentChanged')).toBe(0);

      expect((await notify(key, paymentId).expect(200)).body).toEqual({ received: true });
      await notify(key, paymentId).expect(200);
      expect(await pending(shop, 'BookingPaymentChanged')).toBe(1);

      await process(shop);
      expect((await myAppointment(shop, client, booked.body.id)).payment?.status).toBe('PAID');
    });

    it('um segundo pagamento da mesma reserva (ou com valor diferente) é devolvido', async () => {
      const shop = await setupShop({ mode: 'OPTIONAL', amount: 'FULL', depositBps: null });
      const client = await registerClient(shop.slug);
      const booked = await book(shop, client, at(nextDay(), '10:00'), true).expect(201);
      const checkoutId = booked.body.payment.checkoutUrl.split('/').at(-1);
      const key = await webhookKey(shop);

      const wrong = gateway.approve(checkoutId, { amountCents: 100 });
      const first = gateway.approve(checkoutId);
      const second = gateway.approve(checkoutId);
      for (const payment of [wrong, first, second]) await notify(key, payment.paymentId).expect(200);
      await process(shop);

      expect((await myAppointment(shop, client, booked.body.id)).payment?.status).toBe('PAID');
      expect(gateway.refunds.get(`extra:${wrong.paymentId}`)).toBe(wrong.paymentId);
      // Vale o primeiro dos dois que o outbox aplicar (podem chegar juntos); o outro volta.
      const refunded = [first, second].filter((payment) => gateway.refunds.has(`extra:${payment.paymentId}`));
      expect(refunded).toHaveLength(1);
    });

    it('a chave de uma barbearia não mexe nos pagamentos de outra', async () => {
      const shop = await setupShop({ mode: 'OPTIONAL', amount: 'FULL', depositBps: null });
      const other = await setupShop({ mode: 'OPTIONAL', amount: 'FULL', depositBps: null });
      const client = await registerClient(other.slug);
      const booked = await book(other, client, at(nextDay(), '10:00'), true).expect(201);
      const { paymentId } = gateway.approve(booked.body.payment.checkoutUrl.split('/').at(-1));

      // Na URL da outra conta, a consulta usa o token dela: o gateway não acha o pagamento.
      await notify(await webhookKey(shop), paymentId).expect(200);
      await app.get(OutboxProcessor).processBatch({ barbershopId: shop.barbershopId });
      expect((await myAppointment(other, client, booked.body.id)).payment?.status).toBe('PENDING');
    });
  });

  it('isolamento: o pagamento é da barbearia e do cliente donos da reserva', async () => {
    const shop = await setupShop({ mode: 'OPTIONAL', amount: 'FULL', depositBps: null });
    const other = await setupShop({ mode: 'OPTIONAL', amount: 'FULL', depositBps: null });
    const client = await registerClient(shop.slug);
    const booked = await book(shop, client, at(nextDay(), '10:00'), true).expect(201);

    // Outro cliente da mesma barbearia não paga a reserva alheia.
    const stranger = await registerClient(shop.slug);
    await as(app, stranger)
      .post(`/v1/public/${shop.slug}/me/appointments/${booked.body.id}/payment`)
      .expect(404);
    // A equipe de outra barbearia não vê a reserva (nem o pagamento).
    await expectTenantIsolation(app, other, [
      { method: 'get', url: `/v1/appointments/${booked.body.id}` },
      { method: 'post', url: `/v1/appointments/${booked.body.id}/status`, body: { status: 'CANCELLED' } },
    ]);
    // E o banco (RLS) não mostra o pagamento no tenant da outra.
    const leaked = await prisma.withContext({ barbershopId: other.barbershopId }, (tx) =>
      tx.bookingPayment.findMany({ where: { appointmentId: booked.body.id } }),
    );
    expect(leaked).toEqual([]);
  });
});
