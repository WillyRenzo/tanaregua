import { randomUUID } from 'node:crypto';
import { Controller, Get } from '@nestjs/common';
import request from 'supertest';
import { buildOpenApiDocument } from '../src/app.setup.js';
import { RequirePermissions } from '../src/common/auth/decorators.js';
import { RequiresFeature } from '../src/common/auth/requires-feature.js';
import { SubscriptionsService } from '../src/modules/subscriptions/subscriptions.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { as, createTestApp, registerTenant, type TestApp } from './helpers/app.js';
import { login } from './helpers/isolation.js';

type OpenApiOperation = { description?: string; responses: Record<string, { description?: string }> };

/** Nenhuma rota real exige recurso ainda (os módulos da fase 3 entram depois): esta sonda exige. */
@Controller('feature-probe')
class FeatureProbeController {
  @RequirePermissions('reports:read')
  @RequiresFeature('assistant')
  @Get()
  get() {
    return { ok: true };
  }
}

/** Assinatura e planos (business-rules §12): o código checa recursos, nunca o nome do plano. */
describe('Assinatura e planos (e2e)', () => {
  let app: TestApp;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp({ controllers: [FeatureProbeController] });
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  const essential = { plan: { key: 'essential', name: 'Essencial' }, status: 'ACTIVE', features: [] };

  it('barbearia nova nasce no plano padrão, que aparece no cadastro, no login e no perfil', async () => {
    const shop = await registerTenant(app);
    const me = await as(app, shop.token).get('/v1/auth/me').expect(200);
    expect(me.body.subscription).toEqual(essential);

    const session = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: shop.email, password: shop.password })
      .expect(200);
    expect(session.body.profile.subscription).toEqual(essential);
  });

  it('lista os planos do mais básico ao mais completo, com os recursos de cada um', async () => {
    const shop = await registerTenant(app);
    const plans = await as(app, shop.token).get('/v1/plans').expect(200);
    // Outras suítes criam planos de teste e definem preços (platform.e2e-spec): aqui só os reais.
    const real = (plans.body as { key: string; name: string; features: string[] }[])
      .filter((plan) => !plan.key.startsWith('test-'))
      .map(({ key, name, features }) => ({ key, name, features }));
    expect(real).toEqual([
      { key: 'essential', name: 'Essencial', features: [] },
      {
        key: 'professional',
        name: 'Profissional',
        features: ['online-payment', 'payroll', 'advanced-reports'],
      },
      {
        key: 'premium',
        name: 'Premium',
        features: ['online-payment', 'payroll', 'advanced-reports', 'assistant'],
      },
    ]);
    await request(app.getHttpServer()).get('/v1/plans').expect(401);
  });

  it('trocar de plano muda os recursos da sessão sem precisar de token novo no perfil', async () => {
    const shop = await registerTenant(app);
    await app.get(SubscriptionsService).changePlan(shop.barbershopId, 'premium');

    const me = await as(app, shop.token).get('/v1/auth/me').expect(200);
    expect(me.body.subscription).toEqual({
      plan: { key: 'premium', name: 'Premium' },
      status: 'ACTIVE',
      features: ['online-payment', 'payroll', 'advanced-reports', 'assistant'],
    });
    // A troca não mexe em nada da barbearia: o dono continua entrando normalmente.
    await login(app, shop.email, shop.password);
  });

  describe('@RequiresFeature', () => {
    it('recurso fora do plano responde 403 plan-upgrade-required', async () => {
      const shop = await registerTenant(app);
      const response = await as(app, shop.token).get('/v1/feature-probe').expect(403);
      expect(response.body).toMatchObject({
        type: 'https://tanaregua.app/problems/plan-upgrade-required',
        status: 403,
      });
    });

    it('a troca de plano vale na hora, com o mesmo token (o plano não vai no JWT)', async () => {
      const shop = await registerTenant(app);
      await as(app, shop.token).get('/v1/feature-probe').expect(403);
      await app.get(SubscriptionsService).changePlan(shop.barbershopId, 'premium');
      await as(app, shop.token).get('/v1/feature-probe').expect(200, { ok: true });
      await app.get(SubscriptionsService).changePlan(shop.barbershopId, 'essential');
      await as(app, shop.token).get('/v1/feature-probe').expect(403);
    });

    it('acesso efetivo = permissão do papel E recurso do plano', async () => {
      const shop = await registerTenant(app);
      await app.get(SubscriptionsService).changePlan(shop.barbershopId, 'premium');
      const email = `prof-${randomUUID().slice(0, 8)}@teste.com`;
      await as(app, shop.token)
        .post('/v1/staff')
        .send({
          name: 'Profissional',
          email,
          password: 'senha-forte-123',
          roleKey: 'professional',
          isProfessional: true,
        })
        .expect(201);
      const professional = await login(app, email, 'senha-forte-123');
      const response = await as(app, professional).get('/v1/feature-probe').expect(403);
      expect(response.body.type).toBe('about:blank');
    });

    it('assinatura cancelada não libera o recurso, mesmo no plano mais completo', async () => {
      const shop = await registerTenant(app);
      await app.get(SubscriptionsService).changePlan(shop.barbershopId, 'premium');
      await prisma.withContext({ barbershopId: shop.barbershopId }, (tx) =>
        tx.subscription.update({ where: { barbershopId: shop.barbershopId }, data: { status: 'CANCELED' } }),
      );
      await as(app, shop.token).get('/v1/feature-probe').expect(403);
    });

    it('o contrato OpenAPI mostra o recurso exigido e o 403 de upgrade', () => {
      const document = buildOpenApiDocument(app);
      const operation = (document.paths['/v1/feature-probe'] as Record<string, OpenApiOperation>)['get']!;
      expect(operation.description).toContain('**Recurso do plano:** `assistant`');
      expect(operation.responses['403']?.description).toContain('plan-upgrade-required');
    });

    it('sem login continua 401, antes de olhar o plano', async () => {
      await request(app.getHttpServer()).get('/v1/feature-probe').expect(401);
    });
  });

  it('plano inexistente não é aceito', async () => {
    const shop = await registerTenant(app);
    await expect(app.get(SubscriptionsService).changePlan(shop.barbershopId, 'nao-existe')).rejects.toThrow();
  });

  it('a assinatura é isolada por barbearia (RLS)', async () => {
    const a = await registerTenant(app);
    const b = await registerTenant(app);
    const seen = await prisma.withContext({ barbershopId: a.barbershopId }, (tx) =>
      tx.subscription.findMany({ select: { barbershopId: true } }),
    );
    expect(seen).toEqual([{ barbershopId: a.barbershopId }]);

    const updated = await prisma.withContext({ barbershopId: a.barbershopId }, (tx) =>
      tx.subscription.updateMany({ where: { barbershopId: b.barbershopId }, data: { status: 'CANCELED' } }),
    );
    expect(updated.count).toBe(0);

    const withoutTenant = await prisma.withContext({}, (tx) => tx.subscription.count());
    expect(withoutTenant).toBe(0);
  });

  it('o banco é a garantia: a aplicação não altera planos nem apaga assinatura', async () => {
    const shop = await registerTenant(app);
    await expect(
      prisma.plan.updateMany({ where: { key: 'essential' }, data: { features: ['assistant'] } }),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      prisma.plan.create({ data: { key: 'gratis', name: 'Grátis', features: ['assistant'], position: 99 } }),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      prisma.withContext({ barbershopId: shop.barbershopId }, (tx) =>
        tx.subscription.deleteMany({ where: { barbershopId: shop.barbershopId } }),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});
