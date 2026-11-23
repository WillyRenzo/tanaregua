import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { localTimeToInstant } from '../src/modules/appointments/availability.js';
import { OutboxProcessor } from '../src/modules/notifications/outbox.processor.js';
import { FakeMerchantGateway, MerchantGateway } from '../src/modules/online-payments/merchant-gateway.js';
import { as, createTestApp, registerTenant, type Tenant, type TestApp } from './helpers/app.js';
import { expectTenantIsolation, login } from './helpers/isolation.js';

const SP = 'America/Sao_Paulo';
const localDate = (instant: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: SP }).format(instant);
const futureDate = (days: number) => localDate(new Date(Date.now() + days * 24 * 3600_000));
const at = (date: string, clock: string) => {
  const [h, m] = clock.split(':').map(Number);
  return localTimeToInstant(date, h! * 60 + m!, SP).toISOString();
};

type Shop = Tenant & { corte: string };
type CashEntry = { method: string; kind: string; amountCents: number; appointmentId: string | null };

/**
 * Pagamento online na comanda e no caixa (business-rules §5, entrega 3, decisões de 30/10 e
 * 23/11/2026): o pago abate na comanda, o retido de falta entra no caixa sem comissão, o estorno
 * mantém a parte online como retida e o reembolso pelo painel sai do caixa.
 */
