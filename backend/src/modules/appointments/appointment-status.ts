import { unprocessable } from '../../common/http/domain-error.js';

export type AppointmentStatus =
  'SCHEDULED' | 'CONFIRMED' | 'IN_SERVICE' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

/**
 * Máquina de estados do agendamento. COMPLETED só é alcançado pelo fechamento da
 * comanda; CANCELLED, NO_SHOW e COMPLETED são finais.
 */
const TRANSITIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  SCHEDULED: ['CONFIRMED', 'IN_SERVICE', 'CANCELLED', 'NO_SHOW'],
  CONFIRMED: ['IN_SERVICE', 'CANCELLED', 'NO_SHOW'],
  IN_SERVICE: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

/** Status que ocupam a agenda (os mesmos da exclusion constraint). */
export const BLOCKING_STATUSES: readonly AppointmentStatus[] = [
  'SCHEDULED',
  'CONFIRMED',
  'IN_SERVICE',
  'COMPLETED',
];

export function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: AppointmentStatus, to: AppointmentStatus): void {
  if (!canTransition(from, to)) {
    throw unprocessable('invalid-status-transition', `Não é possível mudar de ${from} para ${to}.`);
  }
}

/** Horário, profissional e serviços só podem mudar antes do atendimento começar. */
export function isReschedulable(status: AppointmentStatus): boolean {
  return status === 'SCHEDULED' || status === 'CONFIRMED';
}
