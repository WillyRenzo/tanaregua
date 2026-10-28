import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { as, createTestApp, registerTenant, type Tenant, type TestApp } from './helpers/app.js';
import { expectTenantIsolation, login } from './helpers/isolation.js';

/** Cadastros base (B2): equipe, clientes, serviços e comissões. */
describe('Cadastros (e2e)', () => {
  let app: TestApp;
  let shopA: Tenant;
  let shopB: Tenant;

  beforeAll(async () => {
    app = await createTestApp();
    shopA = await registerTenant(app);
    shopB = await registerTenant(app);
  });

  afterAll(async () => {
    await app.close();
  });

  const createStaff = async (tenant: Tenant, roleKey: string, isProfessional: boolean) => {
    const email = `${roleKey}-${randomUUID().slice(0, 8)}@teste.com`;
    const response = await as(app, tenant.token)
      .post('/v1/staff')
      .send({ name: `Pessoa ${roleKey}`, email, password: 'senha-forte-123', roleKey, isProfessional })
      .expect(201);
    return { id: response.body.id as string, token: await login(app, email, 'senha-forte-123') };
  };

  describe('equipe', () => {
    it('cadastra funcionários com papel e lista a equipe', async () => {
      const barber = await createStaff(shopA, 'professional', true);
      const list = await as(app, shopA.token).get('/v1/staff').expect(200);
      const member = list.body.find((item: { id: string }) => item.id === barber.id);
      expect(member).toMatchObject({ isProfessional: true, role: { key: 'professional' } });
    });

    it('nega ações fora das permissões do papel', async () => {
      const barber = await createStaff(shopA, 'professional', true);
      await as(app, barber.token)
        .post('/v1/staff')
        .send({
          name: 'X',
          email: 'x@teste.com',
          password: 'senha-forte-123',
          roleKey: 'owner',
          isProfessional: false,
        })
        .expect(403);
      await as(app, barber.token)
        .post('/v1/services')
        .send({ name: 'Corte', priceCents: 1, durationMinutes: 30 })
        .expect(403);
    });

    it('não permite promover alguém ao papel de cliente nem a papel inexistente', async () => {
      const receptionist = await createStaff(shopA, 'receptionist', false);
      await as(app, shopA.token)
        .patch(`/v1/staff/${receptionist.id}`)
        .send({ roleKey: 'client' })
        .expect(422);
      await as(app, shopA.token)
        .patch(`/v1/staff/${receptionist.id}`)
        .send({ roleKey: 'gerente' })
        .expect(422);
    });

    it('impede o dono de se desativar ou trocar o próprio papel', async () => {
      await as(app, shopA.token).patch(`/v1/staff/${shopA.membershipId}`).send({ active: false }).expect(422);
      await as(app, shopA.token)
        .patch(`/v1/staff/${shopA.membershipId}`)
        .send({ roleKey: 'receptionist' })
        .expect(422);
    });

    it('substitui o expediente semanal e rejeita intervalos sobrepostos', async () => {
      const intervals = [
        { weekday: 1, start: '09:00', end: '12:00' },
        { weekday: 1, start: '13:00', end: '18:00' },
      ];
      const saved = await as(app, shopA.token)
        .put(`/v1/staff/${shopA.membershipId}/schedule`)
        .send({ intervals })
        .expect(200);
      expect(saved.body).toEqual(intervals);

      await as(app, shopA.token)
        .put(`/v1/staff/${shopA.membershipId}/schedule`)
        .send({ intervals: [...intervals, { weekday: 1, start: '11:00', end: '14:00' }] })
        .expect(400);
    });

    it('registra e remove folgas', async () => {
      const created = await as(app, shopA.token)
        .post(`/v1/staff/${shopA.membershipId}/time-offs`)
        .send({
          startsAt: '2030-01-10T12:00:00-03:00',
          endsAt: '2030-01-10T18:00:00-03:00',
          reason: 'Médico',
        })
        .expect(201);

      const listed = await as(app, shopA.token)
        .get(`/v1/staff/${shopA.membershipId}/time-offs`)
        .query({ from: '2030-01-10T00:00:00-03:00', to: '2030-01-11T00:00:00-03:00' })
        .expect(200);
      expect(listed.body.map((item: { id: string }) => item.id)).toContain(created.body.id);

      await as(app, shopA.token)
        .delete(`/v1/staff/${shopA.membershipId}/time-offs/${created.body.id}`)
        .expect(204);
    });
  });

  describe('clientes', () => {
    it('cadastra com consentimento registrado e busca por nome e telefone', async () => {
      const created = await as(app, shopA.token)
        .post('/v1/clients')
        .send({
          name: 'Marcos Antônio',
          phone: '(11) 98888-7777',
          birthDate: '1990-05-20',
          consents: { whatsapp: true },
        })
        .expect(201);
      expect(created.body).toMatchObject({
        phone: '11988887777',
        birthDate: '1990-05-20',
        consents: { whatsapp: expect.any(String), email: null },
      });

      const byName = await as(app, shopA.token).get('/v1/clients').query({ search: 'antônio' }).expect(200);
      expect(byName.body.items.map((c: { id: string }) => c.id)).toContain(created.body.id);
      const byPhone = await as(app, shopA.token).get('/v1/clients').query({ search: '98888' }).expect(200);
      expect(byPhone.body.items.map((c: { id: string }) => c.id)).toContain(created.body.id);
    });

    it('consentimento é por canal: conceder de novo mantém a data, revogar limpa só aquele canal', async () => {
      const created = await as(app, shopA.token)
        .post('/v1/clients')
        .send({ name: 'Cliente Consentido', email: 'consentido@teste.com', consents: { email: true } })
        .expect(201);
      const emailGrantedAt = created.body.consents.email;
      expect(emailGrantedAt).toEqual(expect.any(String));

      const both = await as(app, shopA.token)
        .patch(`/v1/clients/${created.body.id}`)
        .send({ consents: { email: true, whatsapp: true } })
        .expect(200);
      expect(both.body.consents.email).toBe(emailGrantedAt);
      expect(both.body.consents.whatsapp).toEqual(expect.any(String));

      const revoked = await as(app, shopA.token)
        .patch(`/v1/clients/${created.body.id}`)
        .send({ consents: { email: false } })
        .expect(200);
      expect(revoked.body.consents).toEqual({ email: null, whatsapp: both.body.consents.whatsapp });

      const anonymized = await as(app, shopA.token)
        .post(`/v1/clients/${created.body.id}/anonymize`)
        .expect(201);
      expect(anonymized.body.consents).toEqual({ email: null, whatsapp: null });
    });

    it('pagina por cursor sem repetir nem perder registros', async () => {
      const tenant = await registerTenant(app);
      for (const name of ['Ana', 'Bruno', 'Carla', 'Diego', 'Elisa']) {
        await as(app, tenant.token).post('/v1/clients').send({ name }).expect(201);
      }
      const first = await as(app, tenant.token).get('/v1/clients').query({ limit: 2 }).expect(200);
      const second = await as(app, tenant.token)
        .get('/v1/clients')
        .query({ limit: 2, cursor: first.body.nextCursor })
        .expect(200);
      const third = await as(app, tenant.token)
        .get('/v1/clients')
        .query({ limit: 2, cursor: second.body.nextCursor })
        .expect(200);
      const names = [...first.body.items, ...second.body.items, ...third.body.items].map(
        (client: { name: string }) => client.name,
      );
      expect(names).toEqual(['Ana', 'Bruno', 'Carla', 'Diego', 'Elisa']);
      expect(third.body.nextCursor).toBeNull();
    });

    it('anonimiza a pedido do cliente (LGPD) e bloqueia edições', async () => {
      const created = await as(app, shopA.token)
        .post('/v1/clients')
        .send({ name: 'Cliente Sigiloso', email: 'sigilo@teste.com', phone: '11977776666' })
        .expect(201);
      const anonymized = await as(app, shopA.token)
        .post(`/v1/clients/${created.body.id}/anonymize`)
        .expect(201);
      expect(anonymized.body).toMatchObject({
        name: 'Cliente anonimizado',
        email: null,
        phone: null,
        anonymized: true,
      });
      await as(app, shopA.token).patch(`/v1/clients/${created.body.id}`).send({ name: 'Volta' }).expect(422);
    });

    it('profissional consulta clientes mas não cadastra', async () => {
      const barber = await createStaff(shopA, 'professional', true);
      await as(app, barber.token).get('/v1/clients').expect(200);
      await as(app, barber.token).post('/v1/clients').send({ name: 'Novo' }).expect(403);
    });
  });

  describe('serviços e comissões', () => {
    it('cadastra, desativa e lista serviços', async () => {
      const service = await as(app, shopA.token)
        .post('/v1/services')
        .send({ name: 'Barba', priceCents: 3500, durationMinutes: 30 })
        .expect(201);
      await as(app, shopA.token).patch(`/v1/services/${service.body.id}`).send({ active: false }).expect(200);

      const active = await as(app, shopA.token).get('/v1/services').expect(200);
      expect(active.body.map((s: { id: string }) => s.id)).not.toContain(service.body.id);
      const all = await as(app, shopA.token)
        .get('/v1/services')
        .query({ includeInactive: 'true' })
        .expect(200);
      expect(all.body.map((s: { id: string }) => s.id)).toContain(service.body.id);
    });

    it('rejeita duração fora da grade de 5 minutos e preço fracionado', async () => {
      await as(app, shopA.token)
        .post('/v1/services')
        .send({ name: 'X', priceCents: 1000, durationMinutes: 32 })
        .expect(400);
      await as(app, shopA.token)
        .post('/v1/services')
        .send({ name: 'X', priceCents: 10.5, durationMinutes: 30 })
        .expect(400);
    });

    it('mantém uma regra por alvo: o segundo PUT atualiza a mesma regra', async () => {
      const service = await as(app, shopA.token)
        .post('/v1/services')
        .send({ name: 'Corte', priceCents: 5000, durationMinutes: 30 })
        .expect(201);
      const first = await as(app, shopA.token)
        .put('/v1/commission-rules')
        .send({ membershipId: null, serviceId: service.body.id, type: 'PERCENT', value: 4000 })
        .expect(200);
      const second = await as(app, shopA.token)
        .put('/v1/commission-rules')
        .send({ membershipId: null, serviceId: service.body.id, type: 'FIXED', value: 1500 })
        .expect(200);
      expect(second.body.id).toBe(first.body.id);
      expect(second.body).toMatchObject({ type: 'FIXED', value: 1500 });
    });

    it('rejeita percentual acima de 100% e regra sem alvo', async () => {
      await as(app, shopA.token)
        .put('/v1/commission-rules')
        .send({ membershipId: shopA.membershipId, serviceId: null, type: 'PERCENT', value: 10001 })
        .expect(400);
      await as(app, shopA.token)
        .put('/v1/commission-rules')
        .send({ membershipId: null, serviceId: null, type: 'PERCENT', value: 1000 })
        .expect(400);
    });
  });

  describe('isolamento entre barbearias', () => {
    it('responde 404 a qualquer acesso a recursos de outra barbearia', async () => {
      const client = await as(app, shopA.token).post('/v1/clients').send({ name: 'Cliente A' }).expect(201);
      const service = await as(app, shopA.token)
        .post('/v1/services')
        .send({ name: 'Serviço A', priceCents: 1000, durationMinutes: 30 })
        .expect(201);
      const rule = await as(app, shopA.token)
        .put('/v1/commission-rules')
        .send({ membershipId: shopA.membershipId, serviceId: null, type: 'PERCENT', value: 3000 })
        .expect(200);

      await expectTenantIsolation(app, shopB, [
        { method: 'get', url: `/v1/clients/${client.body.id}` },
        { method: 'patch', url: `/v1/clients/${client.body.id}`, body: { name: 'Invasor' } },
        { method: 'post', url: `/v1/clients/${client.body.id}/anonymize` },
        { method: 'patch', url: `/v1/services/${service.body.id}`, body: { priceCents: 1 } },
        { method: 'get', url: `/v1/staff/${shopA.membershipId}/schedule` },
        { method: 'put', url: `/v1/staff/${shopA.membershipId}/schedule`, body: { intervals: [] } },
        { method: 'patch', url: `/v1/staff/${shopA.membershipId}`, body: { active: false } },
        {
          method: 'post',
          url: `/v1/staff/${shopA.membershipId}/time-offs`,
          body: { startsAt: '2030-01-01T10:00:00Z', endsAt: '2030-01-01T11:00:00Z' },
        },
        { method: 'delete', url: `/v1/commission-rules/${rule.body.id}` },
        // Regra de comissão apontando para funcionário/serviço de outra barbearia.
        {
          method: 'put',
          url: '/v1/commission-rules',
          body: { membershipId: shopA.membershipId, serviceId: null, type: 'PERCENT', value: 1000 },
        },
        {
          method: 'put',
          url: '/v1/commission-rules',
          body: { membershipId: null, serviceId: service.body.id, type: 'PERCENT', value: 1000 },
        },
      ]);

      const listing = await as(app, shopB.token).get('/v1/clients').expect(200);
      expect(listing.body.items.map((c: { id: string }) => c.id)).not.toContain(client.body.id);
      const staff = await as(app, shopB.token).get('/v1/staff').expect(200);
      expect(staff.body.map((m: { id: string }) => m.id)).not.toContain(shopA.membershipId);
    });

    it('RLS isola os dados mesmo sem filtro na consulta (camada 2)', async () => {
      await as(app, shopA.token).post('/v1/clients').send({ name: 'Só da A' }).expect(201);
      const prisma = app.get(PrismaService);

      // Consultas SEM where por barbershopId: só o RLS separa os tenants.
      const seenByB = await prisma.withContext({ barbershopId: shopB.barbershopId }, (tx) =>
        tx.client.findMany({ select: { barbershopId: true } }),
      );
      expect(seenByB.every((row) => row.barbershopId === shopB.barbershopId)).toBe(true);

      const seenWithoutContext = await prisma.withContext({}, (tx) => tx.client.findMany());
      expect(seenWithoutContext).toHaveLength(0);
    });

    it('o banco rejeita gravar dado em nome de outro tenant (WITH CHECK)', async () => {
      const prisma = app.get(PrismaService);
      await expect(
        prisma.withContext({ barbershopId: shopB.barbershopId }, (tx) =>
          tx.client.create({ data: { barbershopId: shopA.barbershopId, name: 'Infiltrado' } }),
        ),
      ).rejects.toThrow();
    });
  });

  describe('permissões do usuário da aplicação', () => {
    // Regressão: os grants vivem numa migration (sobrevivem a `migrate reset`); o app
    // enxerga as tabelas de negócio, mas não o histórico de migrations.
    it('enxerga as tabelas de sistema e não acessa _prisma_migrations', async () => {
      const prisma = app.get(PrismaService);
      await expect(prisma.outboxEvent.count()).resolves.toBeGreaterThanOrEqual(0);
      await expect(prisma.$queryRaw`SELECT count(*) FROM _prisma_migrations`).rejects.toThrow(
        /permission denied/,
      );
    });
  });
});
