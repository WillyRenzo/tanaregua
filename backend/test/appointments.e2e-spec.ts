import { randomUUID } from 'node:crypto';
import { mapDatabaseError, postgresErrorCode } from '../src/common/http/database-errors.js';
import { localTimeToInstant } from '../src/modules/appointments/availability.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { as, createTestApp, registerTenant, type Tenant, type TestApp } from './helpers/app.js';
import { expectTenantIsolation, login } from './helpers/isolation.js';

const SP = 'America/Sao_Paulo';

/** Data local daqui a N dias (sempre no futuro, para a disponibilidade não cortar por "agora"). */
function futureDate(days: number): string {
  const date = new Date(Date.now() + days * 24 * 3600_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: SP }).format(date);
}

const at = (date: string, clock: string) => {
  const [h, m] = clock.split(':').map(Number);
  return localTimeToInstant(date, h! * 60 + m!, SP).toISOString();
};

describe('Agenda (e2e)', () => {
  let app: TestApp;
  let shop: Tenant;
  let other: Tenant;
  let barberB: { id: string; token: string };
  let clientId: string;
  let corte: string; // 30 min, R$ 50
  let barba: string; // 20 min, R$ 30
  let day = 10;
  /** Cada teste usa um dia diferente para não interferir nos outros. */
  const nextDay = () => futureDate(day++);

  const book = (token: string, body: Record<string, unknown>, key?: string) => {
    const call = as(app, token).post('/v1/appointments');
    if (key) call.set('Idempotency-Key', key);
    return call.send(body);
  };

  beforeAll(async () => {
    app = await createTestApp();
    shop = await registerTenant(app);
    other = await registerTenant(app);
    const owner = as(app, shop.token);

    const everyDay = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: '09:00', end: '18:00' }));
    await owner.put(`/v1/staff/${shop.membershipId}/schedule`).send({ intervals: everyDay }).expect(200);

    const email = `barbeiro-${randomUUID().slice(0, 8)}@teste.com`;
    const created = await owner
      .post('/v1/staff')
      .send({
        name: 'Bia Barbeira',
        email,
        password: 'senha-forte-123',
        roleKey: 'professional',
        isProfessional: true,
      })
      .expect(201);
    barberB = { id: created.body.id, token: await login(app, email, 'senha-forte-123') };
    await owner.put(`/v1/staff/${barberB.id}/schedule`).send({ intervals: everyDay }).expect(200);

    clientId = (await owner.post('/v1/clients').send({ name: 'Carlos Cliente' }).expect(201)).body.id;
    corte = (
      await owner
        .post('/v1/services')
        .send({ name: 'Corte', priceCents: 5000, durationMinutes: 30 })
        .expect(201)
    ).body.id;
    barba = (
      await owner
        .post('/v1/services')
        .send({ name: 'Barba', priceCents: 3000, durationMinutes: 20 })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('cria agendamento com vários serviços: duração somada e snapshot de preço', async () => {
    const date = nextDay();
    const response = await book(shop.token, {
      professionalId: shop.membershipId,
      clientId,
      serviceIds: [corte, barba],
      startsAt: at(date, '10:00'),
    }).expect(201);

    expect(response.body).toMatchObject({
      status: 'SCHEDULED',
      source: 'PANEL',
      totalCents: 8000,
      startsAt: at(date, '10:00'),
      endsAt: at(date, '10:50'),
      items: [
        { name: 'Corte', priceCents: 5000, durationMinutes: 30 },
        { name: 'Barba', priceCents: 3000, durationMinutes: 20 },
      ],
    });
  });

  it('bloqueia sobreposição com mensagem amigável e aceita horários encostados', async () => {
    const date = nextDay();
    const base = { professionalId: shop.membershipId, clientId, serviceIds: [corte] };
    await book(shop.token, { ...base, startsAt: at(date, '10:00') }).expect(201);

    const clash = await book(shop.token, { ...base, startsAt: at(date, '10:15') }).expect(409);
    expect(clash.body.type).toMatch(/appointment-conflict$/);
    expect(clash.body.detail).toContain('10:00');

    // [10:00, 10:30) e [10:30, 11:00): encostados são válidos.
    await book(shop.token, { ...base, startsAt: at(date, '10:30') }).expect(201);
    await book(shop.token, { ...base, startsAt: at(date, '09:30') }).expect(201);
    // Outro profissional no mesmo horário: sem conflito.
    await book(shop.token, { ...base, professionalId: barberB.id, startsAt: at(date, '10:00') }).expect(201);
  });

  it('sob concorrência, exatamente um agendamento vence (garantia do banco)', async () => {
    const date = nextDay();
    const attempts = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        book(shop.token, {
          professionalId: shop.membershipId,
          clientId,
          serviceIds: [corte],
          // Horários diferentes mas todos sobrepostos entre si.
          startsAt: at(date, `14:${String(index * 5).padStart(2, '0')}`),
        }),
      ),
    );
    const statuses = attempts.map((attempt) => attempt.status).sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409, 409, 409, 409, 409]);
    for (const attempt of attempts.filter((a) => a.status === 409)) {
      expect(attempt.body.type).toMatch(/appointment-conflict$/);
    }
  });

  it('a exclusion constraint barra sobreposição mesmo passando por cima da aplicação', async () => {
    const date = nextDay();
    const first = await book(shop.token, {
      professionalId: shop.membershipId,
      clientId,
      serviceIds: [corte],
      startsAt: at(date, '11:00'),
    }).expect(201);

    const prisma = app.get(PrismaService);
    const error = await prisma
      .withContext({ barbershopId: shop.barbershopId }, (tx) =>
        tx.appointment.create({
          data: {
            barbershopId: shop.barbershopId,
            professionalId: shop.membershipId,
            clientId,
            startsAt: new Date(at(date, '11:10')),
            endsAt: new Date(at(date, '11:40')),
            blockedUntil: new Date(at(date, '11:40')),
            source: 'PANEL',
            createdByUserId: shop.userId,
          },
        }),
      )
      .catch((caught: unknown) => caught);

    expect(postgresErrorCode(error)).toBe('23P01');
    expect(mapDatabaseError(error)?.code).toBe('appointment-conflict');
    expect(first.body.id).toBeDefined();
  });

  it('cancelar libera o horário', async () => {
    const date = nextDay();
    const body = {
      professionalId: shop.membershipId,
      clientId,
      serviceIds: [corte],
      startsAt: at(date, '15:00'),
    };
    const first = await book(shop.token, body).expect(201);
    await as(app, shop.token)
      .post(`/v1/appointments/${first.body.id}/status`)
      .send({ status: 'CANCELLED', reason: 'Cliente desistiu' })
      .expect(200);
    await book(shop.token, body).expect(201);
  });

  it('respeita o intervalo (buffer) configurado pela barbearia', async () => {
    const date = nextDay();
    const owner = as(app, shop.token);
    await owner.patch('/v1/barbershop').send({ bufferMinutes: 15 }).expect(200);
    try {
      const base = { professionalId: shop.membershipId, clientId, serviceIds: [corte] };
      await book(shop.token, { ...base, startsAt: at(date, '09:00') }).expect(201);
      // Termina 09:30 + 15 min de buffer: 09:30 e 09:40 colidem; 09:45 encosta.
      await book(shop.token, { ...base, startsAt: at(date, '09:30') }).expect(409);
      await book(shop.token, { ...base, startsAt: at(date, '09:45') }).expect(201);
    } finally {
      await owner.patch('/v1/barbershop').send({ bufferMinutes: 0 }).expect(200);
    }
  });

  it('não agenda durante folga do profissional', async () => {
    const date = nextDay();
    await as(app, shop.token)
      .post(`/v1/staff/${barberB.id}/time-offs`)
      .send({ startsAt: at(date, '12:00'), endsAt: at(date, '14:00'), reason: 'Almoço longo' })
      .expect(201);
    const response = await book(shop.token, {
      professionalId: barberB.id,
      clientId,
      serviceIds: [corte],
      startsAt: at(date, '13:00'),
    }).expect(422);
    expect(response.body.type).toMatch(/professional-unavailable$/);
  });

  it('disponibilidade exclui horários ocupados, folgas e o que não cabe no expediente', async () => {
    const date = nextDay();
    await book(shop.token, {
      professionalId: shop.membershipId,
      clientId,
      serviceIds: [corte],
      startsAt: at(date, '09:00'),
    }).expect(201);

    const response = await as(app, shop.token)
      .get('/v1/availability')
      .query({ date, serviceIds: `${corte},${barba}`, professionalId: shop.membershipId })
      .expect(200);
    const starts: string[] = response.body.professionals[0].starts;
    expect(response.body.durationMinutes).toBe(50);
    expect(starts).not.toContain(at(date, '09:00'));
    expect(starts).not.toContain(at(date, '09:15'));
    expect(starts).toContain(at(date, '09:30'));
    // 17:15 + 50 min passa das 18:00.
    expect(starts).toContain(at(date, '17:00'));
    expect(starts).not.toContain(at(date, '17:15'));
  });

  it('agenda do dia mostra cada profissional com expediente e atendimentos', async () => {
    const date = nextDay();
    await book(shop.token, {
      professionalId: barberB.id,
      clientId,
      serviceIds: [barba],
      startsAt: at(date, '16:00'),
    }).expect(201);

    const agenda = await as(app, shop.token).get('/v1/agenda/day').query({ date }).expect(200);
    expect(agenda.body.timezone).toBe(SP);
    const bia = agenda.body.professionals.find((p: { id: string }) => p.id === barberB.id);
    expect(bia.workIntervals).toEqual([{ startMinute: 540, endMinute: 1080 }]);
    expect(bia.appointments).toHaveLength(1);
    expect(bia.appointments[0]).toMatchObject({
      client: { name: 'Carlos Cliente' },
      items: [{ name: 'Barba' }],
    });
  });

  it('segue a máquina de status e só reagenda antes do atendimento começar', async () => {
    const date = nextDay();
    const created = await book(shop.token, {
      professionalId: shop.membershipId,
      clientId,
      serviceIds: [corte],
      startsAt: at(date, '13:00'),
    }).expect(201);
    const owner = as(app, shop.token);
    const url = `/v1/appointments/${created.body.id}`;

    await owner
      .patch(url)
      .send({ startsAt: at(date, '13:30') })
      .expect(200);
    await owner.post(`${url}/status`).send({ status: 'CONFIRMED' }).expect(200);
    await owner.post(`${url}/status`).send({ status: 'IN_SERVICE' }).expect(200);

    const reschedule = await owner
      .patch(url)
      .send({ startsAt: at(date, '15:00') })
      .expect(422);
    expect(reschedule.body.type).toMatch(/not-reschedulable$/);
    const cancel = await owner.post(`${url}/status`).send({ status: 'CANCELLED' }).expect(422);
    expect(cancel.body.type).toMatch(/invalid-status-transition$/);
    // Concluir é exclusivo do fechamento da comanda.
    await owner.post(`${url}/status`).send({ status: 'COMPLETED' }).expect(400);
  });

  it('reagendar respeita conflitos, ignorando o próprio agendamento', async () => {
    const date = nextDay();
    const base = { professionalId: shop.membershipId, clientId, serviceIds: [corte] };
    const first = await book(shop.token, { ...base, startsAt: at(date, '10:00') }).expect(201);
    await book(shop.token, { ...base, startsAt: at(date, '11:00') }).expect(201);

    // Mover 15 min dentro do próprio horário não conflita consigo mesmo.
    await as(app, shop.token)
      .patch(`/v1/appointments/${first.body.id}`)
      .send({ startsAt: at(date, '10:15') })
      .expect(200);
    await as(app, shop.token)
      .patch(`/v1/appointments/${first.body.id}`)
      .send({ startsAt: at(date, '10:45') })
      .expect(409);
  });

  it('Idempotency-Key repete a resposta em vez de agendar duas vezes', async () => {
    const date = nextDay();
    const key = randomUUID();
    const body = {
      professionalId: shop.membershipId,
      clientId,
      serviceIds: [corte],
      startsAt: at(date, '16:00'),
    };

    const first = await book(shop.token, body, key).expect(201);
    const replay = await book(shop.token, body, key).expect(201);
    expect(replay.body.id).toBe(first.body.id);

    const reused = await book(shop.token, { ...body, startsAt: at(date, '17:00') }, key).expect(422);
    expect(reused.body.type).toMatch(/idempotency-key-reused$/);

    const day = await as(app, shop.token).get('/v1/agenda/day').query({ date }).expect(200);
    const mine = day.body.professionals.find((p: { id: string }) => p.id === shop.membershipId);
    expect(mine.appointments).toHaveLength(1);
  });

  it('profissional só vê e altera a própria agenda', async () => {
    const date = nextDay();
    await book(barberB.token, {
      professionalId: barberB.id,
      clientId,
      serviceIds: [corte],
      startsAt: at(date, '10:00'),
    }).expect(201);
    await book(barberB.token, {
      professionalId: shop.membershipId,
      clientId,
      serviceIds: [corte],
      startsAt: at(date, '10:00'),
    }).expect(403);

    const agenda = await as(app, barberB.token).get('/v1/agenda/day').query({ date }).expect(200);
    expect(agenda.body.professionals.map((p: { id: string }) => p.id)).toEqual([barberB.id]);
  });

  it('isola agendamentos entre barbearias', async () => {
    const date = nextDay();
    const created = await book(shop.token, {
      professionalId: shop.membershipId,
      clientId,
      serviceIds: [corte],
      startsAt: at(date, '12:00'),
    }).expect(201);

    await expectTenantIsolation(app, other, [
      { method: 'get', url: `/v1/appointments/${created.body.id}` },
      { method: 'patch', url: `/v1/appointments/${created.body.id}`, body: { notes: 'invasão' } },
      { method: 'post', url: `/v1/appointments/${created.body.id}/status`, body: { status: 'CANCELLED' } },
      // Cliente de outra barbearia não pode ser usado.
      {
        method: 'post',
        url: '/v1/appointments',
        body: {
          professionalId: other.membershipId,
          clientId,
          serviceIds: [corte],
          startsAt: at(date, '12:00'),
        },
      },
    ]);
  });
});