describe('Pagamento online na comanda e no caixa (e2e)', () => {
  let app: TestApp;
  let gateway: FakeMerchantGateway;
  let day = 30;
  const nextDay = () => futureDate(day++);
  const server = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
    gateway = app.get(MerchantGateway) as FakeMerchantGateway;
  });

  afterAll(async () => {
    await app.close();
  });

  /** Corte de R$ 50 com comissão de 40%, expediente todo dia e a conta conectada. */
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
      .put('/v1/commission-rules')
      .send({ membershipId: null, serviceId: corte, type: 'PERCENT', value: 4000 })
      .expect(200);
    await as(app, shop.token)
      .put('/v1/online-payments/account')
      .send({ accessToken: `APP_USR-token-${shop.slug}`, webhookSecret: 'segredo-de-webhooks-da-barbearia' })
      .expect(200);
    await as(app, shop.token).put('/v1/online-payments/settings').send(settings).expect(200);
    return { ...shop, corte };
  };

  const process = async (shop: Tenant) => {
    const processor = app.get(OutboxProcessor);
    while ((await processor.processBatch({ barbershopId: shop.barbershopId })) > 0) {
      // até esvaziar
    }
  };

  /** Reserva online do cliente; `paid` paga no checkout simulado e aplica a notificação. */
  const bookOnline = async (shop: Shop, options: { paid: boolean; date?: string }) => {
    const client = await server()
      .post(`/v1/public/${shop.slug}/auth/register`)
      .send({
        name: 'Paula Cliente',
        email: `cliente-${randomUUID().slice(0, 8)}@teste.com`,
        password: 'senha-forte-123',
      })
      .expect(201);
    const booked = await as(app, client.body.accessToken as string)
      .post(`/v1/public/${shop.slug}/bookings`)
      .set('Idempotency-Key', randomUUID())
      .send({ serviceIds: [shop.corte], startsAt: at(options.date ?? nextDay(), '10:00'), payOnline: true })
      .expect(201);
    if (options.paid) {
      await server().get(booked.body.payment.checkoutUrl.replace('/api', '')).expect(303);
      await process(shop);
    }
    return booked.body.id as string;
  };

  const payment = async (shop: Shop, appointmentId: string) =>
    (await as(app, shop.token).get(`/v1/appointments/${appointmentId}`).expect(200)).body.payment;

  const cashToday = async (shop: Shop, appointmentId: string) => {
    const cash = await as(app, shop.token)
      .get('/v1/cash/day')
      .query({ date: localDate(new Date()) })
      .expect(200);
    return (cash.body.entries as CashEntry[]).filter((entry) => entry.appointmentId === appointmentId);
  };

  const commissions = async (shop: Shop) => {
    const today = localDate(new Date());
    const summary = await as(app, shop.token)
      .get('/v1/commissions')
      .query({ from: today, to: today })
      .expect(200);
    return (summary.body.professionals as { totalCents: number }[]).reduce(
      (sum, row) => sum + row.totalCents,
      0,
    );
  };

  const openOrder = async (shop: Shop, appointmentId: string) =>
    (await as(app, shop.token).post('/v1/orders').send({ appointmentId }).expect(201)).body as {
      id: string;
      prepaidCents: number;
      items: { id: string }[];
    };

  it('o sinal pago abate na comanda: o restante vai no balcão, e a comissão é sobre o total', async () => {
    const shop = await setupShop({ mode: 'OPTIONAL', amount: 'DEPOSIT', depositBps: 3000 });
    const appointmentId = await bookOnline(shop, { paid: true });
    expect(await payment(shop, appointmentId)).toMatchObject({ status: 'PAID', settlement: null });

    const order = await openOrder(shop, appointmentId);
    expect(order.prepaidCents).toBe(1500);

    const missing = await as(app, shop.token).post(`/v1/orders/${order.id}/close`).send({}).expect(422);
    expect(missing.body.type).toBe('https://tanaregua.app/problems/payment-method-required');

    const closed = await as(app, shop.token)
      .post(`/v1/orders/${order.id}/close`)
      .send({ paymentMethod: 'PIX' })
      .expect(200);
    expect(closed.body).toMatchObject({ totalCents: 5000, prepaidCents: 1500, paymentMethod: 'PIX' });
    expect(await payment(shop, appointmentId)).toMatchObject({ settlement: 'ORDER', settledCents: 1500 });

    const entries = await cashToday(shop, appointmentId);
    expect(entries.map(({ method, kind, amountCents }) => ({ method, kind, amountCents }))).toEqual([
      { method: 'ONLINE', kind: 'ENTRY', amountCents: 1500 },
      { method: 'PIX', kind: 'ENTRY', amountCents: 3500 },
    ]);
    expect(await commissions(shop)).toBe(2000);
  });

  it('pago a mais que o total: a comanda fecha sem forma do balcão e a diferença volta sozinha', async () => {
    const shop = await setupShop({ mode: 'OPTIONAL', amount: 'FULL', depositBps: null });
    const appointmentId = await bookOnline(shop, { paid: true });
    const order = await openOrder(shop, appointmentId);
    await as(app, shop.token)
      .patch(`/v1/orders/${order.id}/items/${order.items[0]!.id}`)
      .send({ discountCents: 1000 })
      .expect(200);

    const closed = await as(app, shop.token).post(`/v1/orders/${order.id}/close`).send({}).expect(200);
    expect(closed.body).toMatchObject({ totalCents: 4000, prepaidCents: 4000, paymentMethod: 'ONLINE' });
    expect(await cashToday(shop, appointmentId)).toEqual([
      expect.objectContaining({ method: 'ONLINE', kind: 'ENTRY', amountCents: 4000 }),
    ]);

    expect((await payment(shop, appointmentId)).refunds).toEqual([
      expect.objectContaining({ kind: 'DIFFERENCE', amountCents: 1000, status: 'PENDING' }),
    ]);
    await process(shop);
    const refunds = (await payment(shop, appointmentId)).refunds as { status: string; refundedAt: string }[];
    expect(refunds[0]).toMatchObject({ status: 'DONE', refundedAt: expect.any(String) });
    expect([...gateway.refundAmounts.values()]).toContain(1000);
  });

  it('falta com reserva paga: o valor entra no caixa do dia, sem comissão, e o dono reembolsa uma vez', async () => {
    const shop = await setupShop({ mode: 'REQUIRED', amount: 'DEPOSIT', depositBps: 4000 });
    const appointmentId = await bookOnline(shop, { paid: true });
    await as(app, shop.token)
      .post(`/v1/appointments/${appointmentId}/status`)
      .send({ status: 'NO_SHOW' })
      .expect(200);

    expect(await payment(shop, appointmentId)).toMatchObject({ settlement: 'RETAINED', settledCents: 2000 });
    expect(await cashToday(shop, appointmentId)).toEqual([
      expect.objectContaining({ method: 'ONLINE', kind: 'ENTRY', amountCents: 2000 }),
    ]);
    expect(await commissions(shop)).toBe(0);

    const refund = (body: object) =>
      as(app, shop.token).post(`/v1/online-payments/bookings/${appointmentId}/refund`).send(body);
    const tooHigh = await refund({ amountCents: 2001, reason: 'Cliente avisou' }).expect(422);
    expect(tooHigh.body.type).toBe('https://tanaregua.app/problems/refund-too-high');
    await refund({ amountCents: 500, reason: 'x' }).expect(400);

    const done = await refund({ amountCents: 1200, reason: 'Cliente avisou do imprevisto' }).expect(200);
    expect(done.body.refunds).toEqual([expect.objectContaining({ kind: 'MANUAL', amountCents: 1200 })]);
    expect(await cashToday(shop, appointmentId)).toEqual([
      expect.objectContaining({ method: 'ONLINE', kind: 'ENTRY', amountCents: 2000 }),
      expect.objectContaining({ method: 'ONLINE', kind: 'REFUND', amountCents: -1200 }),
    ]);
    const again = await refund({ amountCents: 100, reason: 'De novo' }).expect(422);
    expect(again.body.type).toBe('https://tanaregua.app/problems/payment-already-refunded');

    await process(shop);
    expect((await payment(shop, appointmentId)).refunds[0].status).toBe('DONE');
    expect([...gateway.refundAmounts.values()]).toContain(1200);
  });

  it('cancelamento a pedido do cliente fora do prazo: o valor retido entra no caixa', async () => {
    const shop = await setupShop({ mode: 'REQUIRED', amount: 'FULL', depositBps: null });
    const appointmentId = await bookOnline(shop, { paid: true, date: futureDate(2) });
    await as(app, shop.token)
      .patch('/v1/barbershop')
      .send({ cancellationMinNoticeMinutes: 7 * 24 * 60 })
      .expect(200);
    await as(app, shop.token)
      .post(`/v1/appointments/${appointmentId}/status`)
      .send({ status: 'CANCELLED', cancellation: 'CLIENT_REQUEST' })
      .expect(200);
    expect(await payment(shop, appointmentId)).toMatchObject({ status: 'PAID', settlement: 'RETAINED' });
    expect(await cashToday(shop, appointmentId)).toEqual([
      expect.objectContaining({ method: 'ONLINE', kind: 'ENTRY', amountCents: 5000 }),
    ]);
  });

  it('estorno da comanda: desfaz o balcão e as comissões; a parte online fica no caixa como retida', async () => {
    const shop = await setupShop({ mode: 'OPTIONAL', amount: 'DEPOSIT', depositBps: 3000 });
    const appointmentId = await bookOnline(shop, { paid: true });
    const order = await openOrder(shop, appointmentId);
    await as(app, shop.token)
      .post(`/v1/orders/${order.id}/close`)
      .send({ paymentMethod: 'CASH' })
      .expect(200);
    await as(app, shop.token)
      .post(`/v1/orders/${order.id}/void`)
      .send({ reason: 'Lançado errado' })
      .expect(200);

    const net = (await cashToday(shop, appointmentId)).reduce((sum, entry) => sum + entry.amountCents, 0);
    expect(net).toBe(1500);
    expect(await commissions(shop)).toBe(0);
    expect(await payment(shop, appointmentId)).toMatchObject({ settlement: 'RETAINED', settledCents: 1500 });
    await as(app, shop.token)
      .post(`/v1/online-payments/bookings/${appointmentId}/refund`)
      .send({ amountCents: 1500, reason: 'Serviço não aconteceu' })
      .expect(200);
  });

  it('comanda fechada com o pagamento ainda pendente: o pagamento é encerrado (se chegar depois, volta)', async () => {
    const shop = await setupShop({ mode: 'OPTIONAL', amount: 'FULL', depositBps: null });
    const appointmentId = await bookOnline(shop, { paid: false });
    const order = await openOrder(shop, appointmentId);
    expect(order.prepaidCents).toBe(0);
    await as(app, shop.token).post(`/v1/orders/${order.id}/close`).send({ paymentMethod: 'PIX' }).expect(200);
    expect((await payment(shop, appointmentId)).status).toBe('CANCELLED');
  });

  it('reembolso pelo painel só do valor retido, só com a permissão de estorno e só na própria barbearia', async () => {
    const shop = await setupShop({ mode: 'OPTIONAL', amount: 'FULL', depositBps: null });
    const appointmentId = await bookOnline(shop, { paid: true });
    const url = `/v1/online-payments/bookings/${appointmentId}/refund`;
    const body = { amountCents: 1000, reason: 'Teste de reembolso' };

    const notRetained = await as(app, shop.token).post(url).send(body).expect(422);
    expect(notRetained.body.type).toBe('https://tanaregua.app/problems/payment-not-retained');

    const email = `barbeiro-${randomUUID().slice(0, 8)}@teste.com`;
    await as(app, shop.token)
      .post('/v1/staff')
      .send({
        name: 'Barbeiro',
        email,
        password: 'senha-forte-123',
        roleKey: 'professional',
        isProfessional: true,
      })
      .expect(201);
    await as(app, await login(app, email, 'senha-forte-123'))
      .post(url)
      .send(body)
      .expect(403);

    const other = await registerTenant(app);
    await expectTenantIsolation(app, other, [{ method: 'post', url, body }]);
  });
});
