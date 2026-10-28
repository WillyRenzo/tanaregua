import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import type { Env } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppointmentsService, type ClientAppointmentView } from '../appointments/appointments.service.js';
import { BarbershopsService } from '../barbershops/barbershops.module.js';
import { ClientsService } from '../clients/clients.service.js';
import { MailSender, type MailMessage } from './mail-sender.js';
import { OutboxHandlers, type OutboxEventRef } from './outbox.service.js';

const BATCH_SIZE = 20;
const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 30_000;

interface ClaimedEvent {
  id: string;
  barbershop_id: string;
  type: string;
  payload: { appointmentId?: string } & Record<string, unknown>;
  attempts: number;
}

/**
 * Worker do outbox: reivindica lotes com FOR UPDATE SKIP LOCKED (seguro com várias
 * instâncias), despacha fora da transação e reagenda falhas com backoff exponencial.
 * Após MAX_ATTEMPTS o evento vai para FAILED (dead letter) e é logado como erro.
 */
@Injectable()
export class OutboxProcessor {
  private readonly logger = new Logger(OutboxProcessor.name);
  private running = false;
  private readonly enabled: boolean;
  private readonly publicUrl: string;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AppointmentsService) private readonly appointments: AppointmentsService,
    @Inject(ClientsService) private readonly clients: ClientsService,
    @Inject(BarbershopsService) private readonly barbershops: BarbershopsService,
    @Inject(MailSender) private readonly mail: MailSender,
    @Inject(OutboxHandlers) private readonly handlers: OutboxHandlers,
    @Inject(ConfigService) config: ConfigService<Env, true>,
  ) {
    // Nos testes o lote é processado sob demanda (processBatch), para ser determinístico.
    this.enabled = config.get('NODE_ENV') !== 'test';
    this.publicUrl = config.get('APP_PUBLIC_URL');
  }

  @Interval(5_000)
  async tick(): Promise<void> {
    if (!this.enabled || this.running) return;
    this.running = true;
    try {
      await this.processBatch();
    } catch (error) {
      this.logger.error(error instanceof Error ? error.stack : String(error));
    } finally {
      this.running = false;
    }
  }

  /**
   * Retorna quantos eventos foram reivindicados neste lote. O worker processa todas as
   * barbearias; o escopo por barbearia existe para os testes e2e, que rodam em paralelo
   * no mesmo banco e não podem despachar os eventos uns dos outros.
   */
  async processBatch(scope: { barbershopId?: string } = {}): Promise<number> {
    const barbershopId = scope.barbershopId ?? null;
    // PROCESSING com next_attempt_at no futuro funciona como lease: se o processo morrer
    // no meio, o evento volta a ser elegível depois de 5 minutos.
    const events = await this.prisma.$queryRaw<ClaimedEvent[]>`
      UPDATE outbox_events
         SET status = 'PROCESSING', attempts = attempts + 1, next_attempt_at = now() + interval '5 minutes'
       WHERE id IN (
         SELECT id FROM outbox_events
          WHERE status IN ('PENDING', 'PROCESSING') AND next_attempt_at <= now()
            AND (${barbershopId}::uuid IS NULL OR barbershop_id = ${barbershopId}::uuid)
          ORDER BY created_at
          LIMIT ${BATCH_SIZE}
          FOR UPDATE SKIP LOCKED)
      RETURNING id, barbershop_id, type, payload, attempts`;

    for (const event of events) {
      try {
        await this.dispatch(event);
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: { status: 'PROCESSED', processedAt: new Date(), lastError: null },
        });
      } catch (error) {
        await this.recordFailure(event, error);
      }
    }
    return events.length;
  }

  private async dispatch(event: ClaimedEvent): Promise<void> {
    const handler = this.handlers.get(event.type);
    if (handler) return handler.handle(toRef(event));
    switch (event.type) {
      case 'AppointmentBooked':
        return this.notifyClient(event, 'booked');
      case 'AppointmentCancelled':
        return this.notifyClient(event, 'cancelled');
      case 'AppointmentRescheduled':
        return this.notifyClient(event, 'rescheduled');
      default:
        throw new Error(`Tipo de evento desconhecido: ${event.type}`);
    }
  }

  private async notifyClient(event: ClaimedEvent, kind: MessageKind): Promise<void> {
    const appointmentId = event.payload.appointmentId;
    if (!appointmentId) throw new Error('Evento sem appointmentId');

    const message = await this.prisma.withContext({ barbershopId: event.barbershop_id }, async (tx) => {
      const settings = await this.barbershops.settings(tx, event.barbershop_id);
      const appointment = await this.appointments.getInTx(tx, event.barbershop_id, appointmentId);
      const contact = await this.clients.contact(tx, event.barbershop_id, appointment.client.id);
      if (!contact?.email) return null;
      return composeMessage(kind, {
        to: contact.email,
        clientName: contact.name,
        barbershopName: settings.name,
        timezone: settings.timezone,
        manageUrl: `${this.publicUrl}/${settings.slug}/meus-agendamentos`,
        appointment,
      });
    });

    // Cliente sem e-mail (ou anonimizado): nada a enviar, evento concluído.
    if (message) await this.mail.send(message, event.id);
  }

  private async recordFailure(event: ClaimedEvent, error: unknown): Promise<void> {
    const lastError = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    const exhausted = event.attempts >= MAX_ATTEMPTS;
    await this.prisma.outboxEvent.update({
      where: { id: event.id },
      data: exhausted
        ? { status: 'FAILED', lastError }
        : {
            status: 'PENDING',
            lastError,
            nextAttemptAt: new Date(Date.now() + BASE_BACKOFF_MS * 2 ** (event.attempts - 1)),
          },
    });
    if (exhausted) {
      this.logger.error(`Evento ${event.id} (${event.type}) falhou ${event.attempts} vezes: ${lastError}`);
      try {
        await this.handlers.get(event.type)?.onDeadLetter?.(toRef(event), lastError);
      } catch (error) {
        this.logger.error(
          `Dead letter de ${event.id} não foi registrada: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}

const toRef = (event: ClaimedEvent): OutboxEventRef => ({
  id: event.id,
  barbershopId: event.barbershop_id,
  payload: event.payload,
});

interface MessageContext {
  to: string;
  clientName: string;
  barbershopName: string;
  timezone: string;
  manageUrl: string;
  appointment: ClientAppointmentView;
}

type MessageKind = 'booked' | 'cancelled' | 'rescheduled';

function composeMessage(kind: MessageKind, context: MessageContext): MailMessage {
  const when = new Intl.DateTimeFormat('pt-BR', {
    timeZone: context.timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(context.appointment.startsAt);
  const services = context.appointment.items.map((item) => item.name).join(', ');
  const total = (context.appointment.totalCents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });

  if (kind === 'cancelled') {
    return {
      to: context.to,
      subject: `Agendamento cancelado — ${context.barbershopName}`,
      text: [
        `Olá, ${context.clientName}.`,
        '',
        `Seu horário de ${when} (${services}) foi cancelado.`,
        '',
        `Para marcar outro horário: ${context.manageUrl.replace('/meus-agendamentos', '')}`,
      ].join('\n'),
    };
  }

  if (kind === 'rescheduled') {
    return {
      to: context.to,
      subject: `Agendamento remarcado — ${context.barbershopName}`,
      text: [
        `Olá, ${context.clientName}!`,
        '',
        `Seu horário foi remarcado para ${when}.`,
        `Profissional: ${context.appointment.professional.name}`,
        `Serviços: ${services}`,
        '',
        `Para ver, reagendar ou cancelar: ${context.manageUrl}`,
      ].join('\n'),
    };
  }

  return {
    to: context.to,
    subject: `Agendamento confirmado — ${context.barbershopName}`,
    text: [
      `Olá, ${context.clientName}!`,
      '',
      `Seu horário está confirmado: ${when}.`,
      `Profissional: ${context.appointment.professional.name}`,
      `Serviços: ${services}`,
      `Total: ${total}`,
      '',
      `Para ver, reagendar ou cancelar: ${context.manageUrl}`,
    ].join('\n'),
  };
}
