import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SecretBox } from '../../common/crypto/secret-box.js';
import { notFound, unprocessable } from '../../common/http/domain-error.js';
import type { Env } from '../../config/env.js';
import type { BookingPayment, PaymentAccount } from '../../generated/prisma/client.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import type { CancellationContext } from '../appointments/appointment-payments.js';
import type { AppointmentPaymentSummary } from '../appointments/appointments.responses.js';
import { AppointmentsService, type ClientAppointmentView } from '../appointments/appointments.service.js';
import { BarbershopsService } from '../barbershops/barbershops.module.js';
import { OutboxService, type OutboxEventRef } from '../notifications/outbox.service.js';
import { InvalidNotificationError, type IncomingNotification } from '../subscriptions/payment-gateway.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';
import {
  HOLD_MINUTES,
  OPTIONAL_CHECKOUT_HOURS,
  onlineChargeCents,
  paidCancellation,
} from './booking-payment-policy.js';
import {
  FakeMerchantGateway,
  MerchantGateway,
  MerchantGatewayError,
  type MerchantCredentials,
  type MerchantPayment,
} from './merchant-gateway.js';
import { onlinePaymentUnavailable, paymentGatewayUnavailable } from './online-payments.errors.js';

/** Como a reserva online é paga agora nesta barbearia; `null` = não é paga online. */
export interface PaymentOffer {
  mode: 'OPTIONAL' | 'REQUIRED';
  amount: 'FULL' | 'DEPOSIT';
  depositBps: number | null;
}

/** Um checkout que vence em menos que isso não é reaproveitado: abre outro. */
const CHECKOUT_REUSE_MARGIN_MS = 60_000;

