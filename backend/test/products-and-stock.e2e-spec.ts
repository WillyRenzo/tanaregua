import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { as, createTestApp, registerTenant, type Tenant, type TestApp } from './helpers/app.js';
import { expectTenantIsolation, login } from './helpers/isolation.js';

/** business-rules §4 e §7: produtos, estoque nunca negativo e comissão de produto. */
describe('Produtos e estoque (e2e)', () => {
  let app: TestApp;
  let shop: Tenant;
  let other: Tenant;
  let corte: string;
  let prisma: PrismaService;

  const createProduct = async (body: object = {}) =>
    (
      await as(app, shop.token)
        .post('/v1/products')
        .send({ name: `Pomada ${randomUUID().slice(0, 6)}`, priceCents: 4500, costCents: 2000, ...body })
        .expect(201)
    ).body as { id: string; name: string };

  const stockUp = (productId: string, quantity: number, unitCostCents = 2000) =>
    as(app, shop.token)
      .post(`/v1/products/${productId}/stock-entries`)
      .send({ quantity, unitCostCents })
      .expect(201);

  const product = async (productId: string, token = shop.token) =>
    (await as(app, token).get(`/v1/products/${productId}`).expect(200)).body;

  const staffMember = async (roleKey: string, isProfessional: boolean) => {
    const email = `${roleKey}-${randomUUID().slice(0, 8)}@teste.com`;
    const created = await as(app, shop.token)
      .post('/v1/staff')
      .send({ name: `Pessoa ${roleKey}`, email, password: 'senha-forte-123', roleKey, isProfessional })
      .expect(201);
    return { id: created.body.id as string, token: await login(app, email, 'senha-forte-123') };
  };

  /** Comanda avulsa com os itens dados; devolve o id. */
  const openOrder = async (items: object[]) =>
    (await as(app, shop.token).post('/v1/orders').send({ items }).expect(201)).body.id as string;

  const close = (orderId: string) =>
    as(app, shop.token).post(`/v1/orders/${orderId}/close`).send({ paymentMethod: 'PIX' });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    shop = await registerTenant(app);
    other = await registerTenant(app);
    corte = (
      await as(app, shop.token)
        .post('/v1/services')
        .send({ name: 'Corte', priceCents: 5000, durationMinutes: 30 })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('cadastro e movimentações', () => {
    it('produto nasce com saldo zero; entrada soma e vira o custo de referência', async () => {
      const created = await createProduct({ costCents: 1500 });
      expect(await product(created.id)).toMatchObject({ stockQuantity: 0, stockValueCents: 0 });

      const after = (await stockUp(created.id, 10, 2000)).body;
      expect(after).toMatchObject({ stockQuantity: 10, costCents: 2000, stockValueCents: 20000 });
    });

    it('ajuste exige motivo e nunca deixa o saldo negativo', async () => {
      const { id } = await createProduct();
      await stockUp(id, 5);
      await as(app, shop.token)
        .post(`/v1/products/${id}/stock-adjustments`)
        .send({ quantity: -1 })
        .expect(400);

      const adjusted = await as(app, shop.token)
        .post(`/v1/products/${id}/stock-adjustments`)
        .send({ quantity: -2, reason: 'Embalagem danificada' })
        .expect(201);
      expect(adjusted.body.stockQuantity).toBe(3);

      const refused = await as(app, shop.token)
        .post(`/v1/products/${id}/stock-adjustments`)
        .send({ quantity: -4, reason: 'Inventário' })
        .expect(422);
      expect(refused.body.type).toMatch(/insufficient-stock$/);
      expect(refused.body.detail).toContain('restam 3 unidades');

      const movements = await as(app, shop.token).get(`/v1/products/${id}/movements`).expect(200);
      expect(movements.body.map((m: { kind: string; quantity: number }) => [m.kind, m.quantity])).toEqual([
        ['ADJUSTMENT', -2],
        ['ENTRY', 5],
      ]);
      expect(movements.body[0].author.name).toBe('Dono Teste');
    });

    it('alerta de reposição quando o saldo chega ao mínimo', async () => {
      const { id } = await createProduct({ minStockQuantity: 4 });
      await stockUp(id, 5);
      expect((await product(id)).lowStock).toBe(false);
      await as(app, shop.token)
        .post(`/v1/products/${id}/stock-adjustments`)
        .send({ quantity: -1, reason: 'Uso interno' })
        .expect(201);
      expect((await product(id)).lowStock).toBe(true);
    });

    it('o banco é a garantia: saldo só muda por movimentação e movimentação não se apaga', async () => {
      const { id } = await createProduct();
      await stockUp(id, 2);
      const ctx = { barbershopId: shop.barbershopId };

      await expect(
        prisma.withContext(ctx, (tx) => tx.product.update({ where: { id }, data: { stockQuantity: 99 } })),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        prisma.withContext(ctx, (tx) => tx.stockMovement.deleteMany({ where: { productId: id } })),
      ).rejects.toThrow(/permission denied/i);
      // Movimentação que deixaria o saldo negativo é abortada pelo CHECK do produto.
      await expect(
        prisma.withContext(ctx, (tx) =>
          tx.stockMovement.create({
            data: {
              barbershopId: shop.barbershopId,
              productId: id,
              kind: 'ADJUSTMENT',
              quantity: -3,
              unitCostCents: 0,
              reason: 'teste',
              authorUserId: shop.userId,
            },
          }),
        ),
      ).rejects.toThrow();
      expect((await product(id)).stockQuantity).toBe(2);
    });
  });

  describe('venda na comanda', () => {
    it('fechar dá baixa; estornar devolve; o saldo bate com o histórico', async () => {
      const { id } = await createProduct();
      await stockUp(id, 5);
      const orderId = await openOrder([{ productId: id, quantity: 2 }]);
      const closed = await close(orderId).expect(200);
      expect(closed.body.items[0]).toMatchObject({ kind: 'PRODUCT', productId: id, professional: null });
      expect((await product(id)).stockQuantity).toBe(3);

      await as(app, shop.token)
        .post(`/v1/orders/${orderId}/void`)
        .send({ reason: 'Cliente devolveu' })
        .expect(200);
      expect((await product(id)).stockQuantity).toBe(5);

      const movements = await as(app, shop.token).get(`/v1/products/${id}/movements`).expect(200);
      const kinds = movements.body.map((m: { kind: string; quantity: number }) => [m.kind, m.quantity]);
      expect(kinds).toEqual([
        ['SALE_REVERSAL', 2],
        ['SALE', -2],
        ['ENTRY', 5],
      ]);
      const sum = movements.body.reduce((total: number, m: { quantity: number }) => total + m.quantity, 0);
      expect(sum).toBe(5);
    });

    it('sem estoque suficiente, a comanda não fecha e nada é lançado', async () => {
      const { id, name } = await createProduct();
      await stockUp(id, 1);
      const orderId = await openOrder([
        { serviceId: corte, professionalId: shop.membershipId },
        { productId: id, quantity: 2 },
      ]);
      const refused = await close(orderId).expect(422);
      expect(refused.body.type).toMatch(/insufficient-stock$/);
      expect(refused.body.detail).toContain(name);

      const order = await as(app, shop.token).get(`/v1/orders/${orderId}`).expect(200);
      expect(order.body.status).toBe('OPEN');
      expect((await product(id)).stockQuantity).toBe(1);
      const cash = await prisma.withContext({ barbershopId: shop.barbershopId }, (tx) =>
        tx.cashEntry.count({ where: { orderId } }),
      );
      expect(cash).toBe(0);
    });

    it('duas comandas disputando a última unidade: só uma fecha', async () => {
      const { id } = await createProduct();
      await stockUp(id, 1);
      const first = await openOrder([{ productId: id }]);
      const second = await openOrder([{ productId: id }]);
      const results = await Promise.all([close(first), close(second)]);
      expect(results.map((result) => result.status).sort((a, b) => a - b)).toEqual([200, 422]);
      expect((await product(id)).stockQuantity).toBe(0);
    });
  });

  describe('comissão de produto', () => {
    it('só com regra de produto; o padrão do profissional não vale; balcão não comissiona', async () => {
      const barber = await staffMember('professional', true);
      const { id } = await createProduct({ priceCents: 4000 });
      await stockUp(id, 10);
      const rule = (body: object) =>
        as(app, shop.token)
          .put('/v1/commission-rules')
          .send({ type: 'PERCENT', value: 3500, ...body })
          .expect(200);

      // Padrão do profissional (35%): vale para serviço, não para produto.
      await rule({ membershipId: barber.id, serviceId: null });
      const withDefault = await openOrder([{ productId: id, professionalId: barber.id }]);
      expect((await close(withDefault).expect(200)).body.items[0].commissionCents).toBe(0);

      // Regra do produto: R$ 5 fixos para quem vender.
      await as(app, shop.token)
        .put('/v1/commission-rules')
        .send({ membershipId: null, serviceId: null, productId: id, type: 'FIXED', value: 500 })
        .expect(200);
      const sold = await openOrder([{ productId: id, professionalId: barber.id, quantity: 2 }]);
      const closed = await close(sold).expect(200);
      expect(closed.body.items[0].commissionCents).toBe(500);
      const entries = await prisma.withContext({ barbershopId: shop.barbershopId }, (tx) =>
        tx.commissionEntry.findMany({ where: { orderId: sold } }),
      );
      expect(entries).toMatchObject([{ professionalId: barber.id, amountCents: 500 }]);

      // Venda de balcão (sem profissional): nunca gera comissão.
      const counter = await openOrder([{ productId: id }]);
      expect((await close(counter).expect(200)).body.items[0].commissionCents).toBe(0);
      const counterEntries = await prisma.withContext({ barbershopId: shop.barbershopId }, (tx) =>
        tx.commissionEntry.count({ where: { orderId: counter } }),
      );
      expect(counterEntries).toBe(0);
    });

    it('regra não pode valer para serviço e produto ao mesmo tempo', async () => {
      const { id } = await createProduct();
      await as(app, shop.token)
        .put('/v1/commission-rules')
        .send({ membershipId: null, serviceId: corte, productId: id, type: 'PERCENT', value: 1000 })
        .expect(400);
    });

    it('relatório separa serviços e produtos mais vendidos', async () => {
      const { id, name } = await createProduct();
      await stockUp(id, 3);
      await close(
        await openOrder([{ serviceId: corte, professionalId: shop.membershipId }, { productId: id }]),
      ).expect(200);
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
      const report = await as(app, shop.token)
        .get('/v1/reports/summary')
        .query({ from: today, to: today })
        .expect(200);
      expect(report.body.topProducts.map((row: { name: string }) => row.name)).toContain(name);
      expect(report.body.topServices.map((row: { name: string }) => row.name)).not.toContain(name);
    });
  });

  describe('permissões e isolamento', () => {
    it('recepção gerencia produtos e estoque; profissional só consulta, sem ver custo', async () => {
      const reception = await staffMember('receptionist', false);
      const barber = await staffMember('professional', true);
      const created = await as(app, reception.token)
        .post('/v1/products')
        .send({ name: 'Óleo para barba', priceCents: 3500, costCents: 1800 })
        .expect(201);
      await as(app, reception.token)
        .post(`/v1/products/${created.body.id}/stock-entries`)
        .send({ quantity: 4, unitCostCents: 1800 })
        .expect(201);
      // Comissão continua com o dono.
      await as(app, reception.token)
        .put('/v1/commission-rules')
        .send({ membershipId: null, serviceId: null, productId: created.body.id, type: 'FIXED', value: 100 })
        .expect(403);

      const seen = await product(created.body.id, barber.token);
      expect(seen).toMatchObject({ stockQuantity: 4, costCents: null, stockValueCents: null });
      await as(app, barber.token).post('/v1/products').send({ name: 'X', priceCents: 1 }).expect(403);
      await as(app, barber.token)
        .post(`/v1/products/${created.body.id}/stock-adjustments`)
        .send({ quantity: -1, reason: 'teste' })
        .expect(403);
    });

    it('isola produtos e movimentações entre barbearias', async () => {
      const { id } = await createProduct();
      await expectTenantIsolation(app, other, [
        { method: 'get', url: `/v1/products/${id}` },
        { method: 'patch', url: `/v1/products/${id}`, body: { name: 'invasão' } },
        { method: 'get', url: `/v1/products/${id}/movements` },
        { method: 'post', url: `/v1/products/${id}/stock-entries`, body: { quantity: 1, unitCostCents: 1 } },
        {
          method: 'post',
          url: `/v1/products/${id}/stock-adjustments`,
          body: { quantity: 1, reason: 'invasão' },
        },
      ]);
      const list = await as(app, other.token).get('/v1/products').expect(200);
      expect(list.body.map((p: { id: string }) => p.id)).not.toContain(id);
      // Produto de outra barbearia não entra na comanda.
      const refused = await as(app, other.token)
        .post('/v1/orders')
        .send({ items: [{ productId: id }] })
        .expect(422);
      expect(refused.body.type).toMatch(/invalid-product$/);
    });
  });
});
