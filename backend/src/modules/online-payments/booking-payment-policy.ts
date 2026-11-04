import type { CancellationContext } from '../appointments/appointment-payments.js';

/** Minutos que o horário fica segurado sem pagamento no modo exigido (§5). */
export const HOLD_MINUTES = 15;

/** Prazo máximo de um checkout aberto no modo opcional (pode pagar depois, §5). */
export const OPTIONAL_CHECKOUT_HOURS = 24;

export interface ChargeSettings {
  amount: 'FULL' | 'DEPOSIT';
  depositBps: number | null;
}

/**
 * Valor cobrado online (§5): o total dos serviços ou o sinal. Único ponto de arredondamento do
 * sinal: meio centavo para cima, como a comissão (decisão de 04/11/2026).
 */
export function onlineChargeCents(totalCents: number, settings: ChargeSettings): number {
  if (totalCents <= 0) return 0;
  if (settings.amount === 'FULL') return totalCents;
  if (settings.depositBps === null) throw new Error('Sinal sem percentual');
  return Math.round((totalCents * settings.depositBps) / 10_000);
}

/** O que o cancelamento faz com uma reserva já paga (§5). */
export type PaidCancellation = 'refund' | 'retain' | 'needs-kind';

/**
 * - o cliente cancela (só consegue dentro do prazo dele): reembolso integral;
 * - a barbearia cancela por imprevisto: reembolso integral;
 * - a barbearia cancela a pedido do cliente: reembolso dentro do prazo do cliente, senão o valor fica.
 */
export function paidCancellation(
  context: CancellationContext,
  startsAt: Date,
  cancellationMinNoticeMinutes: number,
  now: Date = new Date(),
): PaidCancellation {
  if (context.by === 'client') return 'refund';
  if (!context.kind) return 'needs-kind';
  if (context.kind === 'BARBERSHOP') return 'refund';
  const deadline = startsAt.getTime() - cancellationMinNoticeMinutes * 60_000;
  return now.getTime() <= deadline ? 'refund' : 'retain';
}
