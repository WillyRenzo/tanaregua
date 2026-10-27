import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { localTimeToInstant } from '../src/modules/appointments/availability.js';
import { LogMailSender, MailSender } from '../src/modules/notifications/mail-sender.js';
import { OutboxProcessor } from '../src/modules/notifications/outbox.processor.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { as, createTestApp, registerTenant, type Tenant, type TestApp } from './helpers/app.js';
import { expectTenantIsolation } from './helpers/isolation.js';

const SP = 'America/Sao_Paulo';
const futureDate = (days: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: SP }).format(new Date(Date.now() + days * 24 * 3600_000));
const at = (date: string, clock: string) => {
  const [h, m] = clock.split(':').map(Number);
  return localTimeToInstant(date, h! * 60 + m!, SP).toISOString();
};

/** business-rules §2: reagendamento pelo cliente e faltas sem justificativa. */
describe('Reagendamento pelo cliente e faltas (e2e)', () => {
  let app: TestApp;
  let shop: Tenant;
  let other: Tenant;
  let corte: string;
  let day = 50;
  const nextDay = () => futureDate(day++);
  const server = () => request(app.getHttpServer());

  const registerClient = async () => {
    const email = `cliente-${randomUUID().slice(0, 8)}@teste.com`;
    const response = await server()
      .post(`/v1/public/${shop.slug}/auth/register`)
      .send({ name: 'Paula Cliente', email, password: 'senha-forte-123', phone: '11912345678' })
      .expect(201);
    return { email, token: response.body.accessToken as string, userId: response.body.profile.user.id };
  };

  const bookOnline = (token: string, startsAt: string) =>
    as(app, token)
      .post(`/v1/public/${shop.slug}/bookings`)
      .send({ serviceIds: [corte], startsAt })
      .expect(201)
      .then((response) => response.body as { id: string; client: { id: string } });

  const reschedule = (token: string, id: string, body: object) =>
    as(app, token).post(`/v1/public/${shop.slug}/me/appointments/${id}/reschedule`).send(body);

  const drainOutbox = async () => {
    const processor = app.get(OutboxProcessor);
    while ((await processor.processBatch()) > 0) {
      // drena
    }
  };

  beforeAll(async () => {
    app = await createTestApp();
    shop = await registerTenant(app);
    other = await registerTenant(app);
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
  });

  afterAll(async () => {
    await app.close();
  });

  describe('reagendamento', () => {
    it('prazo padrão de 24 h, configurável pela barbearia', async () => {
      const info = await server().get(`/v1/public/${shop.slug}`).expect(200);
      expect(info.body.rescheduleMinNoticeMinutes).toBe(1440);

      const updated = await as(app, shop.token)
        .patch('/v1/barbershop')
        .send({ rescheduleMinNoticeMinutes: 720 })
        .expect(200);
      expect(updated.body.rescheduleMinNoticeMinutes).toBe(720);
      await as(app, shop.token)
        .patch('/v1/barbershop')
        .send({ rescheduleMinNoticeMinutes: 1440 })
        .expect(200);
      await as(app, shop.token).patch('/v1/barbershop').send({ rescheduleMinNoticeMinutes: -1 }).expect(400);
    });

    it('cliente move o próprio horário, inclusive para um que se sobrepõe ao atual, e recebe e-mail', async () => {
      const client = await registerClient();
      const date = nextDay();
      const booked = await bookOnline(client.token, at(date, '09:00'));

      // 09:15 se sobrepõe ao próprio 09:00–09:30: o agendamento movido não conta como ocupado.
      const moved = await reschedule(client.token, booked.id, { startsAt: at(date, '09:15') }).expect(200);
      expect(moved.body).toMatchObject({ id: booked.id, startsAt: at(date, '09:15') });
      await reschedule(client.token, booked.id, { startsAt: at(date, '11:00') }).expect(200);

      const availability = await server()
        .get(`/v1/public/${shop.slug}/availability`)
        .query({ date, serviceIds: corte })
        .expect(200);
      expect(availability.body.professionals[0].starts).toContain(at(date, '09:00'));
      expect(availability.body.professionals[0].starts).not.toContain(at(date, '11:00'));

      // Um evento por reagendamento, gravado na mesma transação (outbox).
      const events = await app.get(PrismaService).outboxEvent.findMany({
        where: { type: 'AppointmentRescheduled', payload: { path: ['appointmentId'], equals: booked.id } },
      });
      expect(events).toHaveLength(2);

      // Outros arquivos de teste dividem o banco e podem despachar parte dos eventos com o
      // worker deles; aqui conferimos o conteúdo do que este processo enviou.
      await drainOutbox();
      const mail = app.get(MailSender) as LogMailSender;
      for (const message of mail.sent.filter(
        (sent) => sent.to === client.email && /remarcado/.test(sent.subject),
      )) {
        expect(message.text).toContain('Seu horário foi remarcado');
        expect(message.text).toContain('Corte');
      }
    });

    it('novo horário precisa estar na grade do agendamento online', async () => {
      const client = await registerClient();
      const date = nextDay();
      const booked = await bookOnline(client.token, at(date, '10:00'));
      const outside = await reschedule(client.token, booked.id, { startsAt: at(date, '15:00') }).expect(409);
      expect(outside.body.type).toMatch(/slot-unavailable$/);

      const someoneElse = await registerClient();
      await bookOnline(someoneElse.token, at(date, '11:30'));
      await reschedule(client.token, booked.id, { startsAt: at(date, '11:30') }).expect(409);
    });

    it('fora do prazo de reagendamento ainda dá para cancelar (prazos independentes)', async () => {
      const client = await registerClient();
      // Daqui a 5 h: dentro do prazo de cancelamento (2 h), fora do de reagendamento (24 h).
      const soon = new Date(Date.now() + 5 * 3600_000);
      soon.setUTCMinutes(0, 0, 0);
      const prisma = app.get(PrismaService);
      const appointment = await prisma.withContext({ barbershopId: shop.barbershopId }, async (tx) => {
        const clientRow = await tx.client.findFirstOrThrow({ where: { email: client.email } });
        return tx.appointment.create({
          data: {
            barbershopId: shop.barbershopId,
            professionalId: shop.membershipId,
            clientId: clientRow.id,
            startsAt: soon,
            endsAt: new Date(soon.getTime() + 30 * 60_000),
            blockedUntil: new Date(soon.getTime() + 30 * 60_000),
            source: 'ONLINE',
            createdByUserId: client.userId,
          },
        });
      });

      const blocked = await reschedule(client.token, appointment.id, {
        startsAt: at(nextDay(), '10:00'),
      }).expect(422);
      expect(blocked.body.type).toMatch(/reschedule-window-closed$/);
      expect(blocked.body.detail).toContain('24 horas');
      await as(app, client.token)
        .post(`/v1/public/${shop.slug}/me/appointments/${appointment.id}/cancel`)
        .expect(200);
    });

    it('agendamento cancelado não pode ser reagendado', async () => {
      const client = await registerClient();
      const date = nextDay();
      const booked = await bookOnline(client.token, at(date, '09:00'));
      await as(app, client.token)
        .post(`/v1/public/${shop.slug}/me/appointments/${booked.id}/cancel`)
        .expect(200);
      const response = await reschedule(client.token, booked.id, { startsAt: at(date, '10:00') }).expect(422);
      expect(response.body.type).toMatch(/not-reschedulable$/);
    });

    it('cliente não reagenda horário de outro cliente nem por outra barbearia', async () => {
      const owner = await registerClient();
      const intruder = await registerClient();
      const date = nextDay();
      const booked = await bookOnline(owner.token, at(date, '09:30'));
      await reschedule(intruder.token, booked.id, { startsAt: at(date, '10:30') }).expect(404);
      await as(app, owner.token)
        .post(`/v1/public/${other.slug}/me/appointments/${booked.id}/reschedule`)
        .send({ startsAt: at(date, '10:30') })
        .expect(404);
    });
  });

  describe('faltas sem justificativa', () => {
    it('conta só faltas sem justificativa e mostra para a equipe, nunca para o cliente', async () => {
      const client = await registerClient();
      const first = await bookOnline(client.token, at(nextDay(), '09:00'));
      const second = await bookOnline(client.token, at(nextDay(), '09:00'));
      const upcomingDate = nextDay();
      const upcoming = await bookOnline(client.token, at(upcomingDate, '10:00'));

      const noShow = (id: string, reason?: string) =>
        as(app, shop.token)
          .post(`/v1/appointments/${id}/status`)
          .send({ status: 'NO_SHOW', ...(reason ? { reason } : {}) })
          .expect(200);

      const unjustified = await noShow(first.id);
      expect(unjustified.body).toMatchObject({
        noShowJustification: null,
        client: { unjustifiedNoShows: 1 },
      });
      const justified = await noShow(second.id, 'Avisou que estava doente');
      expect(justified.body).toMatchObject({
        noShowJustification: 'Avisou que estava doente',
        client: { unjustifiedNoShows: 1 },
      });

      // Na agenda, o próximo atendimento já mostra o histórico de faltas do cliente.
      const agenda = await as(app, shop.token)
        .get('/v1/agenda/day')
        .query({ date: upcomingDate })
        .expect(200);
      const entry = agenda.body.professionals[0].appointments.find(
        (a: { id: string }) => a.id === upcoming.id,
      );
      expect(entry.client.unjustifiedNoShows).toBe(1);

      const list = await as(app, shop.token).get(`/v1/clients/${first.client.id}/no-shows`).expect(200);
      expect(list.body).toEqual([expect.objectContaining({ appointmentId: first.id, services: ['Corte'] })]);

      // Justificar depois tira da contagem; remover a justificativa devolve.
      await as(app, shop.token)
        .put(`/v1/appointments/${first.id}/no-show-justification`)
        .send({ justification: 'Ligou depois explicando' })
        .expect(200);
      expect((await as(app, shop.token).get(`/v1/clients/${first.client.id}/no-shows`)).body).toEqual([]);
      const reverted = await as(app, shop.token)
        .put(`/v1/appointments/${first.id}/no-show-justification`)
        .send({ justification: null })
        .expect(200);
      expect(reverted.body.client.unjustifiedNoShows).toBe(1);

      // O cliente não vê justificativa nem contagem de faltas.
      const mine = await as(app, client.token).get(`/v1/public/${shop.slug}/me/appointments`).expect(200);
      for (const appointment of mine.body) {
        expect(appointment).not.toHaveProperty('noShowJustification');
        expect(appointment.client).not.toHaveProperty('unjustifiedNoShows');
      }
    });

    it('só agendamento marcado como falta pode ser justificado', async () => {
      const client = await registerClient();
      const booked = await bookOnline(client.token, at(nextDay(), '11:00'));
      const response = await as(app, shop.token)
        .put(`/v1/appointments/${booked.id}/no-show-justification`)
        .send({ justification: 'Teste' })
        .expect(422);
      expect(response.body.type).toMatch(/not-a-no-show$/);
    });

    it('isola faltas e justificativas entre barbearias', async () => {
      const client = await registerClient();
      const booked = await bookOnline(client.token, at(nextDay(), '11:30'));
      await as(app, shop.token)
        .post(`/v1/appointments/${booked.id}/status`)
        .send({ status: 'NO_SHOW' })
        .expect(200);
      await expectTenantIsolation(app, other, [
        { method: 'get', url: `/v1/clients/${booked.client.id}/no-shows` },
        {
          method: 'put',
          url: `/v1/appointments/${booked.id}/no-show-justification`,
          body: { justification: 'invasão' },
        },
      ]);
    });
  });
});
