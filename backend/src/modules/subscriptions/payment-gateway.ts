import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import type { BillingInterval } from '../../generated/prisma/client.js';
import { signMercadoPagoNotification, verifyMercadoPagoSignature } from './mercadopago-signature.js';

/** Pedido de assinatura recorrente no checkout hospedado do gateway. */
export interface SubscriptionRequest {
  /** Id do checkout no TaNaRegua (volta como referência externa). */
  reference: string;
  /** E-mail de quem paga (o dono que iniciou a assinatura). */
  payerEmail: string;
  /** Texto que o pagador vê, ex.: "TaNaRegua - Plano Profissional (mensal)". */
  reason: string;
  amountCents: number;
  interval: BillingInterval;
  /** Caminho do painel para onde o pagador volta (o adapter monta a URL absoluta se precisar). */
  backPath: string;
}

export interface GatewayCheckout {
  /** Id da assinatura no gateway. */
  id: string;
  /** Para onde mandar o pagador. */
  checkoutUrl: string;
}

/** Situação da assinatura no gateway, já no vocabulário do TaNaRegua. */
export type GatewaySubscriptionStatus = 'pending' | 'authorized' | 'paused' | 'cancelled';

export interface GatewaySubscription {
  id: string;
  status: GatewaySubscriptionStatus;
}

/** Notificação já verificada: só diz qual assinatura mudou. O estado vem de uma consulta. */
export interface GatewayNotice {
  /** Id da notificação no gateway, para não processar a mesma duas vezes. */
  eventId: string;
  gatewaySubscriptionId: string;
}

export interface IncomingNotification {
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
  body: unknown;
}

/** Falha do gateway. Leva só o status HTTP e o código do provedor, nunca dados do pagador. */
export class PaymentGatewayError extends Error {
  constructor(
    readonly status: number,
    readonly providerCode?: string,
  ) {
    super(`Gateway de pagamento respondeu ${status}${providerCode ? ` (${providerCode})` : ''}`);
  }
}

/** Assinatura da notificação ausente ou inválida: a rota responde 401 e não faz nada. */
export class InvalidNotificationError extends Error {}

/**
 * Porta de pagamento (business-rules §5, AFA 06): o domínio fala só com ela. Cada gateway é
 * um adapter escolhido por `PAYMENT_PROVIDER`; trocar de gateway não muda regra nem tabela.
 */
export abstract class PaymentGateway {
  /** Nome gravado em `gateway_provider`; `null` quando a assinatura online está desligada. */
  abstract readonly provider: string | null;
  abstract createSubscription(request: SubscriptionRequest): Promise<GatewayCheckout>;
  abstract getSubscription(id: string): Promise<GatewaySubscription>;
  /** Novo valor por ciclo, a partir da próxima cobrança. Idempotente. */
  abstract updateSubscriptionAmount(id: string, amountCents: number): Promise<void>;
  /** Idempotente: cancelar uma assinatura já cancelada não é erro. */
  abstract cancelSubscription(id: string): Promise<void>;
  /**
   * Confere a assinatura da notificação e extrai a assinatura que mudou. `null` = notificação
   * válida que não é sobre assinatura (ex.: pagamento avulso), ignorada.
   */
  abstract parseNotification(notification: IncomingNotification): GatewayNotice | null;
}

/** Centavos para o valor decimal que os gateways pedem (ex.: 7990 → 79.9). Só aqui. */
export function centsToDecimal(cents: number): number {
  if (!Number.isInteger(cents)) throw new Error('Valor em centavos precisa ser inteiro');
  return Number(`${Math.trunc(cents / 100)}.${String(Math.abs(cents % 100)).padStart(2, '0')}`);
}

/** Meses entre cobranças de cada ciclo. */
export const INTERVAL_MONTHS: Record<BillingInterval, number> = { MONTHLY: 1, YEARLY: 12 };

/** `PAYMENT_PROVIDER=none`: a assinatura online está desligada (a rota responde 503). */
@Injectable()
export class DisabledPaymentGateway extends PaymentGateway {
  readonly provider = null;

  private fail(): never {
    throw new Error('Assinatura online desligada (PAYMENT_PROVIDER=none)');
  }

  createSubscription(): Promise<GatewayCheckout> {
    return this.fail();
  }
  getSubscription(): Promise<GatewaySubscription> {
    return this.fail();
  }
  updateSubscriptionAmount(): Promise<void> {
    return this.fail();
  }
  cancelSubscription(): Promise<void> {
    return this.fail();
  }
  parseNotification(): GatewayNotice | null {
    throw new InvalidNotificationError();
  }
}

