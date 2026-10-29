import { Global, Injectable, Module } from '@nestjs/common';
import type { Tx } from '../../prisma/prisma.service.js';

/** Eventos de domínio (passado, imutáveis). O payload só carrega IDs — nunca PII. */
export type DomainEvent =
  | { type: 'AppointmentBooked'; payload: { appointmentId: string } }
  | { type: 'AppointmentCancelled'; payload: { appointmentId: string } }
  | { type: 'AppointmentRescheduled'; payload: { appointmentId: string } }
  | { type: 'MarketingMessageQueued'; payload: { messageId: string } }
  /** O gateway avisou que a assinatura mudou: consultar e aplicar a situação. */
  | { type: 'GatewaySubscriptionChanged'; payload: { provider: string; gatewaySubscriptionId: string } }
  /** Assinatura no gateway que não vale mais (checkout substituído): cancelar lá. */
  | {
      type: 'GatewaySubscriptionCancelRequested';
      payload: { provider: string; gatewaySubscriptionId: string };
    }
  /** Reajuste agendado: avisar o dono por e-mail. */
  | { type: 'SubscriptionPriceChangeNotice'; payload: { subscriptionId: string } }
  /** Data do reajuste chegou: repassar o novo valor ao gateway. */
  | { type: 'SubscriptionPriceChangeDue'; payload: { subscriptionId: string } };

@Injectable()
export class OutboxService {
  /**
   * Grava o evento na MESMA transação da mudança: ou os dois acontecem, ou nenhum.
   * `availableAt` adia o despacho (ex.: o reajuste que só vale 30 dias depois do aviso).
   */
  async publish(
    tx: Tx,
    barbershopId: string,
    event: DomainEvent,
    options: { availableAt?: Date } = {},
  ): Promise<void> {
    await tx.outboxEvent.create({
      data: {
        barbershopId,
        type: event.type,
        payload: event.payload,
        ...(options.availableAt ? { nextAttemptAt: options.availableAt } : {}),
      },
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
