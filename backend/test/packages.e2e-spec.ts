import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { Clock } from '../src/common/time/clock.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { as, createTestApp, registerTenant, type Tenant, type TestApp } from './helpers/app.js';
import { expectTenantIsolation, login } from './helpers/isolation.js';

/** business-rules §4 e §6: pacotes de sessões, saldo nunca negativo, validade e reembolso. */
describe('Pacotes de serviços (e2e)', () => {
  let app: TestApp;
  let shop: Tenant;
  let other: Tenant;
  let prisma: PrismaService;
  let corte: string;
  let barba: string;
  let clientId: string;

  const owner = () => as(app, shop.token);

  const createPackage = async (body: object = {}) =>
    (
      await owner()
        .post('/v1/packages')
        .send({
          name: `Combo ${randomUUID().slice(0, 6)}`,
          priceCents: 22000,
          validityDays: 60,
          items: [
            { serviceId: corte, quantity: 4 },
            { serviceId: barba, quantity: 2 },
          ],
          ...body,
        })
        .expect(201)
    ).body as { id: string; name: string };

  const openOrder = async (items: object[], client: string | null = clientId) =>
    (
      await owner()
        .post('/v1/orders')
        .send({ ...(client ? { clientId: client } : {}), items })
        .expect(201)
    ).body.id as string;

  const close = (orderId: string) =>
    owner().post(`/v1/orders/${orderId}/close`).send({ paymentMethod: 'PIX' });

  /** Vende o pacote ao cliente e devolve o pacote comprado. */
  const sell = async (packageId: string, client = clientId) => {
    const orderId = await openOrder([{ packageId }], client);
    await close(orderId).expect(200);
    const sold = await owner().get('/v1/client-packages').query({ clientId: client }).expect(200);
    const bought = (sold.body as { id: string; orderId: string }[]).find((row) => row.orderId === orderId)!;
    return { ...bought, saleOrderId: orderId } as unknown as {
      id: string;
      saleOrderId: string;
      balances: { serviceId: string; remaining: number }[];
    };
  };

  /** Comanda com um corte do dono, paga com o pacote; devolve o id da comanda. */
  const useSession = async (clientPackageId: string, service = corte, client = clientId) => {
    const orderId = await openOrder([{ serviceId: service, professionalId: shop.membershipId }], client);
    const order = await owner().get(`/v1/orders/${orderId}`).expect(200);
    await owner()
      .put(`/v1/orders/${orderId}/items/${order.body.items[0].id}/package`)
      .send({ clientPackageId })
      .expect(200);
    return orderId;
  };

  const balance = async (clientPackageId: string, service = corte) => {
    const sold = await owner().get('/v1/client-packages').expect(200);
    const row = (sold.body as { id: string; balances: { serviceId: string; remaining: number }[] }[]).find(
      (item) => item.id === clientPackageId,
    )!;
    return row.balances.find((item) => item.serviceId === service)!.remaining;
  };

  const newClient = async () =>
    (
      await owner()
        .post('/v1/clients')
        .send({ name: `Cliente ${randomUUID().slice(0, 6)}` })
        .expect(201)
    ).body.id as string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    shop = await registerTenant(app);
    other = await registerTenant(app);
    corte = (
      await owner().post('/v1/services').send({ name: 'Corte', priceCents: 5000, durationMinutes: 30 })
    ).body.id;
    barba = (
      await owner().post('/v1/services').send({ name: 'Barba', priceCents: 3500, durationMinutes: 20 })
    ).body.id;
    clientId = await newClient();
    // Corte comissiona 40% (base: valor da sessão quando pago com pacote).
    await owner()
      .put('/v1/commission-rules')
      .send({ membershipId: null, serviceId: corte, type: 'PERCENT', value: 4000 })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('venda', () => {
    it('vende na comanda do cliente: cria o pacote, os saldos e o caixa, sem comissão na venda', async () => {
      const template = await createPackage();
      const bought = await sell(template.id);
      expect(bought).toMatchObject({ status: 'ACTIVE', pricePaidCents: 22000, name: template.name });
      expect(Object.fromEntries(bought.balances.map((row) => [row.serviceId, row.remaining]))).toEqual({
        [corte]: 4,
        [barba]: 2,
      });
      const days =
        (Date.parse((bought as never as { expiresAt: string }).expiresAt) - Date.now()) / 86_400_000;
      expect(Math.round(days)).toBe(60);

      const ctx = { barbershopId: shop.barbershopId };
      const cash = await prisma.withContext(ctx, (tx) =>
        tx.cashEntry.findMany({ where: { orderId: bought.saleOrderId } }),
      );
      expect(cash).toMatchObject([{ kind: 'ENTRY', amountCents: 22000 }]);
      const commissions = await prisma.withContext(ctx, (tx) =>
        tx.commissionEntry.count({ where: { orderId: bought.saleOrderId } }),
      );
      expect(commissions).toBe(0);
    });

    it('pacote é do cliente: comanda sem cliente não vende pacote', async () => {
      const template = await createPackage();
      const orderId = await openOrder([], null);
      const refused = await owner()
        .post(`/v1/orders/${orderId}/items`)
        .send({ packageId: template.id })
        .expect(422);
      expect(refused.body.type).toMatch(/package-needs-client$/);
    });
  });

  describe('uso das sessões', () => {
    it('serviço pago com pacote cobra zero e comissiona sobre o valor da sessão', async () => {
      const bought = await sell((await createPackage()).id);
      const orderId = await useSession(bought.id);
      const open = await owner().get(`/v1/orders/${orderId}`).expect(200);
      expect(open.body.items[0]).toMatchObject({ clientPackageId: bought.id, totalCents: 0 });
      // 4074 por sessão de corte (R$ 220 divididos pelo peso de 4 cortes e 2 barbas) × 40%.
      expect(open.body.items[0].commissionCents).toBe(1630);

      const closed = await close(orderId).expect(200);
      expect(closed.body.totalCents).toBe(0);
      expect(closed.body.items[0].commissionCents).toBe(1630);
      expect(await balance(bought.id)).toBe(3);
    });

    it('pacote com comissão de sessão desligada: sessão usada não comissiona', async () => {
      const bought = await sell((await createPackage({ commissionOnSessions: false })).id);
      const closed = await close(await useSession(bought.id)).expect(200);
      expect(closed.body.items[0].commissionCents).toBe(0);
    });

    it('recusa pacote de outro cliente, serviço fora do pacote e saldo insuficiente', async () => {
      const template = await createPackage({ items: [{ serviceId: corte, quantity: 1 }] });
      const bought = await sell(template.id);

      const stranger = await newClient();
      const strangerOrder = await openOrder(
        [{ serviceId: corte, professionalId: shop.membershipId }],
        stranger,
      );
      const strangerItem = (await owner().get(`/v1/orders/${strangerOrder}`)).body.items[0].id;
      await owner()
        .put(`/v1/orders/${strangerOrder}/items/${strangerItem}/package`)
        .send({ clientPackageId: bought.id })
        .expect(404);

      const barbaOrder = await openOrder([{ serviceId: barba, professionalId: shop.membershipId }]);
      const barbaItem = (await owner().get(`/v1/orders/${barbaOrder}`)).body.items[0].id;
      const mismatch = await owner()
        .put(`/v1/orders/${barbaOrder}/items/${barbaItem}/package`)
        .send({ clientPackageId: bought.id })
        .expect(422);
      expect(mismatch.body.type).toMatch(/package-service-mismatch$/);

      const twoCuts = await openOrder([{ serviceId: corte, professionalId: shop.membershipId, quantity: 2 }]);
      const twoCutsItem = (await owner().get(`/v1/orders/${twoCuts}`)).body.items[0].id;
      const empty = await owner()
        .put(`/v1/orders/${twoCuts}/items/${twoCutsItem}/package`)
        .send({ clientPackageId: bought.id })
        .expect(422);
      expect(empty.body.type).toMatch(/package-no-sessions$/);
    });

    it('pacote vencido não pode ser usado', async () => {
      const template = await createPackage({ validityDays: 1 });
      // Vendido há 3 dias: venceu anteontem.
      const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000);
      const bought = await app.get(Clock).at(threeDaysAgo, () => sell(template.id));
      const orderId = await openOrder([{ serviceId: corte, professionalId: shop.membershipId }]);
      const itemId = (await owner().get(`/v1/orders/${orderId}`)).body.items[0].id;
      const refused = await owner()
        .put(`/v1/orders/${orderId}/items/${itemId}/package`)
        .send({ clientPackageId: bought.id })
        .expect(422);
      expect(refused.body.type).toMatch(/package-expired$/);
    });

    it('duas comandas disputando a última sessão: só uma fecha', async () => {
      const bought = await sell((await createPackage({ items: [{ serviceId: corte, quantity: 1 }] })).id);
      const first = await useSession(bought.id);
      const second = await useSession(bought.id);
      const results = await Promise.all([close(first), close(second)]);
      expect(results.map((result) => result.status).sort((a, b) => a - b)).toEqual([200, 422]);
      expect(await balance(bought.id)).toBe(0);
    });

    it('o banco é a garantia: o saldo não muda por fora das movimentações', async () => {
      const bought = await sell((await createPackage()).id);
      await expect(
        prisma.withContext({ barbershopId: shop.barbershopId }, (tx) =>
          tx.clientPackageBalance.updateMany({
            where: { clientPackageId: bought.id },
            data: { remaining: 99 },
          }),
        ),
      ).rejects.toThrow(/permission denied/i);
    });
  });

  describe('estorno e reembolso', () => {
    it('estornar a comanda de uso devolve a sessão', async () => {
      const bought = await sell((await createPackage()).id);
      const orderId = await useSession(bought.id);
      await close(orderId).expect(200);
      expect(await balance(bought.id)).toBe(3);
      await owner().post(`/v1/orders/${orderId}/void`).send({ reason: 'Lançado errado' }).expect(200);
      expect(await balance(bought.id)).toBe(4);
    });

    it('estornar a venda cancela o pacote se nada foi usado; se foi, exige reembolso', async () => {
      const unused = await sell((await createPackage()).id);
      await owner()
        .post(`/v1/orders/${unused.saleOrderId}/void`)
        .send({ reason: 'Venda errada' })
        .expect(200);
      const voided = await owner().get('/v1/client-packages').query({ status: 'VOIDED' }).expect(200);
      expect(voided.body.map((row: { id: string }) => row.id)).toContain(unused.id);

      const used = await sell((await createPackage()).id);
      await close(await useSession(used.id)).expect(200);
      const refused = await owner()
        .post(`/v1/orders/${used.saleOrderId}/void`)
        .send({ reason: 'Venda errada' })
        .expect(422);
      expect(refused.body.type).toMatch(/package-in-use$/);
    });

    it('reembolso: valor da barbearia até o pago, saída no caixa e pacote encerrado', async () => {
      const bought = await sell((await createPackage()).id);
      await close(await useSession(bought.id)).expect(200);

      const tooHigh = await owner()
        .post(`/v1/client-packages/${bought.id}/refund`)
        .send({ amountCents: 22001, paymentMethod: 'PIX', reason: 'Mudou de cidade' })
        .expect(422);
      expect(tooHigh.body.type).toMatch(/refund-too-high$/);

      const refunded = await owner()
        .post(`/v1/client-packages/${bought.id}/refund`)
        .send({ amountCents: 15000, paymentMethod: 'PIX', reason: 'Mudou de cidade' })
        .expect(200);
      expect(refunded.body).toMatchObject({
        status: 'REFUNDED',
        refundCents: 15000,
        refundReason: 'Mudou de cidade',
      });

      const cash = await prisma.withContext({ barbershopId: shop.barbershopId }, (tx) =>
        tx.cashEntry.findMany({ where: { orderId: bought.saleOrderId, kind: 'REFUND' } }),
      );
      expect(cash).toMatchObject([{ amountCents: -15000, method: 'PIX' }]);

      // Encerrado: não reembolsa de novo nem é usado.
      await owner()
        .post(`/v1/client-packages/${bought.id}/refund`)
        .send({ amountCents: 1, paymentMethod: 'PIX', reason: 'De novo' })
        .expect(422);
      const orderId = await openOrder([{ serviceId: corte, professionalId: shop.membershipId }]);
      const itemId = (await owner().get(`/v1/orders/${orderId}`)).body.items[0].id;
      const refused = await owner()
        .put(`/v1/orders/${orderId}/items/${itemId}/package`)
        .send({ clientPackageId: bought.id })
        .expect(422);
      expect(refused.body.type).toMatch(/package-not-active$/);
    });

    it('pacote vencido não pode ser reembolsado', async () => {
      const template = await createPackage({ validityDays: 1 });
      const bought = await app.get(Clock).at(new Date(Date.now() - 3 * 86_400_000), () => sell(template.id));
      const refused = await owner()
        .post(`/v1/client-packages/${bought.id}/refund`)
        .send({ amountCents: 100, paymentMethod: 'CASH', reason: 'Venceu' })
        .expect(422);
      expect(refused.body.type).toMatch(/package-expired$/);
      const expired = await owner().get('/v1/client-packages').query({ status: 'EXPIRED' }).expect(200);
      expect(expired.body.map((row: { id: string }) => row.id)).toContain(bought.id);
    });
  });

  describe('permissões, cliente final e isolamento', () => {
    it('recepção cadastra e vende; reembolso fica com o dono; profissional só consulta', async () => {
      const email = (role: string) => `${role}-${randomUUID().slice(0, 8)}@teste.com`;
      const receptionEmail = email('recepcao');
      const barberEmail = email('barbeiro');
      await owner()
        .post('/v1/staff')
        .send({
          name: 'Recepção',
          email: receptionEmail,
          password: 'senha-forte-123',
          roleKey: 'receptionist',
          isProfessional: false,
        })
        .expect(201);
      await owner()
        .post('/v1/staff')
        .send({
          name: 'Barbeiro',
          email: barberEmail,
          password: 'senha-forte-123',
          roleKey: 'professional',
          isProfessional: true,
        })
        .expect(201);
      const reception = await login(app, receptionEmail, 'senha-forte-123');
      const barber = await login(app, barberEmail, 'senha-forte-123');

      const created = await as(app, reception)
        .post('/v1/packages')
        .send({
          name: 'Pacote da recepção',
          priceCents: 10000,
          validityDays: 30,
          items: [{ serviceId: corte, quantity: 2 }],
        })
        .expect(201);
      const bought = await sell(created.body.id);
      await as(app, reception)
        .post(`/v1/client-packages/${bought.id}/refund`)
        .send({ amountCents: 100, paymentMethod: 'PIX', reason: 'Teste' })
        .expect(403);

      await as(app, barber).get('/v1/packages').expect(200);
      await as(app, barber).get('/v1/client-packages').expect(200);
      await as(app, barber)
        .post('/v1/packages')
        .send({ name: 'X', priceCents: 1, validityDays: 1, items: [] })
        .expect(403);
    });

    it('o cliente final vê os próprios pacotes com saldo, sem dados internos', async () => {
      const email = `cliente-${randomUUID().slice(0, 8)}@teste.com`;
      const register = await request(app.getHttpServer())
        .post(`/v1/public/${shop.slug}/auth/register`)
        .send({ name: 'Paula Pacote', email, password: 'senha-forte-123' })
        .expect(201);
      const found = await owner().get('/v1/clients').query({ search: 'Paula Pacote' }).expect(200);
      const paula = found.body.items[0].id as string;
      await sell((await createPackage()).id, paula);

      const mine = await as(app, register.body.accessToken as string)
        .get(`/v1/public/${shop.slug}/me/packages`)
        .expect(200);
      expect(mine.body).toHaveLength(1);
      expect(mine.body[0]).toMatchObject({ status: 'ACTIVE' });
      expect(mine.body[0].balances).toHaveLength(2);
      expect(mine.body[0]).not.toHaveProperty('pricePaidCents');
      expect(mine.body[0]).not.toHaveProperty('orderId');
    });

    it('isola pacotes e pacotes vendidos entre barbearias', async () => {
      const template = await createPackage();
      const bought = await sell(template.id);
      await expectTenantIsolation(app, other, [
        { method: 'patch', url: `/v1/packages/${template.id}`, body: { name: 'invasão' } },
        {
          method: 'post',
          url: `/v1/client-packages/${bought.id}/refund`,
          body: { amountCents: 1, paymentMethod: 'PIX', reason: 'invasão' },
        },
      ]);
      const list = await as(app, other.token).get('/v1/client-packages').expect(200);
      expect(list.body.map((row: { id: string }) => row.id)).not.toContain(bought.id);
      const catalog = await as(app, other.token).get('/v1/packages').expect(200);
      expect(catalog.body.map((row: { id: string }) => row.id)).not.toContain(template.id);
    });
  });
});
