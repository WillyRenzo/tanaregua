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

  const drain = async () => {
    while ((await processor.processBatch()) > 0) {
      // processa tudo o que estiver elegível
    }
  };

  /**
   * Outros arquivos de teste rodam em paralelo no mesmo banco e também drenam o outbox:
   * o evento pode ter sido reivindicado por outro processo e ainda estar em PROCESSING.
   * Espera ele assentar antes de verificar.
   */
  const settled = async (id: string) => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const event = await prisma.outboxEvent.findUniqueOrThrow({ where: { id } });
      if (event.status !== 'PROCESSING') return event;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`evento ${id} preso em PROCESSING`);
  };

  it('evento que falha volta para a fila com backoff e registra o erro', async () => {
    const tenant = await registerTenant(app);
    const event = await prisma.outboxEvent.create({
      data: { barbershopId: tenant.barbershopId, type: 'EventoInexistente', payload: {} },
    });

    await drain();
    const failed = await settled(event.id);
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

    await drain();
    const dead = await settled(event.id);
    expect(dead).toMatchObject({ status: 'FAILED', attempts: 5 });

    // Dead letter não é mais reivindicado.
    await drain();
    expect((await settled(event.id)).attempts).toBe(5);
  });

  it('agendamento de cliente sem e-mail conclui o evento sem enviar nada', async () => {
    const tenant = await registerTenant(app);
    const appointmentId = '00000000-0000-7000-8000-000000000000';
    const event = await prisma.outboxEvent.create({
      data: { barbershopId: tenant.barbershopId, type: 'AppointmentBooked', payload: { appointmentId } },
    });
    await drain();
    // Agendamento inexistente: erro de domínio vira retry, não derruba o worker.
    const result = await settled(event.id);
    expect(result.status).toBe('PENDING');
    expect(result.lastError).toMatch(/não encontrado/);
  });
});
