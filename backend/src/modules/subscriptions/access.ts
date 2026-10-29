import type { BillingInterval, SubscriptionStatus } from '../../generated/prisma/client.js';

/** Duração do teste grátis de quem chega (business-rules §12). */
export const TRIAL_DAYS = 14;
/** Carência depois do fim do período pago sem nova cobrança aprovada (§12). */
export const GRACE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Situação de uso da barbearia, derivada da assinatura (sem job: muda sozinha com a data).
 *
 * - `trial`: teste grátis até `until`;
 * - `active`: em dia (`until` = fim do período pago, ou nulo numa cortesia);
 * - `canceled`: cancelada, mas usa até o fim do período pago (`until`);
 * - `grace`: período pago acabou sem cobrança aprovada; usa até o fim da carência (`until`);
 * - `read-only`: painel só para consulta; a página pública continua.
 */
export type AccessState = 'trial' | 'active' | 'canceled' | 'grace' | 'read-only';

export interface Access {
  state: AccessState;
  until: Date | null;
}

export interface AccessInput {
  status: SubscriptionStatus;
  trialEndsAt: Date | null;
  paidThrough: Date | null;
  gatewaySubscriptionId: string | null;
}

export function accessOf(subscription: AccessInput, now: Date = new Date()): Access {
  const { status, trialEndsAt, paidThrough, gatewaySubscriptionId } = subscription;
  const readOnly: Access = { state: 'read-only', until: null };

  if (status === 'TRIALING') {
    return trialEndsAt && now < trialEndsAt ? { state: 'trial', until: trialEndsAt } : readOnly;
  }
  // Ativa sem gateway: cortesia concedida fora da aplicação (seed, suporte). Não expira.
  if (gatewaySubscriptionId === null) {
    return status === 'CANCELED' ? readOnly : { state: 'active', until: null };
  }
  if (!paidThrough) return status === 'CANCELED' ? readOnly : { state: 'active', until: null };
  if (now < paidThrough) {
    return { state: status === 'CANCELED' ? 'canceled' : 'active', until: paidThrough };
  }
  if (status === 'CANCELED') return readOnly;
  const graceEnd = new Date(paidThrough.getTime() + GRACE_DAYS * DAY_MS);
  return now < graceEnd ? { state: 'grace', until: graceEnd } : readOnly;
}

export const trialEnd = (from: Date = new Date()): Date => new Date(from.getTime() + TRIAL_DAYS * DAY_MS);

/** Soma um ciclo (1 ou 12 meses) em UTC; dia 31 + 1 mês cai no último dia do mês seguinte. */
export function addInterval(date: Date, interval: BillingInterval): Date {
  const months = interval === 'YEARLY' ? 12 : 1;
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}
