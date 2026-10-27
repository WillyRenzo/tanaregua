import { OutboxProcessor } from '../src/modules/notifications/outbox.processor.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, registerTenant, type TestApp } from './helpers/app.js';

/** Caminhos de falha do outbox (AFA 12/14/19): retry com backoff e dead letter. */
describe('Outbox (e2e)', () => {
  let app: TestApp;
  let prisma: PrismaService;
  let processor: OutboxProcessor;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    processor = app.get(OutboxProcessor);
  });

  afterAll(async () => {
    await app.close();
  });

  /** Só os eventos da barbearia do teste: outros arquivos rodam em paralelo no mesmo banco. */
  const drain = async (barbershopId: string) => {
    while ((await processor.processBatch({ barbershopId })) > 0) {
      // processa tudo o que estiver elegível
    }
  };

  it('evento que falha volta para a fila com backoff e registra o erro', async () => {
    const tenant = await registerTenant(app);
    const event = await prisma.outboxEvent.create({
      data: { barbershopId: tenant.barbershopId, type: 'EventoInexistente', payload: {} },
    });

    await drain(tenant.barbershopId);
    const failed = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(failed).toMatchObject({ status: 'PENDING', attempts: 1 });
    expect(failed.lastError).toMatch(/desconhecido/);
    // Backoff: não é reprocessado imediatamente.
    expect(failed.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 20_000);
  });

  it('após o limite de tentativas o evento vai para FAILED (dead letter)', async () => {
    const tenant = await registerTenant(app);
    const event = await prisma.outboxEvent.create({
      data: { barbershopId: tenant.barbershopId, type: 'EventoInexistente', payload: {}, attempts: 4 },
    });

    await drain(tenant.barbershopId);
    const dead = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(dead).toMatchObject({ status: 'FAILED', attempts: 5 });

    // Dead letter não é mais reivindicado.
    await drain(tenant.barbershopId);
    expect((await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })).attempts).toBe(5);
  });

  it('agendamento de cliente sem e-mail conclui o evento sem enviar nada', async () => {
    const tenant = await registerTenant(app);
    const appointmentId = '00000000-0000-7000-8000-000000000000';
    const event = await prisma.outboxEvent.create({
      data: { barbershopId: tenant.barbershopId, type: 'AppointmentBooked', payload: { appointmentId } },
    });
    await drain(tenant.barbershopId);
    // Agendamento inexistente: erro de domínio vira retry, não derruba o worker.
    const result = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(result.status).toBe('PENDING');
    expect(result.lastError).toMatch(/não encontrado/);
  });

  it('lote com escopo de barbearia não reivindica eventos de outra', async () => {
    const mine = await registerTenant(app);
    const other = await registerTenant(app);
    const otherEvent = await prisma.outboxEvent.create({
      data: { barbershopId: other.barbershopId, type: 'EventoInexistente', payload: {} },
    });
    const myEvent = await prisma.outboxEvent.create({
      data: { barbershopId: mine.barbershopId, type: 'EventoInexistente', payload: {} },
    });

    await drain(mine.barbershopId);
    expect((await prisma.outboxEvent.findUniqueOrThrow({ where: { id: myEvent.id } })).attempts).toBe(1);
    expect(await prisma.outboxEvent.findUniqueOrThrow({ where: { id: otherEvent.id } })).toMatchObject({
      status: 'PENDING',
      attempts: 0,
    });
  });
});