/** Situações em que a reserva já foi paga (o dinheiro passou pela conta da barbearia). */
const PAID_STATUSES = new Set<BookingPayment['status']>([
  'PAID',
  'REFUND_PENDING',
  'REFUNDED',
  'REFUND_FAILED',
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pagamento online da reserva (business-rules §5), na conta da própria barbearia:
 * - modo opcional: a reserva vale na hora e pode ser paga online até o atendimento;
 * - modo exigido: o horário fica segurado por 15 minutos; sem pagamento, a reserva cai, e um
 *   pagamento que chega depois confirma a reserva se o horário ainda estiver livre (senão, é
 *   reembolsado);
 * - o estado só muda por notificação verificada seguida de consulta ao gateway;
 * - reembolsos saem pelo outbox, com chave de idempotência no gateway.
 */
@Injectable()
export class BookingPaymentsService {
  private readonly logger = new Logger(BookingPaymentsService.name);
  private readonly publicUrl: string;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SecretBox) private readonly secrets: SecretBox,
    @Inject(MerchantGateway) private readonly gateway: MerchantGateway,
    @Inject(AppointmentsService) private readonly appointments: AppointmentsService,
    @Inject(BarbershopsService) private readonly barbershops: BarbershopsService,
    @Inject(SubscriptionsService) private readonly subscriptions: SubscriptionsService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(ConfigService) config: ConfigService<Env, true>,
  ) {
    this.publicUrl = config.get('APP_PUBLIC_URL');
  }

  // ───────────── Reserva ─────────────

  /**
   * A reserva é paga online se a instalação tem gateway, a barbearia conectou a conta nele,
   * escolheu um modo e o plano tem o recurso. Sem isso, novas reservas não cobram (decisão de
   * 04/11/2026); as já pagas continuam.
   */
  async offer(tx: Tx, barbershopId: string): Promise<PaymentOffer | null> {
    const account = await this.account(tx, barbershopId);
    if (!account || account.mode === 'OFF') return null;
    const features = (await this.subscriptions.summary(tx, barbershopId))?.features ?? [];
    if (!features.includes('online-payment')) return null;
    return { mode: account.mode, amount: account.amount, depositBps: account.depositBps };
  }

  /**
   * Abre o pagamento de uma reserva recém-feita (ou de uma que o cliente quer pagar depois). No
   * modo exigido com `hold`, agenda a queda da reserva para o fim do prazo. Devolve `null` se
   * não há o que cobrar (serviços sem preço).
   */
  async open(
    tx: Tx,
    barbershopId: string,
    appointment: ClientAppointmentView,
    offer: PaymentOffer,
    options: { hold: boolean },
  ): Promise<string | null> {
    const amountCents = onlineChargeCents(appointment.totalCents, offer);
    if (amountCents <= 0) return null;
    const holdUntil = options.hold ? new Date(Date.now() + HOLD_MINUTES * 60_000) : null;
    const payment = await tx.bookingPayment.create({
      data: {
        barbershopId,
        appointmentId: appointment.id,
        provider: this.gateway.provider!,
        amountCents,
        holdUntil,
      },
    });
    if (holdUntil) {
      await this.outbox.publish(
        tx,
        barbershopId,
        { type: 'BookingPaymentHoldExpired', payload: { bookingPaymentId: payment.id } },
        { availableAt: holdUntil },
      );
    }
    return payment.id;
  }

  /**
   * "Pagar agora" de uma reserva sem pagamento ou com pagamento pendente (§5, modo opcional:
   * pode pagar depois). Valida dentro da transação do cliente; o checkout abre depois.
   */
  async prepareToPay(tx: Tx, barbershopId: string, appointment: ClientAppointmentView): Promise<void> {
    const payable =
      (appointment.status === 'SCHEDULED' || appointment.status === 'CONFIRMED') &&
      appointment.startsAt.getTime() > Date.now();
    const current = await this.find(tx, barbershopId, appointment.id);
    if (current) {
      if (current.status !== 'PENDING' || !payable) throw paymentNotOpen();
      return;
    }
    if (!payable) throw paymentNotOpen();
    const offer = await this.offer(tx, barbershopId);
    if (!offer) {
      throw unprocessable('online-payment-off', 'Esta barbearia não está recebendo pagamento online agora.');
    }
    if (!(await this.open(tx, barbershopId, appointment, offer, { hold: false }))) throw paymentNotOpen();
  }

  /**
   * Checkout do gateway para o pagamento pendente da reserva, reaproveitado enquanto vale. Roda
   * fora da transação da reserva: a chamada ao gateway não segura conexão do banco.
   */
  async checkout(barbershopId: string, appointmentId: string): Promise<string> {
    const context = await this.prisma.withContext({ barbershopId }, async (tx) => {
      const payment = await this.find(tx, barbershopId, appointmentId);
      if (!payment || payment.status !== 'PENDING') throw paymentNotOpen();
      if (
        payment.checkoutUrl &&
        payment.checkoutExpiresAt &&
        payment.checkoutExpiresAt.getTime() > Date.now() + CHECKOUT_REUSE_MARGIN_MS
      ) {
        return { kind: 'reuse', url: payment.checkoutUrl } as const;
      }
      const account = await this.account(tx, barbershopId);
      if (!account) throw onlinePaymentUnavailable();
      const shop = await this.barbershops.settings(tx, barbershopId);
      const appointment = await this.appointments.getInTx(tx, barbershopId, appointmentId);
      return { kind: 'new', payment, account, shop, appointment } as const;
    });
    if (context.kind === 'reuse') return context.url;

    const { payment, account, shop, appointment } = context;
    const optionalLimit = Math.min(
      appointment.startsAt.getTime(),
      Date.now() + OPTIONAL_CHECKOUT_HOURS * 60 * 60_000,
    );
    const expiresAt = payment.holdUntil ?? new Date(optionalLimit);
    const deposit = payment.amountCents < appointment.totalCents;
    let checkout;
    try {
      checkout = await this.gateway.createCheckout(this.credentials(account, barbershopId), {
        reference: payment.id,
        title:
          `${shop.name} - ${appointment.items.map((item) => item.name).join(', ')}${deposit ? ' (sinal)' : ''}`.slice(
            0,
            250,
          ),
        amountCents: payment.amountCents,
        expiresAt,
        notificationUrl: `${this.publicUrl}/api/v1/online-payments/webhook/${account.webhookKey}`,
        backUrl: `${this.publicUrl}/${shop.slug}/meus-agendamentos?pagamento=${appointmentId}`,
      });
    } catch (error) {
      if (!(error instanceof MerchantGatewayError)) throw error;
      this.logger.warn({
        event: 'booking-payment.checkout.failed',
        status: error.status,
        code: error.providerCode,
      });
      throw paymentGatewayUnavailable();
    }
    await this.prisma.withContext({ barbershopId }, (tx) =>
      tx.bookingPayment.updateMany({
        where: { id: payment.id, barbershopId, status: 'PENDING' },
        data: { checkoutId: checkout.id, checkoutUrl: checkout.checkoutUrl, checkoutExpiresAt: expiresAt },
      }),
    );
    return checkout.checkoutUrl;
  }

  // ───────────── Agenda (porta AppointmentPayments) ─────────────

  async summaries(
    tx: Tx,
    barbershopId: string,
    appointmentIds: string[],
  ): Promise<Map<string, AppointmentPaymentSummary>> {
    const rows = await tx.bookingPayment.findMany({
      where: { barbershopId, appointmentId: { in: appointmentIds } },
    });
    const now = Date.now();
    return new Map(
      rows.map((row) => [
        row.appointmentId,
        {
          status: row.status,
          amountCents: row.amountCents,
          holdUntil: row.holdUntil,
          checkoutUrl:
            row.status === 'PENDING' && row.checkoutExpiresAt && row.checkoutExpiresAt.getTime() > now
              ? row.checkoutUrl
              : null,
          paidAt: row.paidAt,
          refundedAt: row.refundedAt,
        },
      ]),
    );
  }

  /** Cancelamento da reserva (§5): reembolso automático nos casos previstos. */
  async onCancel(
    tx: Tx,
    barbershopId: string,
    appointment: { id: string; startsAt: Date },
    context: CancellationContext,
  ): Promise<void> {
    const payment = await this.find(tx, barbershopId, appointment.id);
    if (!payment) return;
    if (payment.status === 'PENDING') {
      await this.setStatus(tx, payment, { status: 'CANCELLED' });
      return;
    }
    if (payment.status !== 'PAID') return;

    const shop = await this.barbershops.settings(tx, barbershopId);
    const decision = paidCancellation(context, appointment.startsAt, shop.cancellationMinNoticeMinutes);
    if (decision === 'needs-kind') {
      throw unprocessable(
        'cancellation-kind-required',
        'Esta reserva foi paga online. Diga se o cancelamento é imprevisto da barbearia ou a pedido do cliente.',
      );
    }
    if (decision === 'refund') {
      const reason =
        context.by === 'client'
          ? 'Cancelada pelo cliente no prazo'
          : context.kind === 'BARBERSHOP'
            ? 'Cancelada pela barbearia (imprevisto)'
            : 'Cancelada a pedido do cliente, no prazo';
      await this.requestRefund(tx, payment, reason);
    }
    // 'retain': o valor fica com a barbearia (entra no caixa na entrega 3).
  }

  // ───────────── Notificações do gateway ─────────────

  /**
   * Notificação na URL da conta: a chave diz de qual barbearia é, e a assinatura é conferida
   * com o segredo dela. Só põe a consulta ao gateway no outbox; repetida é ignorada.
   */
  async receiveNotification(webhookKey: string, notification: IncomingNotification): Promise<void> {
    const provider = this.gateway.provider;
    if (!provider) throw notFound('Conta');
    const barbershopId = await this.prisma.withContext({}, async (tx) => {
      const [row] = await tx.$queryRaw<{ barbershop_id: string | null }[]>`
        SELECT payment_account_tenant_of(${webhookKey}) AS barbershop_id`;
      return row?.barbershop_id ?? null;
    });
    if (!barbershopId) throw notFound('Conta');

    await this.prisma.withContext({ barbershopId }, async (tx) => {
      const account = await this.account(tx, barbershopId);
      if (!account) throw notFound('Conta');
      let notice;
      try {
        notice = this.gateway.parseNotification(
          notification,
          this.secrets.open(account.webhookSecretSealed, barbershopId),
        );
      } catch (error) {
        if (!(error instanceof InvalidNotificationError)) throw error;
        this.logger.warn({ event: 'booking-payment.webhook.rejected', barbershopId });
        throw new UnauthorizedException('Assinatura da notificação inválida.');
      }
      if (!notice) return;
      const fresh = await tx.bookingPaymentWebhookEvent.createMany({
        data: [{ barbershopId, eventId: notice.eventId }],
        skipDuplicates: true,
      });
      if (fresh.count === 0) return;
      await this.outbox.publish(tx, barbershopId, {
        type: 'BookingPaymentChanged',
        payload: { provider, gatewayPaymentId: notice.paymentId },
      });
    });
  }

  /**
   * Checkout do gateway simulado (só desenvolvimento e testes): aprova o pagamento e segue o
   * mesmo caminho de uma notificação. Devolve para onde o navegador volta.
   */
  async approveFakeCheckout(checkoutId: string): Promise<string> {
    const gateway = this.gateway;
    if (!(gateway instanceof FakeMerchantGateway)) throw notFound('Checkout');
    let approved;
    try {
      approved = gateway.approve(checkoutId);
    } catch {
      throw notFound('Checkout');
    }
    const webhookKey = approved.notificationUrl.split('/').at(-1) ?? '';
    const barbershopId = await this.prisma.withContext({}, async (tx) => {
      const [row] = await tx.$queryRaw<{ barbershop_id: string | null }[]>`
        SELECT payment_account_tenant_of(${webhookKey}) AS barbershop_id`;
      return row?.barbershop_id ?? null;
    });
    if (barbershopId) {
      await this.prisma.withContext({ barbershopId }, (tx) =>
        this.outbox.publish(tx, barbershopId, {
          type: 'BookingPaymentChanged',
          payload: { provider: gateway.provider, gatewayPaymentId: approved.paymentId },
        }),
      );
    }
    // Caminho relativo: o navegador volta pela mesma origem em que abriu o checkout simulado.
    const back = new URL(approved.backUrl);
    return `${back.pathname}${back.search}`;
  }

  // ───────────── Consumidores do outbox ─────────────

  /** Consulta o pagamento no gateway e aplica a situação (§5). */
  async applyGatewayPayment(event: OutboxEventRef): Promise<void> {
    const { provider, gatewayPaymentId } = event.payload as { provider: string; gatewayPaymentId: string };
    if (provider !== this.gateway.provider) return;
    const credentials = await this.prisma.withContext({ barbershopId: event.barbershopId }, async (tx) => {
      const account = await this.account(tx, event.barbershopId);
      return account ? this.credentials(account, event.barbershopId) : null;
    });
    if (!credentials) return;
    const gatewayPayment = await this.gateway.getPayment(credentials, gatewayPaymentId);

    await this.prisma.withContext({ barbershopId: event.barbershopId }, async (tx) => {
      const reference = gatewayPayment.reference;
      const payment =
        reference && UUID.test(reference)
          ? await tx.bookingPayment.findFirst({ where: { id: reference, barbershopId: event.barbershopId } })
          : null;
      if (!payment) {
        // Pagamento que não é de reserva do TaNaRegua (outra venda na mesma conta).
        this.logger.warn({ event: 'booking-payment.unknown', barbershopId: event.barbershopId });
        return;
      }
      if (gatewayPayment.status === 'approved') await this.onApproved(tx, payment, gatewayPayment);
      if (gatewayPayment.status === 'refunded') await this.onRefundedAtGateway(tx, payment, gatewayPayment);
    });
  }

  async refund(event: OutboxEventRef): Promise<void> {
    const { bookingPaymentId } = event.payload as { bookingPaymentId: string };
    const target = await this.prisma.withContext({ barbershopId: event.barbershopId }, async (tx) => {
      const payment = await tx.bookingPayment.findFirst({
        where: { id: bookingPaymentId, barbershopId: event.barbershopId },
      });
      if (payment?.status !== 'REFUND_PENDING') return null;
      const account = await this.account(tx, event.barbershopId);
      // Conta desconectada: o reembolso tenta de novo e, esgotado, fica para a barbearia.
      if (!account) throw new Error('Conta de pagamento desconectada');
      return { payment, credentials: this.credentials(account, event.barbershopId) };
    });
    if (!target) return;
    await this.gateway.refund(
      target.credentials,
      target.payment.gatewayPaymentId!,
      `refund:${target.payment.id}`,
    );
    await this.prisma.withContext({ barbershopId: event.barbershopId }, (tx) =>
      tx.bookingPayment.updateMany({
        where: { id: bookingPaymentId, barbershopId: event.barbershopId, status: 'REFUND_PENDING' },
        data: { status: 'REFUNDED', refundedAt: new Date() },
      }),
    );
    this.logger.log({
      event: 'booking-payment.refunded',
      barbershopId: event.barbershopId,
      bookingPaymentId,
    });
  }

  /** Reembolso esgotou as tentativas: a barbearia resolve na conta dela (o painel mostra). */
  async refundFailed(event: OutboxEventRef): Promise<void> {
    const { bookingPaymentId } = event.payload as { bookingPaymentId: string };
    await this.prisma.withContext({ barbershopId: event.barbershopId }, (tx) =>
      tx.bookingPayment.updateMany({
        where: { id: bookingPaymentId, barbershopId: event.barbershopId, status: 'REFUND_PENDING' },
        data: { status: 'REFUND_FAILED' },
      }),
    );
  }

  async refundExtra(event: OutboxEventRef): Promise<void> {
    const { provider, gatewayPaymentId } = event.payload as { provider: string; gatewayPaymentId: string };
    if (provider !== this.gateway.provider) return;
    const credentials = await this.prisma.withContext({ barbershopId: event.barbershopId }, async (tx) => {
      const account = await this.account(tx, event.barbershopId);
      if (!account) throw new Error('Conta de pagamento desconectada');
      return this.credentials(account, event.barbershopId);
    });
    await this.gateway.refund(credentials, gatewayPaymentId, `extra:${gatewayPaymentId}`);
    this.logger.log({ event: 'booking-payment.extra-refunded', barbershopId: event.barbershopId });
  }

  /** Fim do prazo do modo exigido: sem pagamento, a reserva cai e o horário volta a ficar livre. */
  async expireHold(event: OutboxEventRef): Promise<void> {
    const { bookingPaymentId } = event.payload as { bookingPaymentId: string };
    await this.prisma.withContext({ barbershopId: event.barbershopId }, async (tx) => {
      const payment = await tx.bookingPayment.findFirst({
        where: { id: bookingPaymentId, barbershopId: event.barbershopId },
      });
      if (payment?.status !== 'PENDING' || !payment.holdUntil) return;
      if (payment.holdUntil.getTime() > Date.now()) {
        throw new Error('Prazo do pagamento ainda não acabou');
      }
      await this.setStatus(tx, payment, { status: 'EXPIRED' });
      await this.appointments.cancelUnpaidHold(tx, event.barbershopId, payment.appointmentId);
    });
  }

  // ───────────── Regras internas ─────────────

  private async onApproved(tx: Tx, payment: BookingPayment, gatewayPayment: MerchantPayment): Promise<void> {
    if (payment.gatewayPaymentId === gatewayPayment.id) return;
    if (PAID_STATUSES.has(payment.status) || gatewayPayment.amountCents !== payment.amountCents) {
      // Segundo pagamento da mesma reserva, ou valor diferente do cobrado: devolve esse.
      this.logger.warn({ event: 'booking-payment.extra', barbershopId: payment.barbershopId });
      await this.outbox.publish(tx, payment.barbershopId, {
        type: 'BookingPaymentExtraRefund',
        payload: { provider: payment.provider, gatewayPaymentId: gatewayPayment.id },
      });
      return;
    }

    const paid = { status: 'PAID' as const, gatewayPaymentId: gatewayPayment.id, paidAt: new Date() };
    if (payment.status === 'PENDING') {
      await this.setStatus(tx, payment, paid);
      // Modo exigido: a confirmação por e-mail só sai agora.
      if (payment.holdUntil) await this.confirmBooking(tx, payment);
      return;
    }
    if (payment.status === 'EXPIRED') {
      // Pago depois do prazo (decisão de 04/11/2026): vale se o horário ainda estiver livre.
      await this.setStatus(tx, payment, paid);
      if (await this.appointments.restoreUnpaidHold(tx, payment.barbershopId, payment.appointmentId)) {
        await this.confirmBooking(tx, payment);
      } else {
        await this.requestRefund(
          tx,
          { ...payment, ...paid },
          'Pago depois do prazo, com o horário já ocupado',
        );
      }
      return;
    }
    // CANCELLED: a reserva foi cancelada antes de o pagamento entrar.
    await this.setStatus(tx, payment, paid);
    await this.requestRefund(tx, { ...payment, ...paid }, 'Pago depois do cancelamento da reserva');
  }

  /** Reembolsado direto na conta do gateway (fora do TaNaRegua): registra. */
  private async onRefundedAtGateway(
    tx: Tx,
    payment: BookingPayment,
    gatewayPayment: MerchantPayment,
  ): Promise<void> {
    if (payment.gatewayPaymentId !== gatewayPayment.id) return;
    if (
      payment.status !== 'PAID' &&
      payment.status !== 'REFUND_FAILED' &&
      payment.status !== 'REFUND_PENDING'
    ) {
      return;
    }
    await this.setStatus(tx, payment, {
      status: 'REFUNDED',
      refundedAt: new Date(),
      refundReason: payment.refundReason ?? 'Reembolsado na conta do serviço de pagamento',
    });
  }

  private async requestRefund(tx: Tx, payment: BookingPayment, reason: string): Promise<void> {
    await this.setStatus(tx, payment, { status: 'REFUND_PENDING', refundReason: reason });
    await this.outbox.publish(tx, payment.barbershopId, {
      type: 'BookingPaymentRefund',
      payload: { bookingPaymentId: payment.id },
    });
  }

  private confirmBooking(tx: Tx, payment: BookingPayment): Promise<void> {
    return this.appointments.confirmBooking(tx, payment.barbershopId, payment.appointmentId);
  }

  private async setStatus(
    tx: Tx,
    payment: BookingPayment,
    data: Partial<
      Pick<BookingPayment, 'status' | 'gatewayPaymentId' | 'paidAt' | 'refundReason' | 'refundedAt'>
    >,
  ): Promise<void> {
    // Otimista: se outra notificação mudou o pagamento no meio, o outbox tenta de novo e relê.
    const updated = await tx.bookingPayment.updateMany({
      where: { id: payment.id, barbershopId: payment.barbershopId, status: payment.status },
      data,
    });
    if (updated.count === 0) throw new Error('Pagamento da reserva mudou durante a atualização');
  }

  private find(tx: Tx, barbershopId: string, appointmentId: string): Promise<BookingPayment | null> {
    return tx.bookingPayment.findFirst({ where: { barbershopId, appointmentId } });
  }

  /** A conta conectada, se é do gateway desta instalação. */
  private async account(tx: Tx, barbershopId: string): Promise<PaymentAccount | null> {
    if (!this.gateway.provider) return null;
    const account = await tx.paymentAccount.findFirst({ where: { barbershopId } });
    return account?.provider === this.gateway.provider ? account : null;
  }

  private credentials(account: PaymentAccount, barbershopId: string): MerchantCredentials {
    return { accessToken: this.secrets.open(account.accessTokenSealed, barbershopId) };
  }
}

const paymentNotOpen = () =>
  unprocessable('payment-not-open', 'Este agendamento não tem pagamento online em aberto.');
