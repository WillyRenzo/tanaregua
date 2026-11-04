import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { verifyMercadoPagoSignature } from '../subscriptions/mercadopago-signature.js';
import {
  centsToDecimal,
  InvalidNotificationError,
  type IncomingNotification,
} from '../subscriptions/payment-gateway.js';

/** Credenciais da conta da barbearia no gateway. Só existem decifradas dentro da API. */
export interface MerchantCredentials {
  accessToken: string;
}

/** Conta conferida no gateway ao conectar. */
export interface MerchantAccount {
  id: string;
  name: string;
}

/** Pagamento de uma reserva no checkout hospedado do gateway (Pix ou cartão). */
export interface MerchantCheckoutRequest {
  /** Id do pagamento no TaNaRegua (volta como referência externa). */
  reference: string;
  /** Texto que o cliente vê, ex.: "Barbearia do Zé - Corte (sinal)". */
  title: string;
  amountCents: number;
  /** Depois disso o checkout não aceita mais pagamento. */
  expiresAt: Date;
  /** URL de notificação da conta (`/…/webhook/:webhookKey`). */
  notificationUrl: string;
  /** Para onde o cliente volta depois de pagar ou desistir. */
  backUrl: string;
}

export interface MerchantCheckout {
  id: string;
  /** Para onde mandar o cliente. */
  checkoutUrl: string;
}

/** Situação do pagamento no gateway, já no vocabulário do TaNaRegua. */
export type MerchantPaymentStatus = 'approved' | 'pending' | 'rejected' | 'cancelled' | 'refunded';

export interface MerchantPayment {
  id: string;
  status: MerchantPaymentStatus;
  /** Referência externa do checkout (o id do pagamento no TaNaRegua). */
  reference: string | null;
  amountCents: number;
}

/** Notificação já verificada: só diz qual pagamento mudou; o estado vem de uma consulta. */
export interface MerchantNotice {
  /** Id da notificação no gateway, para não processar a mesma duas vezes. */
  eventId: string;
  paymentId: string;
}

/** Falha do gateway. Leva só o status HTTP e o código do provedor, nunca o corpo nem o token. */
export class MerchantGatewayError extends Error {
  constructor(
    readonly status: number,
    readonly providerCode?: string,
  ) {
    super(`Gateway de pagamento respondeu ${status}${providerCode ? ` (${providerCode})` : ''}`);
  }
}

/**
 * Porta da conta da barbearia no gateway (business-rules §5): o dinheiro do cliente cai
 * direto na conta dela, e o TaNaRegua só usa as credenciais que ela conectou. É separada da
 * porta da assinatura do TaNaRegua (`PaymentGateway`), que cobra com a conta da plataforma,
 * mas o gateway da instalação é o mesmo (`PAYMENT_PROVIDER`).
 */
export abstract class MerchantGateway {
  /** Nome gravado em `payment_accounts.provider`; `null` com o pagamento online desligado. */
  abstract readonly provider: string | null;
  /** Confere as credenciais e devolve a conta. Lança `MerchantGatewayError` se recusadas. */
  abstract verifyAccount(credentials: MerchantCredentials): Promise<MerchantAccount>;
  abstract createCheckout(
    credentials: MerchantCredentials,
    request: MerchantCheckoutRequest,
  ): Promise<MerchantCheckout>;
  abstract getPayment(credentials: MerchantCredentials, paymentId: string): Promise<MerchantPayment>;
  /** Reembolso integral. Idempotente pela chave: repetir não devolve duas vezes. */
  abstract refund(credentials: MerchantCredentials, paymentId: string, idempotencyKey: string): Promise<void>;
  /**
   * Confere a assinatura com o segredo da conta e extrai o pagamento que mudou. Lança
   * `InvalidNotificationError` se a assinatura não confere; `null` = notificação válida que
   * não é de pagamento (ignorada).
   */
  abstract parseNotification(
    notification: IncomingNotification,
    webhookSecret: string,
  ): MerchantNotice | null;
}

/** `PAYMENT_PROVIDER=none`: pagamento online indisponível na instalação. */
@Injectable()
export class DisabledMerchantGateway extends MerchantGateway {
  readonly provider = null;

  private fail(): never {
    throw new Error('Pagamento online desligado (PAYMENT_PROVIDER=none)');
  }

  verifyAccount(): Promise<MerchantAccount> {
    return this.fail();
  }

  createCheckout(): Promise<MerchantCheckout> {
    return this.fail();
  }

  getPayment(): Promise<MerchantPayment> {
    return this.fail();
  }

  refund(): Promise<void> {
    return this.fail();
  }