interface FakeSubscription {
  status: GatewaySubscriptionStatus;
  amountCents: number;
  interval: BillingInterval;
  backPath: string;
}

/**
 * Gateway simulado (desenvolvimento e testes; recusado em produção). Guarda as assinaturas em
 * memória, devolve um checkout que aprova na hora (`/v1/billing/fake-checkout/:id`) e assina
 * as notificações no formato do Mercado Pago, para o mesmo caminho do webhook ser exercitado.
 */
@Injectable()
export class FakePaymentGateway extends PaymentGateway {
  readonly provider = 'fake';
  private readonly logger = new Logger('PaymentGateway');
  private readonly subscriptions = new Map<string, FakeSubscription>();
  private readonly secret: string;

  constructor(@Inject(ConfigService) config: ConfigService<Env, true>) {
    super();
    this.secret = config.get('PAYMENT_WEBHOOK_SECRET') ?? '';
  }

  async createSubscription(request: SubscriptionRequest): Promise<GatewayCheckout> {
    const id = `fake-${randomUUID()}`;
    this.subscriptions.set(id, {
      status: 'pending',
      amountCents: request.amountCents,
      interval: request.interval,
      backPath: request.backPath,
    });
    this.logger.log(`Assinatura simulada criada: ${id}`);
    // Caminho relativo: o navegador chega pela mesma origem do painel (rewrite /api do Next).
    return { id, checkoutUrl: `/api/v1/billing/fake-checkout/${id}` };
  }

  async getSubscription(id: string): Promise<GatewaySubscription> {
    return { id, status: this.find(id).status };
  }

  async updateSubscriptionAmount(id: string, amountCents: number): Promise<void> {
    this.find(id).amountCents = amountCents;
  }

  async cancelSubscription(id: string): Promise<void> {
    this.find(id).status = 'cancelled';
  }

  parseNotification(notification: IncomingNotification): GatewayNotice | null {
    return parseMercadoPagoNotification(notification, this.secret);
  }

  /** Simula o pagador mudando a assinatura no gateway (aprovar, pausar, cancelar). */
  setStatus(id: string, status: GatewaySubscriptionStatus): void {
    this.find(id).status = status;
  }

  /** Para os testes conferirem o que foi repassado ao gateway. */
  inspect(id: string): Readonly<FakeSubscription> {
    return { ...this.find(id) };
  }

  /** Notificação assinada como o Mercado Pago enviaria, para o webhook. */
  notification(id: string, eventId: string = randomUUID()) {
    const requestId = randomUUID();
    return {
      query: { type: 'subscription_preapproval', 'data.id': id },
      headers: {
        'x-signature': signMercadoPagoNotification(id, requestId, this.secret),
        'x-request-id': requestId,
      },
      body: { id: eventId, type: 'subscription_preapproval', action: 'updated', data: { id } },
    };
  }

  private find(id: string): FakeSubscription {
    const subscription = this.subscriptions.get(id);
    if (!subscription) throw new PaymentGatewayError(404);
    return subscription;
  }
}

const header = (headers: IncomingNotification['headers'], name: string): string | undefined => {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
};

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0
    ? value
    : typeof value === 'number'
      ? String(value)
      : undefined;

/**
 * Notificação no formato do Mercado Pago: `?type=subscription_preapproval&data.id=<id>` com o
 * corpo `{ id, type, data: { id } }`. Só a assinatura (preapproval) interessa nesta entrega;
 * os pagamentos de cada ciclo (`subscription_authorized_payment`) entram com a inadimplência.
 */
export function parseMercadoPagoNotification(
  notification: IncomingNotification,
  secret: string,
): GatewayNotice | null {
  const body = (notification.body ?? {}) as { id?: unknown; type?: unknown; data?: { id?: unknown } };
  const dataId = text(notification.query['data.id']) ?? text(body.data?.id);
  const valid = verifyMercadoPagoSignature(
    {
      signature: header(notification.headers, 'x-signature'),
      requestId: header(notification.headers, 'x-request-id'),
      dataId,
    },
    secret,
  );
  if (!valid) throw new InvalidNotificationError();

  const type = text(notification.query['type']) ?? text(notification.query['topic']) ?? text(body.type);
  if (type !== 'subscription_preapproval' || !dataId) return null;
  const eventId = text(body.id) ?? header(notification.headers, 'x-request-id') ?? randomUUID();
  return { eventId, gatewaySubscriptionId: dataId };
}
