import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, DEMO_SLUG, NEIGHBOR_SLUG, seedDemo } from '../src/seed/demo-seed.js';
import { as, createTestApp, type TestApp } from './helpers/app.js';

/** O README promete estas credenciais: o seed precisa entregá-las de verdade. */
describe('Seed de demonstração (e2e)', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
    const result = await seedDemo(app);
    expect(result.created).toBe(true);
  });

  afterAll(async () => {
    await app.close();
  });

  const loginPanel = async (email: string) => {
    const response = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email, password: DEMO_PASSWORD })
      .expect(200);
    return response.body as {
      accessToken: string;
      profile: { membership: { role: { key: string } }; permissions: string[] };
    };
  };

  it.each([
    [DEMO_ACCOUNTS.owner.email, 'owner', 'reports:read'],
    [DEMO_ACCOUNTS.receptionist.email, 'receptionist', 'orders:manage'],
    [DEMO_ACCOUNTS.professional.email, 'professional', 'appointments:read:own'],
    [DEMO_ACCOUNTS.professional2.email, 'professional', 'commissions:read:own'],
    [DEMO_ACCOUNTS.neighborOwner.email, 'owner', 'reports:read'],
  ])('%s entra no painel como %s', async (email, roleKey, permission) => {
    const session = await loginPanel(email);
    expect(session.profile.membership.role.key).toBe(roleKey);
    expect(session.profile.permissions).toContain(permission);
  });

  it('o cliente entra pela página pública e já tem agendamento', async () => {
    const response = await request(app.getHttpServer())
      .post(`/v1/public/${DEMO_SLUG}/auth/login`)
      .send({ email: DEMO_ACCOUNTS.client.email, password: DEMO_PASSWORD })
      .expect(200);
    expect(response.body.profile.permissions).toEqual(['bookings:self']);
    const mine = await as(app, response.body.accessToken)
      .get(`/v1/public/${DEMO_SLUG}/me/appointments`)
      .expect(200);
    expect(mine.body.length).toBeGreaterThanOrEqual(1);
  });

  it('a agenda de hoje tem todos os status e as comandas cobrem aberta, fechada e estornada', async () => {
    const owner = await loginPanel(DEMO_ACCOUNTS.owner.email);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    const agenda = await as(app, owner.accessToken).get('/v1/agenda/day').query({ date: today }).expect(200);
    const statuses = new Set(
      agenda.body.professionals.flatMap((p: { appointments: { status: string }[] }) =>
        p.appointments.map((a) => a.status),
      ),
    );
    expect([...statuses].map(String).sort((a, b) => a.localeCompare(b))).toEqual([
      'COMPLETED',
      'CONFIRMED',
      'IN_SERVICE',
      'NO_SHOW',
      'SCHEDULED',
    ]);
    expect(agenda.body.professionals).toHaveLength(3);

    for (const status of ['OPEN', 'CLOSED', 'VOIDED']) {
      const page = await as(app, owner.accessToken).get('/v1/orders').query({ status }).expect(200);
      expect(page.body.items.length, status).toBeGreaterThan(0);
    }
  });

  it('a barbearia vizinha é isolada da demo', async () => {
    const neighbor = await loginPanel(DEMO_ACCOUNTS.neighborOwner.email);
    const clients = await as(app, neighbor.accessToken).get('/v1/clients').expect(200);
    expect(clients.body.items.map((c: { name: string }) => c.name)).toEqual(['Cliente Secreto da Vizinha']);
    await request(app.getHttpServer()).get(`/v1/public/${NEIGHBOR_SLUG}`).expect(200);
  });

  it('rodar de novo não duplica nada', async () => {
    const prisma = app.get(PrismaService);
    const before = await prisma.user.count();
    expect((await seedDemo(app)).created).toBe(false);
    expect(await prisma.user.count()).toBe(before);
  });
});