  parseNotification(): MerchantNotice | null {
    throw new InvalidNotificationError();
  }
}

/** Token que o gateway simulado recusa, para os testes da conexão. */
export const FAKE_MERCHANT_INVALID_TOKEN = 'token-recusado-para-testes';

interface FakeCheckout {
  request: MerchantCheckoutRequest;
  accessToken: string;
}

interface FakePayment extends MerchantPayment {
  accessToken: string;
}

/**
 * Desenvolvimento e testes: aceita qualquer conta (menos o token de recusa) e guarda checkouts
 * e pagamentos em memória. O checkout é aprovado por `approve` (rota de checkout simulado).
 */
@Injectable()
export class FakeMerchantGateway extends MerchantGateway {
  readonly provider = 'fake';
  private readonly logger = new Logger('MerchantGateway');
  private readonly checkouts = new Map<string, FakeCheckout>();
  private readonly payments = new Map<string, FakePayment>();
  /** Reembolsos feitos, por chave de idempotência (os testes conferem que não repetem). */
  readonly refunds = new Map<string, string>();

  async verifyAccount(credentials: MerchantCredentials): Promise<MerchantAccount> {
    if (credentials.accessToken === FAKE_MERCHANT_INVALID_TOKEN) throw new MerchantGatewayError(401);
    return { id: `fake-${credentials.accessToken.slice(-6)}`, name: 'Conta de teste' };
  }

  async createCheckout(
    credentials: MerchantCredentials,
    request: MerchantCheckoutRequest,
  ): Promise<MerchantCheckout> {
    const id = `fake-checkout-${randomUUID()}`;
    this.checkouts.set(id, { request, accessToken: credentials.accessToken });
    this.logger.log(`Checkout simulado criado: ${id}`);
    // Caminho relativo: o navegador chega pela mesma origem da página (rewrite /api do Next).
    return { id, checkoutUrl: `/api/v1/online-payments/fake-checkout/${id}` };
  }

  async getPayment(credentials: MerchantCredentials, paymentId: string): Promise<MerchantPayment> {
    const payment = this.payments.get(paymentId);
    // Pagamento de outra conta não existe para este token, como no gateway real.
    if (!payment || payment.accessToken !== credentials.accessToken) throw new MerchantGatewayError(404);
    const { accessToken: _, ...view } = payment;
    return view;
  }

  async refund(credentials: MerchantCredentials, paymentId: string, idempotencyKey: string): Promise<void> {
    const payment = this.payments.get(paymentId);
    if (payment && payment.accessToken !== credentials.accessToken) throw new MerchantGatewayError(404);
    if (this.refunds.has(idempotencyKey)) return;
    // Pagamento que este processo não conhece (criado pelo seed, ou antes de a API reiniciar):
    // a memória do simulado não sobrevive, e o reembolso na demo precisa funcionar.
    if (payment) payment.status = 'refunded';
    this.refunds.set(idempotencyKey, paymentId);
  }

  parseNotification(notification: IncomingNotification, webhookSecret: string): MerchantNotice | null {
    return parseMercadoPagoPaymentNotification(notification, webhookSecret);
  }

  /**
   * Simula o cliente pagando no checkout: cria o pagamento aprovado (com o valor do checkout,
   * ou outro, para os testes) e devolve para onde avisar e para onde o navegador volta.
   */
  approve(
    checkoutId: string,
    options: { amountCents?: number } = {},
  ): { paymentId: string; notificationUrl: string; backUrl: string } {
    const checkout = this.checkouts.get(checkoutId);
    if (!checkout) throw new MerchantGatewayError(404);
    const paymentId = `fake-payment-${randomUUID()}`;
    this.payments.set(paymentId, {
      id: paymentId,
      status: 'approved',
      reference: checkout.request.reference,
      amountCents: options.amountCents ?? checkout.request.amountCents,
      accessToken: checkout.accessToken,
    });
    return {
      paymentId,
      notificationUrl: checkout.request.notificationUrl,
      backUrl: checkout.request.backUrl,
    };
  }

  /** Só para os testes: o último checkout criado para uma referência. */
  inspect(reference: string): (MerchantCheckoutRequest & { id: string }) | undefined {
    const entries = [...this.checkouts.entries()].filter(
      ([, checkout]) => checkout.request.reference === reference,
    );
    const last = entries.at(-1);
    return last ? { id: last[0], ...last[1].request } : undefined;
  }
}

const API_URL = 'https://api.mercadopago.com';
const TIMEOUT_MS = 10_000;

/** Só o que o TaNaRegua usa de `/users/me`. */
const userSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  nickname: z.string().optional(),
});

