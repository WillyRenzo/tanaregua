import { Injectable } from '@nestjs/common';
import type { Tx } from '../../prisma/prisma.service.js';
import type { AppointmentPaymentSummary } from './appointments.responses.js';

/** Quem cancelou um agendamento, para o pagamento online decidir se reembolsa (§5). */
export type CancellationContext =
  | { by: 'client' }
  /** Pela equipe; `kind` é o motivo pedido no painel quando a reserva foi paga. */
  | { by: 'staff'; kind?: StaffCancellationKind };

/** Motivo do cancelamento pela barbearia de uma reserva paga (§5). */
export type StaffCancellationKind = 'BARBERSHOP' | 'CLIENT_REQUEST';

/** Implementada pelo módulo de pagamento online, dono da tabela de pagamentos das reservas. */
export interface AppointmentPaymentHook {
  summaries(
    tx: Tx,
    barbershopId: string,
    appointmentIds: string[],
  ): Promise<Map<string, AppointmentPaymentSummary>>;
  /** Chamado na mesma transação do cancelamento; pode recusar (ex.: falta o motivo). */
  onCancel(
    tx: Tx,
    barbershopId: string,
    appointment: { id: string; startsAt: Date },
    context: CancellationContext,
  ): Promise<void>;
}

/**
 * Ponto de extensão da agenda para o pagamento online. A agenda não lê a tabela de pagamentos
 * (nem depende do módulo dele, que depende dela): o módulo de pagamento se registra aqui, como
 * os consumidores do outbox. Sem registro, nenhum agendamento tem pagamento.
 */
@Injectable()
export class AppointmentPayments {
  private hook: AppointmentPaymentHook | undefined;

  register(hook: AppointmentPaymentHook): void {
    this.hook = hook;
  }

  async summaries(
    tx: Tx,
    barbershopId: string,
    appointmentIds: string[],
  ): Promise<Map<string, AppointmentPaymentSummary>> {
    if (!this.hook || appointmentIds.length === 0) return new Map();
    return this.hook.summaries(tx, barbershopId, appointmentIds);
  }

  async onCancel(
    tx: Tx,
    barbershopId: string,
    appointment: { id: string; startsAt: Date },
    context: CancellationContext,
  ): Promise<void> {
    await this.hook?.onCancel(tx, barbershopId, appointment, context);
  }
}
