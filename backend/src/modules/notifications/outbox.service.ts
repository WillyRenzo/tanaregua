import { Global, Injectable, Module } from '@nestjs/common';
import type { Tx } from '../../prisma/prisma.service.js';

/** Eventos de domínio (passado, imutáveis). O payload só carrega IDs — nunca PII. */
export type DomainEvent =
  | { type: 'AppointmentBooked'; payload: { appointmentId: string } }
  | { type: 'AppointmentCancelled'; payload: { appointmentId: string } }
  | { type: 'AppointmentRescheduled'; payload: { appointmentId: string } }
  | { type: 'MarketingMessageQueued'; payload: { messageId: string } };

@Injectable()
export class OutboxService {
  /** Grava o evento na MESMA transação da mudança: ou os dois acontecem, ou nenhum. */
  async publish(tx: Tx, barbershopId: string, event: DomainEvent): Promise<void> {
    await tx.outboxEvent.create({
      data: { barbershopId, type: event.type, payload: event.payload },
    });
  }

  /** Vários eventos de uma vez (ex.: uma mensagem por destinatário de campanha). */
  async publishMany(tx: Tx, barbershopId: string, events: DomainEvent[]): Promise<void> {
    if (events.length === 0) return;
    await tx.outboxEvent.createMany({
      data: events.map((event) => ({ barbershopId, type: event.type, payload: event.payload })),
    });
  }
}

export interface OutboxEventRef {
  id: string;
  barbershopId: string;
  payload: Record<string, unknown>;
}

/** Consumidor de um tipo de evento, registrado pelo módulo dono do efeito. */
export interface OutboxHandler {
  /** Lança erro para o outbox tentar de novo com backoff. */
  handle(event: OutboxEventRef): Promise<void>;
  /** Chamado uma vez quando o evento esgota as tentativas (dead letter). */
  onDeadLetter?(event: OutboxEventRef, lastError: string): Promise<void>;
}

/**
 * Registro de consumidores do outbox. Módulos que dependem de outros (ex.: marketing, que usa
 * clientes, agenda e e-mail) registram o próprio handler, sem o worker depender deles.
 */
@Injectable()
export class OutboxHandlers {
  private readonly handlers = new Map<string, OutboxHandler>();

  register(type: DomainEvent['type'], handler: OutboxHandler): void {
    this.handlers.set(type, handler);
  }

  get(type: string): OutboxHandler | undefined {
    return this.handlers.get(type);
  }
}

/** Separado do worker para não criar dependência circular (agenda publica, worker lê a agenda). */
@Global()
@Module({
  providers: [OutboxService, OutboxHandlers],
  exports: [OutboxService, OutboxHandlers],
})
export class OutboxModule {}
