import { randomUUID } from 'node:crypto';
import { localTimeToInstant } from '../src/modules/appointments/availability.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { as, createTestApp, registerTenant, type Tenant, type TestApp } from './helpers/app.js';
import { expectTenantIsolation, login } from './helpers/isolation.js';

const SP = 'America/Sao_Paulo';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: SP }).format(new Date());
const futureDate = (days: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: SP }).format(new Date(Date.now() + days * 24 * 3600_000));
const at = (date: string, clock: string) => {
  const [h, m] = clock.split(':').map(Number);
  return localTimeToInstant(date, h! * 60 + m!, SP).toISOString();
};

describe('Comanda, financeiro e relatórios (e2e)', () => {
  let app: TestApp;
  let shop: Tenant;
  let other: Tenant;
  let barber: { id: string; token: string };
  let receptionist: { id: string; token: string };
  let clientId: string;
  let corte: string; // R$ 50 — regra do serviço: 40%
  let barba: string; // R$ 30 — barbeiro+barba: R$ 12 fixo
  let slot = 0;

  const owner = () => as(app, shop.token);
  const staff = async (roleKey: string, isProfessional: boolean) => {
    const email = `${roleKey}-${randomUUID().slice(0, 8)}@teste.com`;
    const response = await owner()
      .post('/v1/staff')
      .send({ name: `${roleKey} Teste`, email, password: 'senha-forte-123', roleKey, isProfessional })
      .expect(201);
    return { id: response.body.id as string, token: await login(app, email, 'senha-forte-123') };
  };

  /** Agendamento num horário livre e único para cada teste. */
  const appointment = async (professionalId: string, serviceIds: string[]) => {
    const date = futureDate(60 + Math.floor(slot / 8));
    const clock = `${String(9 + (slot % 8)).padStart(2, '0')}:00`;
    slot++;
    const response = await owner()
      .post('/v1/appointments')
      .send({ professionalId, clientId, serviceIds, startsAt: at(date, clock) })
      .expect(201);
    return response.body.id as string;
  };

  beforeAll(async () => {
    app = await createTestApp();
    shop = await registerTenant(app);
    other = await registerTenant(app);
    barber = await staff('professional', true);
    receptionist = await staff('receptionist', false);
    clientId = (await owner().post('/v1/clients').send({ name: 'Rafael Cliente' }).expect(201)).body.id;
    corte = (
      await owner()
        .post('/v1/services')
        .send({ name: 'Corte', priceCents: 5000, durationMinutes: 30 })
        .expect(201)
    ).body.id;
    barba = (
      await owner()
        .post('/v1/services')
        .send({ name: 'Barba', priceCents: 3000, durationMinutes: 20 })
        .expect(201)
    ).body.id;

    const rules = [
      { membershipId: null, serviceId: corte, type: 'PERCENT', value: 4000 },
      { membershipId: barber.id, serviceId: null, type: 'PERCENT', value: 3000 },
      { membershipId: barber.id, serviceId: barba, type: 'FIXED', value: 1200 },
    ];
    for (const rule of rules) await owner().put('/v1/commission-rules').send(rule).expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  it('abre a comanda a partir do agendamento e fecha numa transação só', async () => {
    const appointmentId = await appointment(barber.id, [corte, barba]);
    const opened = await owner().post('/v1/orders').send({ appointmentId }).expect(201);
    expect(opened.body).toMatchObject({ status: 'OPEN', totalCents: 8000, client: { id: clientId } });
    // Previsão: corte pela regra do serviço (40% = 2000) vence o padrão do barbeiro (30%);
    // barba pela regra específica barbeiro+serviço (fixo 1200).
    expect(opened.body.items.map((item: { commissionCents: number }) => item.commissionCents)).toEqual([
      2000, 1200,
    ]);

    const closed = await owner()
      .post(`/v1/orders/${opened.body.id}/close`)
      .set('Idempotency-Key', randomUUID())
      .send({ paymentMethod: 'PIX' })
      .expect(200);
    expect(closed.body).toMatchObject({ status: 'CLOSED', paymentMethod: 'PIX', totalCents: 8000 });

    const appointmentAfter = await owner().get(`/v1/appointments/${appointmentId}`).expect(200);
    expect(appointmentAfter.body.status).toBe('COMPLETED');

    await owner().post('/v1/orders').send({ appointmentId }).expect(409);
  });

  it('comissão fica congelada: mudar a regra depois não altera o passado', async () => {
    const appointmentId = await appointment(barber.id, [corte]);
    const order = (await owner().post('/v1/orders').send({ appointmentId }).expect(201)).body;
    await owner().post(`/v1/orders/${order.id}/close`).send({ paymentMethod: 'CASH' }).expect(200);

    await owner()
      .put('/v1/commission-rules')
      .send({ membershipId: null, serviceId: corte, type: 'PERCENT', value: 9000 })
      .expect(200);
    try {
      const after = await owner().get(`/v1/orders/${order.id}`).expect(200);
      expect(after.body.items[0].commissionCents).toBe(2000);
    } finally {
      await owner()
        .put('/v1/commission-rules')
        .send({ membershipId: null, serviceId: corte, type: 'PERCENT', value: 4000 })
        .expect(200);
    }
  });

  it('comanda fechada é imutável na API e no banco', async () => {
    const appointmentId = await appointment(shop.membershipId, [corte]);
    const order = (await owner().post('/v1/orders').send({ appointmentId }).expect(201)).body;
    await owner().post(`/v1/orders/${order.id}/close`).send({ paymentMethod: 'CARD_DEBIT' }).expect(200);

    const add = await owner()
      .post(`/v1/orders/${order.id}/items`)
      .send({ serviceId: barba, professionalId: shop.membershipId })
      .expect(422);
    expect(add.body.type).toMatch(/order-not-open$/);
    await owner()
      .patch(`/v1/orders/${order.id}/items/${order.items[0].id}`)
      .send({ discountCents: 100 })
      .expect(422);

    const prisma = app.get(PrismaService);
    // Trigger: itens de comanda fechada não mudam, mesmo passando por cima da aplicação.
    await expect(
      prisma.withContext({ barbershopId: shop.barbershopId }, (tx) =>
        tx.orderItem.update({
          where: { id: order.items[0].id },
          data: { discountCents: 100, totalCents: 4900 },
        }),
      ),
    ).rejects.toThrow(/immutable/);
    // Lançamentos são append-only: o usuário da aplicação não tem UPDATE nem DELETE.
    await expect(
      prisma.withContext({ barbershopId: shop.barbershopId }, (tx) =>
        tx.cashEntry.updateMany({ where: { orderId: order.id }, data: { amountCents: 1 } }),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      prisma.withContext({ barbershopId: shop.barbershopId }, (tx) =>
        tx.commissionEntry.deleteMany({ where: { orderId: order.id } }),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('estorno gera lançamentos inversos e zera o efeito no caixa e nas comissões', async () => {
    const appointmentId = await appointment(barber.id, [barba]);
    const order = (await owner().post('/v1/orders').send({ appointmentId }).expect(201)).body;
    await owner().post(`/v1/orders/${order.id}/close`).send({ paymentMethod: 'CASH' }).expect(200);

    await owner().post(`/v1/orders/${order.id}/void`).send({ reason: 'x' }).expect(400);
    const voided = await owner()
      .post(`/v1/orders/${order.id}/void`)
      .send({ reason: 'Cobrança duplicada' })
      .expect(200);
    expect(voided.body).toMatchObject({ status: 'VOIDED', voidReason: 'Cobrança duplicada' });
    await owner().post(`/v1/orders/${order.id}/void`).send({ reason: 'De novo' }).expect(422);

    const prisma = app.get(PrismaService);
    const sums = await prisma.withContext({ barbershopId: shop.barbershopId }, async (tx) => ({
      cash: await tx.cashEntry.aggregate({
        where: { orderId: order.id },
        _sum: { amountCents: true },
        _count: true,
      }),
      commission: await tx.commissionEntry.aggregate({
        where: { orderId: order.id },
        _sum: { amountCents: true },
        _count: true,
      }),
    }));
    expect(sums.cash).toMatchObject({ _sum: { amountCents: 0 }, _count: 2 });
    expect(sums.commission).toMatchObject({ _sum: { amountCents: 0 }, _count: 2 });
  });

  it('comanda avulsa: desconto por item, validações e descarte da aberta', async () => {
    const opened = await owner()
      .post('/v1/orders')
      .send({ items: [{ serviceId: corte, professionalId: shop.membershipId, discountCents: 500 }] })
      .expect(201);
    expect(opened.body).toMatchObject({ client: null, totalCents: 4500 });

    await owner()
      .post(`/v1/orders/${opened.body.id}/items`)
      .send({ serviceId: barba, professionalId: shop.membershipId, discountCents: 3001 })
      .expect(422);
    const withItem = await owner()
      .post(`/v1/orders/${opened.body.id}/items`)
      .send({ serviceId: barba, professionalId: shop.membershipId, quantity: 2 })
      .expect(201);
    expect(withItem.body.totalCents).toBe(4500 + 6000);

    const empty = await owner().post('/v1/orders').send({}).expect(201);
    const closeEmpty = await owner()
      .post(`/v1/orders/${empty.body.id}/close`)
      .send({ paymentMethod: 'PIX' })
      .expect(422);
    expect(closeEmpty.body.type).toMatch(/order-empty$/);

    // Comanda aberta pode ser descartada sem gerar lançamentos.
    await owner().post(`/v1/orders/${empty.body.id}/void`).send({ reason: 'Aberta por engano' }).expect(200);
  });

  it('dois fechamentos simultâneos: só um vale e só há um lançamento de caixa', async () => {
    const appointmentId = await appointment(shop.membershipId, [corte]);
    const order = (await owner().post('/v1/orders').send({ appointmentId }).expect(201)).body;
    const attempts = await Promise.all([
      owner().post(`/v1/orders/${order.id}/close`).send({ paymentMethod: 'PIX' }),
      owner().post(`/v1/orders/${order.id}/close`).send({ paymentMethod: 'CASH' }),
    ]);
    expect(attempts.map((attempt) => attempt.status).sort((a, b) => a - b)).toEqual([200, 422]);

    const prisma = app.get(PrismaService);
    const count = await prisma.withContext({ barbershopId: shop.barbershopId }, (tx) =>
      tx.cashEntry.count({ where: { orderId: order.id } }),
    );
    expect(count).toBe(1);
  });

  it('respeita os papéis: recepção fecha mas não estorna; profissional não mexe em comandas', async () => {
    const appointmentId = await appointment(barber.id, [corte]);
    const order = (await as(app, receptionist.token).post('/v1/orders').send({ appointmentId }).expect(201))
      .body;
    await as(app, receptionist.token)
      .post(`/v1/orders/${order.id}/close`)
      .send({ paymentMethod: 'PIX' })
      .expect(200);
    await as(app, receptionist.token)
      .post(`/v1/orders/${order.id}/void`)
      .send({ reason: 'Tentativa' })
      .expect(403);
    await as(app, barber.token).get(`/v1/orders/${order.id}`).expect(403);
  });

  it('profissional vê só as próprias comissões', async () => {
    const date = today();
    const mine = await as(app, barber.token)
      .get('/v1/commissions')
      .query({ from: date, to: date })
      .expect(200);
    expect(
      mine.body.professionals.every((p: { professionalId: string }) => p.professionalId === barber.id),
    ).toBe(true);
    expect(mine.body.professionals[0].totalCents).toBeGreaterThan(0);

    await as(app, barber.token)
      .get('/v1/commissions')
      .query({ from: date, to: date, professionalId: shop.membershipId })
      .expect(403);
  });

  it('caixa do dia soma por forma de pagamento com estornos abatidos', async () => {
    const tenant = await registerTenant(app);
    const t = as(app, tenant.token);
    const service = (
      await t.post('/v1/services').send({ name: 'Corte', priceCents: 4000, durationMinutes: 30 }).expect(201)
    ).body.id;
    const sell = async (paymentMethod: string) => {
      const order = (
        await t
          .post('/v1/orders')
          .send({ items: [{ serviceId: service, professionalId: tenant.membershipId }] })
          .expect(201)
      ).body;
      await t.post(`/v1/orders/${order.id}/close`).send({ paymentMethod }).expect(200);
      return order.id as string;
    };
    await sell('PIX');
    await sell('PIX');
    const refunded = await sell('CASH');
    await t.post(`/v1/orders/${refunded}/void`).send({ reason: 'Desistiu' }).expect(200);

    const cash = await t.get('/v1/cash/day').query({ date: today() }).expect(200);
    expect(cash.body.totals).toMatchObject({ PIX: 8000, CASH: 0 });
    expect(cash.body.netCents).toBe(8000);
    expect(cash.body.entries).toHaveLength(4);
  });

  it('relatório consolida faturamento, profissionais, serviços e no-show', async () => {
    const tenant = await registerTenant(app);
    const t = as(app, tenant.token);
    const service = (
      await t.post('/v1/services').send({ name: 'Corte', priceCents: 5000, durationMinutes: 30 }).expect(201)
    ).body.id;
    const client = (await t.post('/v1/clients').send({ name: 'Joana' }).expect(201)).body.id;

    // Um atendimento concluído e uma falta hoje.
    const date = today();
    const book = async (clock: string) =>
      (
        await t
          .post('/v1/appointments')
          .send({
            professionalId: tenant.membershipId,
            clientId: client,
            serviceIds: [service],
            startsAt: at(date, clock),
          })
          .expect(201)
      ).body.id as string;
    const done = await book('06:00');
    const missed = await book('07:00');
    await t.post(`/v1/appointments/${missed}/status`).send({ status: 'NO_SHOW' }).expect(200);
    const order = (await t.post('/v1/orders').send({ appointmentId: done }).expect(201)).body;
    await t.post(`/v1/orders/${order.id}/close`).send({ paymentMethod: 'PIX' }).expect(200);

    const report = await t.get('/v1/reports/summary').query({ from: date, to: date }).expect(200);
    expect(report.body.revenue).toEqual({ netCents: 5000, byDay: [{ day: date, netCents: 5000 }] });
    expect(report.body.professionals).toEqual([
      { professionalId: tenant.membershipId, name: 'Dono Teste', revenueCents: 5000, services: 1 },
    ]);
    expect(report.body.topServices).toEqual([
      { serviceId: service, name: 'Corte', quantity: 1, revenueCents: 5000 },
    ]);
    expect(report.body.appointments.noShowRate).toBe(0.5);

    await as(app, receptionist.token).get('/v1/reports/summary').query({ from: date, to: date }).expect(403);
  });

  it('isola comandas entre barbearias', async () => {
    const order = (
      await owner()
        .post('/v1/orders')
        .send({ items: [{ serviceId: corte, professionalId: shop.membershipId }] })
        .expect(201)
    ).body;
    await expectTenantIsolation(app, other, [
      { method: 'get', url: `/v1/orders/${order.id}` },
      {
        method: 'post',
        url: `/v1/orders/${order.id}/items`,
        body: { serviceId: corte, professionalId: other.membershipId },
      },
      { method: 'patch', url: `/v1/orders/${order.id}/items/${order.items[0].id}`, body: { quantity: 2 } },
      { method: 'delete', url: `/v1/orders/${order.id}/items/${order.items[0].id}` },
      { method: 'post', url: `/v1/orders/${order.id}/close`, body: { paymentMethod: 'PIX' } },
      { method: 'post', url: `/v1/orders/${order.id}/void`, body: { reason: 'Invasão' } },
    ]);
  });
});
