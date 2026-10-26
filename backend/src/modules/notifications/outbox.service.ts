import { Global, Injectable, Module } from '@nestjs/common';
import type { Tx } from '../../prisma/prisma.service.js';

/** Eventos de domínio (passado, imutáveis). O payload só carrega IDs — nunca PII. */
export type DomainEvent =
  | { type: 'AppointmentBooked'; payload: { appointmentId: string } }
  | { type: 'AppointmentCancelled'; payload: { appointmentId: string } };

@Injectable()
export class OutboxService {
  /** Grava o evento na MESMA transação da mudança: ou os dois acontecem, ou nenhum. */
  async publish(tx: Tx, barbershopId: string, event: DomainEvent): Promise<void> {
    await tx.outboxEvent.create({
      data: { barbershopId, type: event.type, payload: event.payload },
    });
  }
}

/** Separado do worker para não criar dependência circular (agenda publica, worker lê a agenda). */
@Global()
@Module({
  providers: [OutboxService],
  exports: [OutboxService],
})
export class OutboxModule {}
