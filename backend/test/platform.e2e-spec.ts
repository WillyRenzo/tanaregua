import request from 'supertest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { as, createTestApp, registerTenant, type TestApp } from './helpers/app.js';
import {
  createTestPlan,
  createTestPlatformAdmin,
  ownerClient,
  platformLogin,
  type TestPlatformAdmin,
} from './helpers/platform.js';

describe('Administração da plataforma (e2e)', () => {
  let app: TestApp;
  let owner: PrismaClient;
  let prisma: PrismaService;
  let admin: TestPlatformAdmin;

  beforeAll(async () => {
    app = await createTestApp();
    owner = ownerClient();
    prisma = app.get(PrismaService);
    admin = await createTestPlatformAdmin(owner);
  });

  afterAll(async () => {
    await owner.$disconnect();
    await app.close();
  });

  const server = () => app.getHttpServer();

  describe('login e sessão', () => {
    it('entra com e-mail e senha e recebe o próprio cookie, separado do painel', async () => {
      const response = await request(server())
        .post('/v1/platform/auth/login')
        .send({ email: admin.email, password: admin.password })
        .expect(200);
      expect(response.body.profile).toEqual({
        admin: { id: admin.id, name: 'Admin Teste', email: admin.email },
      });
      const cookies = ([] as string[]).concat(response.headers['set-cookie'] ?? []);
      expect(cookies).toHaveLength(1);
      expect(cookies[0]).toMatch(/^tnr_platform_refresh=/);
      expect(cookies[0]).toMatch(/HttpOnly/);
      expect(cookies[0]).toMatch(/SameSite=Strict/);
      // [PROPOSTA] 12 horas de sessão.
      expect(cookies[0]).toMatch(/Max-Age=43200/);
    });

    it('recusa senha errada e e-mail desconhecido com a mesma mensagem', async () => {
      const wrong = await request(server())
        .post('/v1/platform/auth/login')
        .send({ email: admin.email, password: 'outra-senha-qualquer' })
        .expect(401);
      const unknown = await request(server())
        .post('/v1/platform/auth/login')
        .send({ email: 'ninguem@tanaregua.test', password: admin.password })
        .expect(401);
      expect(wrong.body.detail).toBe(unknown.body.detail);
    });

    it('a conta de uma barbearia não entra na administração', async () => {
      const shop = await registerTenant(app);
      await request(server())
        .post('/v1/platform/auth/login')
        .send({ email: shop.email, password: shop.password })
        .expect(401);
    });

    it('renova pelo cookie, rotaciona o refresh e revoga a sessão se um token antigo voltar', async () => {
      const { cookie } = await platformLogin(app, admin);
      const renewed = await request(server())
        .post('/v1/platform/auth/refresh')
        .set('Cookie', cookie)
        .expect(200);
      const next = ([] as string[]).concat(renewed.headers['set-cookie'] ?? [])[0]!.split(';')[0]!;
      expect(next).not.toBe(cookie);

      // Reuso do token já rotacionado: sinal de roubo, a família inteira cai.
      await request(server()).post('/v1/platform/auth/refresh').set('Cookie', cookie).expect(401);
      await request(server()).post('/v1/platform/auth/refresh').set('Cookie', next).expect(401);
    });

    it('sair revoga a sessão', async () => {
      const { cookie } = await platformLogin(app, admin);
      await request(server()).post('/v1/platform/auth/logout').set('Cookie', cookie).expect(204);
      await request(server()).post('/v1/platform/auth/refresh').set('Cookie', cookie).expect(401);
    });

    it('o cookie do painel não renova a sessão da plataforma', async () => {
      const shop = await registerTenant(app);
      const login = await request(server())
        .post('/v1/auth/login')
        .send({ email: shop.email, password: shop.password })
        .expect(200);
      const panelCookie = ([] as string[]).concat(login.headers['set-cookie'] ?? [])[0]!.split(';')[0]!;
      await request(server()).post('/v1/platform/auth/refresh').set('Cookie', panelCookie).expect(401);
    });
  });

  describe('separação dos tokens', () => {
    it('rota da plataforma exige o token da plataforma', async () => {
      const { token } = await platformLogin(app, admin);
      const me = await as(app, token).get('/v1/platform/auth/me').expect(200);
      expect(me.body.admin.email).toBe(admin.email);

      await request(server()).get('/v1/platform/auth/me').expect(401);
      const shop = await registerTenant(app);
      await as(app, shop.token).get('/v1/platform/auth/me').expect(401);
      await as(app, shop.token).get('/v1/platform/plans').expect(401);
    });

    it('o token da plataforma não vale nas rotas das barbearias', async () => {
      const { token } = await platformLogin(app, admin);
      await as(app, token).get('/v1/auth/me').expect(401);
      await as(app, token).get('/v1/plans').expect(401);
      await as(app, token).get('/v1/clients').expect(401);
    });
  });

  describe('preços dos planos', () => {
    it('define os preços mensal e anual, e o painel das barbearias passa a vê-los', async () => {
      const key = await createTestPlan(owner);
      const { token } = await platformLogin(app, admin);

      const before = await as(app, token).get('/v1/platform/plans').expect(200);
      expect(before.body.find((plan: { key: string }) => plan.key === key)).toEqual({
        key,
        name: `Plano ${key}`,
        features: ['payroll'],
        prices: { monthlyCents: null, yearlyCents: null },
      });

      const updated = await as(app, token)
        .put(`/v1/platform/plans/${key}/prices`)
        .send({ monthlyCents: 9990, yearlyCents: 99900 })
        .expect(200);
      expect(updated.body.prices).toEqual({ monthlyCents: 9990, yearlyCents: 99900 });

      const shop = await registerTenant(app);
      const panel = await as(app, shop.token).get('/v1/plans').expect(200);
      expect(panel.body.find((plan: { key: string }) => plan.key === key).prices).toEqual({
        monthlyCents: 9990,
        yearlyCents: 99900,
      });

      const row = await owner.planPrice.findFirstOrThrow({
        where: { plan: { key }, interval: 'MONTHLY' },
        select: { updatedById: true },
      });
      expect(row.updatedById).toBe(admin.id);
    });

    it('trocar o preço atualiza; null tira o plano de venda naquele ciclo', async () => {
      const key = await createTestPlan(owner);
      const { token } = await platformLogin(app, admin);
      await as(app, token)
        .put(`/v1/platform/plans/${key}/prices`)
        .send({ monthlyCents: 5000, yearlyCents: 50000 })
        .expect(200);

      const changed = await as(app, token)
        .put(`/v1/platform/plans/${key}/prices`)
        .send({ monthlyCents: 6000, yearlyCents: null })
        .expect(200);
      expect(changed.body.prices).toEqual({ monthlyCents: 6000, yearlyCents: null });
      expect(await owner.planPrice.count({ where: { plan: { key } } })).toBe(1);
    });

    it('valida os valores (centavos inteiros, de R$ 1 a R$ 100 mil) e recusa campos extras', async () => {
      const key = await createTestPlan(owner);
      const { token } = await platformLogin(app, admin);
      const put = (body: object) => as(app, token).put(`/v1/platform/plans/${key}/prices`).send(body);

      await put({ monthlyCents: 0, yearlyCents: null }).expect(400);
      await put({ monthlyCents: 99.9, yearlyCents: null }).expect(400);
      await put({ monthlyCents: 10_000_001, yearlyCents: null }).expect(400);
      await put({ monthlyCents: 9990 }).expect(400);
      await put({ monthlyCents: 9990, yearlyCents: null, features: ['assistant'] }).expect(400);
    });

    it('plano inexistente responde 404', async () => {
      const { token } = await platformLogin(app, admin);
      await as(app, token)
        .put('/v1/platform/plans/nao-existe/prices')
        .send({ monthlyCents: 9990, yearlyCents: null })
        .expect(404);
    });

    it('o dono de uma barbearia não muda preço', async () => {
      const key = await createTestPlan(owner);
      const shop = await registerTenant(app);
      await as(app, shop.token)
        .put(`/v1/platform/plans/${key}/prices`)
        .send({ monthlyCents: 100, yearlyCents: null })
        .expect(401);
      expect(await owner.planPrice.count({ where: { plan: { key } } })).toBe(0);
    });
  });

  describe('garantias no banco', () => {
    it('sem o administrador no contexto, a aplicação não grava preço (RLS)', async () => {
      const key = await createTestPlan(owner);
      const plan = await owner.plan.findUniqueOrThrow({ where: { key }, select: { id: true } });
      const shop = await registerTenant(app);

      await expect(
        prisma.withContext({ barbershopId: shop.barbershopId, userId: shop.userId }, (tx) =>
          tx.planPrice.create({ data: { planId: plan.id, interval: 'MONTHLY', amountCents: 100 } }),
        ),
      ).rejects.toThrow(/row-level security/i);

      await prisma.withContext({ platformAdminId: admin.id }, (tx) =>
        tx.planPrice.create({ data: { planId: plan.id, interval: 'MONTHLY', amountCents: 100 } }),
      );
      const touched = await prisma.withContext({}, async (tx) => ({
        updated: (await tx.planPrice.updateMany({ where: { planId: plan.id }, data: { amountCents: 1 } }))
          .count,
        deleted: (await tx.planPrice.deleteMany({ where: { planId: plan.id } })).count,
      }));
      expect(touched).toEqual({ updated: 0, deleted: 0 });
      // A leitura é livre: o painel mostra o preço.
      expect(await prisma.planPrice.count({ where: { planId: plan.id } })).toBe(1);
    });

    it('preço precisa ser positivo também no banco', async () => {
      const key = await createTestPlan(owner);
      const plan = await owner.plan.findUniqueOrThrow({ where: { key }, select: { id: true } });
      await expect(
        owner.planPrice.create({ data: { planId: plan.id, interval: 'YEARLY', amountCents: 0 } }),
      ).rejects.toThrow(/plan_prices_amount_positive/);
    });

    it('a aplicação não cria administrador nem troca a senha de um', async () => {
      await expect(
        prisma.platformAdmin.create({ data: { email: 'intruso@x.com', name: 'Intruso', passwordHash: 'x' } }),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        prisma.platformAdmin.updateMany({ where: { id: admin.id }, data: { passwordHash: 'x' } }),
      ).rejects.toThrow(/permission denied/i);
    });

    it('sem tenant no contexto, a administração não enxerga dados de barbearias', async () => {
      await registerTenant(app);
      const visible = await prisma.withContext({ platformAdminId: admin.id }, async (tx) => ({
        clients: await tx.client.count(),
        subscriptions: await tx.subscription.count(),
        memberships: await tx.membership.count(),
      }));
      expect(visible).toEqual({ clients: 0, subscriptions: 0, memberships: 0 });
    });
  });
});