/** Só o que o TaNaRegua usa da preferência do Checkout Pro. */
const preferenceSchema = z.object({ id: z.string().min(1), init_point: z.string().min(1) });

/** Só o que o TaNaRegua usa de `/v1/payments/:id`. */
const paymentSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  status: z.string(),
  external_reference: z.string().nullish(),
  transaction_amount: z.number(),
});

/** Situações do Mercado Pago no vocabulário do TaNaRegua; as desconhecidas ficam pendentes. */
const PAYMENT_STATUSES: Record<string, MerchantPaymentStatus> = {
  approved: 'approved',
  rejected: 'rejected',
  cancelled: 'cancelled',
  refunded: 'refunded',
  charged_back: 'refunded',
};

/** Valor decimal do gateway para centavos (ex.: 79.9 → 7990). Só aqui. */
export function decimalToCents(value: number): number {
  return Math.round(value * 100);
}

/** Mercado Pago (Checkout Pro) com o access token da conta da barbearia, via HTTP sem SDK. */
@Injectable()
export class MercadoPagoMerchantGateway extends MerchantGateway {
  readonly provider = 'mercadopago';

  async verifyAccount(credentials: MerchantCredentials): Promise<MerchantAccount> {
    const user = userSchema.parse(await this.call(credentials, 'GET', '/users/me'));
    return { id: user.id, name: user.nickname ?? `Conta ${user.id}` };
  }

  async createCheckout(
    credentials: MerchantCredentials,
    request: MerchantCheckoutRequest,
  ): Promise<MerchantCheckout> {
    const expiresAt = request.expiresAt.toISOString();
    const preference = preferenceSchema.parse(
      await this.call(
        credentials,
        'POST',
        '/checkout/preferences',
        {
          items: [
            {
              id: request.reference,
              title: request.title,
              quantity: 1,
              currency_id: 'BRL',
              unit_price: centsToDecimal(request.amountCents),
            },
          ],
          external_reference: request.reference,
          notification_url: request.notificationUrl,
          back_urls: { success: request.backUrl, pending: request.backUrl, failure: request.backUrl },
          auto_return: 'approved',
          expires: true,
          expiration_date_to: expiresAt,
          // Pix tem prazo próprio; boleto (dias para compensar) fica de fora (§5: Pix ou cartão).
          date_of_expiration: expiresAt,
          payment_methods: { excluded_payment_types: [{ id: 'ticket' }] },
        },
        // Uma preferência por tentativa: a chave evita duas no retry da mesma chamada.
        `${request.reference}:${expiresAt}`,
      ),
    );
    return { id: preference.id, checkoutUrl: preference.init_point };
  }

  async getPayment(credentials: MerchantCredentials, paymentId: string): Promise<MerchantPayment> {
    const payment = paymentSchema.parse(
      await this.call(credentials, 'GET', `/v1/payments/${encodeURIComponent(paymentId)}`),
    );
    return {
      id: payment.id,
      status: PAYMENT_STATUSES[payment.status] ?? 'pending',
      reference: payment.external_reference ?? null,
      amountCents: decimalToCents(payment.transaction_amount),
    };
  }

  async refund(credentials: MerchantCredentials, paymentId: string, idempotencyKey: string): Promise<void> {
    await this.call(
      credentials,
      'POST',
      `/v1/payments/${encodeURIComponent(paymentId)}/refunds`,
      {},
      idempotencyKey,
    );
  }

  parseNotification(notification: IncomingNotification, webhookSecret: string): MerchantNotice | null {
    return parseMercadoPagoPaymentNotification(notification, webhookSecret);
  }

  private async call(
    credentials: MerchantCredentials,
    method: string,
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<unknown> {
    const response = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      // Toda chamada externa tem timeout (AFA 14); o retry com backoff fica no outbox.
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const code = (payload as { error?: unknown } | null)?.error;
      throw new MerchantGatewayError(response.status, typeof code === 'string' ? code : undefined);
    }
    return payload;
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
 * Notificação de pagamento do Mercado Pago na `notification_url` da preferência:
 * `?type=payment&data.id=<id>` com o corpo `{ id, type, data: { id } }`, assinada com o segredo
 * da aplicação da barbearia (a confirmar no sandbox, mvp-plan).
 */
export function parseMercadoPagoPaymentNotification(
  notification: IncomingNotification,
  secret: string,
): MerchantNotice | null {
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
  if (type !== 'payment' || !dataId) return null;
  const eventId = text(body.id) ?? header(notification.headers, 'x-request-id') ?? randomUUID();
  return { eventId, paymentId: dataId };
}
