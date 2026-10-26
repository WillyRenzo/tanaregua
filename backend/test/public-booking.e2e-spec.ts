import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { localTimeToInstant } from '../src/modules/appointments/availability.js';
import { LogMailSender, MailSender } from '../src/modules/notifications/mail-sender.js';
import { OutboxProcessor } from '../src/modules/notifications/outbox.processor.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { as, createTestApp, registerTenant, type Tenant, type TestApp } from './helpers/app.js';

const SP = 'America/Sao_Paulo';
const futureDate = (days: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: SP }).format(new Date(Date.now() + days * 24 * 3600_000));
const at = (date: string, clock: string) => {
  const [h, m] = clock.split(':').map(Number);
  return localTimeToInstant(date, h! * 60 + m!, SP).toISOString();
};

describe('Agendamento online (e2e)', () => {
  let app: TestApp;
  let shop: Tenant;
  let otherShop: Tenant;
  let corte: string;
  let day = 40;
  const nextDay = () => futureDate(day++);
  const server = () => request(app.getHttpServer());

  const registerClient = async (slug: string) => {
    const email = `cliente-${randomUUID().slice(0, 8)}@teste.com`;
    const response = await server()
      .post(`/v1/public/${slug}/auth/register`)
      .send({ name: 'Paula Cliente', email, password: 'senha-forte-123', phone: '11912345678' })
      .expect(201);
    return { email, token: response.body.accessToken as string, profile: response.body.profile };
  };

  beforeAll(async () => {
    app = await createTestApp();
    shop = await registerTenant(app);
    otherShop = await registerTenant(app);
    const everyDay = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: '09:00', end: '12:00' }));
    await as(app, shop.token)
      .put(`/v1/staff/${shop.membershipId}/schedule`)
      .send({ intervals: everyDay })
      .expect(200);
    corte = (
      await as(app, shop.token)
        .post('/v1/services')
        .send({ name: 'Corte', priceCents: 5000, durationMinutes: 30 })
        .expect(201)
    ).body.id;
    await as(app, otherShop.token)
      .put(`/v1/staff/${otherShop.membershipId}/schedule`)
      .send({ intervals: everyDay })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  it('expõe dados públicos da barbearia sem autenticação', async () => {
    const info = await server().get(`/v1/public/${shop.slug}`).expect(200);
    expect(info.body).toMatchObject({ slug: shop.slug, timezone: SP, cancellationMinNoticeMinutes: 120 });
    expect(info.body).not.toHaveProperty('id');

    const services = await server().get(`/v1/public/${shop.slug}/services`).expect(200);
    expect(services.body.map((s: { name: string }) => s.name)).toEqual(['Corte']);
    const professionals = await server().get(`/v1/public/${shop.slug}/professionals`).expect(200);
    expect(professionals.body).toEqual([{ id: shop.membershipId, name: 'Dono Teste' }]);

    await server().get('/v1/public/nao-existe/services').expect(404);
  });

  it('cliente se cadastra, vê horários, agenda e recebe confirmação por e-mail via outbox', async () => {
    const date = nextDay();
    const client = await registerClient(shop.slug);
    expect(client.profile.permissions).toEqual(['bookings:self']);

    const availability = await server()
      .get(`/v1/public/${shop.slug}/availability`)
      .query({ date, serviceIds: corte })
      .expect(200);
    expect(availability.body.professionals[0].starts).toContain(at(date, '10:00'));

    const booked = await as(app, client.token)
      .post(`/v1/public/${shop.slug}/bookings`)
      .set('Idempotency-Key', randomUUID())
      .send({ serviceIds: [corte], startsAt: at(date, '10:00') })
      .expect(201);
    expect(booked.body).toMatchObject({ source: 'ONLINE', professional: { id: shop.membershipId } });

    // O e-mail não é enviado na requisição: sai do outbox, pelo worker. Outros arquivos de
    // teste compartilham o banco, então esvaziamos a fila inteira (lotes de 20).
    const mail = app.get(MailSender) as LogMailSender;
    const processor = app.get(OutboxProcessor);
    while ((await processor.processBatch()) > 0) {
      // drena
    }
    const confirmation = mail.sent.find((message) => message.to === client.email);
    expect(confirmation?.subject).toMatch(/Agendamento confirmado/);
    expect(confirmation?.text).toContain('Corte');
    expect(confirmation?.text).toContain(`/${shop.slug}/meus-agendamentos`);

    // Reprocessar não reenvia: o evento já está PROCESSED.
    await app.get(OutboxProcessor).processBatch();
    expect(
      mail.sent.filter((message) => message.idempotencyKey === confirmation?.idempotencyKey),
    ).toHaveLength(1);

    const mine = await as(app, client.token).get(`/v1/public/${shop.slug}/me/appointments`).expect(200);
    expect(mine.body.map((a: { id: string }) => a.id)).toContain(booked.body.id);
  });

  it('online só aceita horário oferecido na grade (fora do expediente não)', async () => {
    const date = nextDay();
    const client = await registerClient(shop.slug);
    const outside = await as(app, client.token)
      .post(`/v1/public/${shop.slug}/bookings`)
      .send({ professionalId: shop.membershipId, serviceIds: [corte], startsAt: at(date, '15:00') })
      .expect(409);
    expect(outside.body.type).toMatch(/slot-unavailable$/);
    await as(app, client.token)
      .post(`/v1/public/${shop.slug}/bookings`)
      .send({ professionalId: shop.membershipId, serviceIds: [corte], startsAt: at(date, '10:07') })
      .expect(409);
  });

  it('dois clientes no mesmo horário: só um consegue', async () => {
    const date = nextDay();
    const [first, second] = await Promise.all([registerClient(shop.slug), registerClient(shop.slug)]);
    const attempts = await Promise.all(
      [first!, second!].map((client) =>
        as(app, client.token)
          .post(`/v1/public/${shop.slug}/bookings`)
          .send({ serviceIds: [corte], startsAt: at(date, '11:00') }),
      ),
    );
    expect(attempts.map((attempt) => attempt.status).sort((a, b) => a - b)).toEqual([201, 409]);
  });

  it('cancela dentro da política e bloqueia fora da janela', async () => {
    const client = await registerClient(shop.slug);
    const date = nextDay();
    const booked = await as(app, client.token)
      .post(`/v1/public/${shop.slug}/bookings`)
      .send({ serviceIds: [corte], startsAt: at(date, '09:00') })
      .expect(201);
    await as(app, client.token)
      .post(`/v1/public/${shop.slug}/me/appointments/${booked.body.id}/cancel`)
      .expect(200);

    // Janela fechada: agendamento daqui a 1h com política de 2h (criado direto no banco).
    const soon = new Date(Date.now() + 60 * 60_000);
    soon.setUTCSeconds(0, 0);
    const prisma = app.get(PrismaService);
    const clientId = (
      await prisma.withContext({ barbershopId: shop.barbershopId }, (tx) =>
        tx.client.findFirstOrThrow({ where: { email: client.email }, select: { id: true } }),
      )
    ).id;
    const late = await prisma.withContext({ barbershopId: shop.barbershopId }, (tx) =>
      tx.appointment.create({
        data: {
          barbershopId: shop.barbershopId,
          professionalId: shop.membershipId,
          clientId,
          startsAt: soon,
          endsAt: new Date(soon.getTime() + 30 * 60_000),
          blockedUntil: new Date(soon.getTime() + 30 * 60_000),
          source: 'ONLINE',
          createdByUserId: client.profile.user.id,
        },
      }),
    );
    const blocked = await as(app, client.token)
      .post(`/v1/public/${shop.slug}/me/appointments/${late.id}/cancel`)
      .expect(422);
    expect(blocked.body.type).toMatch(/cancellation-window-closed$/);
    expect(blocked.body.detail).toContain('2 horas');
  });

  it('cliente não cancela agendamento de outro cliente', async () => {
    const date = nextDay();
    const owner = await registerClient(shop.slug);
    const intruder = await registerClient(shop.slug);
    const booked = await as(app, owner.token)
      .post(`/v1/public/${shop.slug}/bookings`)
      .send({ serviceIds: [corte], startsAt: at(date, '09:30') })
      .expect(201);
    await as(app, intruder.token)
      .post(`/v1/public/${shop.slug}/me/appointments/${booked.body.id}/cancel`)
      .expect(404);
  });

  it('a mesma conta serve em outra barbearia, com cadastro de cliente separado', async () => {
    const client = await registerClient(shop.slug);
    const login = await server()
      .post(`/v1/public/${otherShop.slug}/auth/login`)
      .send({ email: client.email, password: 'senha-forte-123' })
      .expect(200);
    expect(login.body.profile.barbershop.slug).toBe(otherShop.slug);

    // Token da barbearia A não vale nas rotas da barbearia B.
    await as(app, client.token).get(`/v1/public/${otherShop.slug}/me/appointments`).expect(404);
    await as(app, login.body.accessToken).get(`/v1/public/${otherShop.slug}/me/appointments`).expect(200);
  });

  it('cliente não acessa o painel', async () => {
    const client = await registerClient(shop.slug);
    await as(app, client.token).get('/v1/agenda/day').query({ date: nextDay() }).expect(403);
    await as(app, client.token).get('/v1/clients').expect(403);
  });

  it('cadastro com e-mail existente orienta a entrar com a senha', async () => {
    const client = await registerClient(shop.slug);
    const response = await server()
      .post(`/v1/public/${shop.slug}/auth/register`)
      .send({ name: 'Outra', email: client.email, password: 'senha-forte-123' })
      .expect(409);
    expect(response.body.type).toMatch(/email-taken$/);
  });
});
