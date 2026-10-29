import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { Env } from '../../config/env.js';
import {
  INTERVAL_MONTHS,
  PaymentGateway,
  PaymentGatewayError,
  centsToDecimal,
  parseMercadoPagoNotification,
  type GatewayCheckout,
  type GatewayNotice,
  type GatewaySubscription,
  type IncomingNotification,
  type SubscriptionRequest,
} from './payment-gateway.js';

const API_URL = 'https://api.mercadopago.com';
const TIMEOUT_MS = 10_000;

const STATUSES = ['pending', 'authorized', 'paused', 'cancelled'] as const;

/** Só o que o TaNaRegua usa da resposta de `/preapproval`. */
const preapprovalSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  init_point: z.string().optional(),
});

/**
 * Adapter do Mercado Pago (assinatura sem plano associado, `/preapproval`) via HTTP, sem SDK
 * (menos dependências na cadeia de suprimentos). O pagador autoriza no checkout hospedado do
 * Mercado Pago: o cartão nunca passa pelo TaNaRegua.
 */
@Injectable()
export class MercadoPagoGateway extends PaymentGateway {
  readonly provider = 'mercadopago';
  private readonly accessToken: string;
  private readonly webhookSecret: string;
  private readonly publicUrl: string;

  constructor(@Inject(ConfigService) config: ConfigService<Env, true>) {
    super();
    this.accessToken = config.get('MERCADOPAGO_ACCESS_TOKEN') ?? '';
    this.webhookSecret = config.get('PAYMENT_WEBHOOK_SECRET') ?? '';
    this.publicUrl = config.get('APP_PUBLIC_URL');
  }

  async createSubscription(request: SubscriptionRequest): Promise<GatewayCheckout> {
    const created = preapprovalSchema.parse(
      await this.call(
        'POST',
        '/preapproval',
        {
          reason: request.reason,
          external_reference: request.reference,
          payer_email: request.payerEmail,
          back_url: new URL(request.backPath, this.publicUrl).toString(),
          status: 'pending',
          auto_recurring: {
            frequency: INTERVAL_MONTHS[request.interval],
            frequency_type: 'months',
            transaction_amount: centsToDecimal(request.amountCents),
            currency_id: 'BRL',
          },
        },
        request.reference,
      ),
    );
    if (!created.init_point) throw new PaymentGatewayError(502, 'missing_init_point');
    return { id: created.id, checkoutUrl: created.init_point };
  }

  async getSubscription(id: string): Promise<GatewaySubscription> {
    const found = preapprovalSchema.parse(await this.call('GET', `/preapproval/${encodeURIComponent(id)}`));
    const status = STATUSES.find((value) => value === found.status);
    if (!status) throw new PaymentGatewayError(502, `unknown_status_${found.status}`);
    return { id: found.id, status };
  }

  async updateSubscriptionAmount(id: string, amountCents: number): Promise<void> {
    await this.call('PUT', `/preapproval/${encodeURIComponent(id)}`, {
      auto_recurring: { transaction_amount: centsToDecimal(amountCents), currency_id: 'BRL' },
    });
  }

  async cancelSubscription(id: string): Promise<void> {
    const current = await this.getSubscription(id);
    if (current.status === 'cancelled') return;
    await this.call('PUT', `/preapproval/${encodeURIComponent(id)}`, { status: 'cancelled' });
  }

  parseNotification(notification: IncomingNotification): GatewayNotice | null {
    return parseMercadoPagoNotification(notification, this.webhookSecret);
  }

  private async call(
    method: string,
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<unknown> {
    const response = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      // Toda chamada externa tem timeout (AFA 14); o retry com backoff fica no outbox.
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const code = (payload as { error?: unknown } | null)?.error;
      throw new PaymentGatewayError(response.status, typeof code === 'string' ? code : undefined);
    }
    return payload;
  }
}
