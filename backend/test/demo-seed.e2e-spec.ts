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

  it('o histórico cai nos dias dos atendimentos: caixa, comissões e relatórios têm o que mostrar', async () => {
    const owner = await loginPanel(DEMO_ACCOUNTS.owner.email);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    const shift = (days: number) => {
      const date = new Date(`${today}T12:00:00Z`);
      date.setUTCDate(date.getUTCDate() + days);
      return date.toISOString().slice(0, 10);
    };
    const period = { from: shift(-29), to: today };

    const cash = await as(app, owner.accessToken)
      .get('/v1/cash/day')
      .query({ date: shift(-1) })
      .expect(200);
    expect(cash.body.netCents).toBeGreaterThan(0);

    const report = await as(app, owner.accessToken).get('/v1/reports/summary').query(period).expect(200);
    const daysWithRevenue = report.body.revenue.byDay.filter((day: { netCents: number }) => day.netCents > 0);
    expect(daysWithRevenue.length).toBeGreaterThanOrEqual(20);
    expect(report.body.professionals).toHaveLength(3);
    expect(report.body.topServices.length).toBeGreaterThanOrEqual(5);
    expect(report.body.appointments.noShowRate).toBeGreaterThan(0);

    const commissions = await as(app, owner.accessToken).get('/v1/commissions').query(period).expect(200);
    expect(commissions.body.professionals).toHaveLength(3);

    const voided = await as(app, owner.accessToken).get('/v1/orders').query({ status: 'VOIDED' }).expect(200);
    expect(voided.body.items.length).toBeGreaterThan(1);
  });

  it('a cliente online vê passado e futuro, inclusive o que ela cancelou', async () => {
    const login = await request(app.getHttpServer())
      .post(`/v1/public/${DEMO_SLUG}/auth/login`)
      .send({ email: DEMO_ACCOUNTS.client.email, password: DEMO_PASSWORD })
      .expect(200);
    const mine = await as(app, login.body.accessToken)
      .get(`/v1/public/${DEMO_SLUG}/me/appointments`)
      .expect(200);
    const statuses = new Set(mine.body.map((appointment: { status: string }) => appointment.status));
    expect(statuses).toEqual(new Set(['COMPLETED', 'CANCELLED', 'SCHEDULED']));
    const now = Date.now();
    expect(mine.body.some((a: { startsAt: string }) => Date.parse(a.startsAt) > now)).toBe(true);
    expect(mine.body.some((a: { startsAt: string }) => Date.parse(a.startsAt) < now)).toBe(true);
  });

  it('tem produtos com vendas, alerta de reposição e saldo que bate com o histórico', async () => {
    const owner = await loginPanel(DEMO_ACCOUNTS.owner.email);
    const list = await as(app, owner.accessToken).get('/v1/products').expect(200);
    const products = list.body as { id: string; name: string; stockQuantity: number; lowStock: boolean }[];
    expect(products.map((product) => product.name)).toEqual(
      expect.arrayContaining(['Pomada modeladora', 'Óleo para barba', 'Shampoo anticaspa', 'Cera capilar']),
    );
    expect(products.find((product) => product.name === 'Shampoo anticaspa')?.lowStock).toBe(true);

    for (const product of products) {
      const movements = await as(app, owner.accessToken)
        .get(`/v1/products/${product.id}/movements`)
        .expect(200);
      const sum = movements.body.reduce((total: number, m: { quantity: number }) => total + m.quantity, 0);
      expect(sum, product.name).toBe(product.stockQuantity);
    }

    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    const from = new Date(`${today}T12:00:00Z`);
    from.setUTCDate(from.getUTCDate() - 29);
    const report = await as(app, owner.accessToken)
      .get('/v1/reports/summary')
      .query({ from: from.toISOString().slice(0, 10), to: today })
      .expect(200);
    expect(report.body.topProducts.length).toBeGreaterThanOrEqual(3);
  });

  it('cada barbearia tem a própria identidade visual; a demo tem logo servido pela API', async () => {
    const demo = await request(app.getHttpServer()).get(`/v1/public/${DEMO_SLUG}`).expect(200);
    expect(demo.body.brand).toMatchObject({ primaryColor: '#1f5f8b', secondaryColor: '#e3c567' });
    expect(demo.body.brand.logoVersion).toEqual(expect.any(String));
    const logo = await request(app.getHttpServer()).get(`/v1/public/${DEMO_SLUG}/logo`).expect(200);
    expect(logo.headers['content-type']).toBe('image/webp');

    const neighbor = await request(app.getHttpServer()).get(`/v1/public/${NEIGHBOR_SLUG}`).expect(200);
    expect(neighbor.body.brand).toEqual({ primaryColor: '#7a1f5c', secondaryColor: null, logoVersion: null });
  });

  it('a cliente online tem uma reserva reagendada por ela mesma e faltas aparecem com e sem justificativa', async () => {
    const prisma = app.get(PrismaService);
    const shop = await prisma.barbershop.findUniqueOrThrow({
      where: { slug: DEMO_SLUG },
      select: { id: true },
    });
    const rescheduled = await prisma.outboxEvent.count({
      where: { barbershopId: shop.id, type: 'AppointmentRescheduled' },
    });
    expect(rescheduled).toBeGreaterThanOrEqual(1);

    const noShows = await prisma.withContext({ barbershopId: shop.id }, (tx) =>
      tx.appointment.findMany({ where: { status: 'NO_SHOW' }, select: { noShowJustification: true } }),
    );
    expect(noShows.some((noShow) => noShow.noShowJustification === null)).toBe(true);
    expect(noShows.some((noShow) => noShow.noShowJustification !== null)).toBe(true);
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
