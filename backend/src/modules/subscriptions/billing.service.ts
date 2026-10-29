import { randomUUID } from 'node:crypto';
import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { conflict, DomainError, notFound, unprocessable } from '../../common/http/domain-error.js';
import { TenantDb } from '../../common/tenancy/tenant-db.service.js';
import type { Env } from '../../config/env.js';
import type { BillingInterval, SubscriptionStatus } from '../../generated/prisma/client.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { BarbershopsService } from '../barbershops/barbershops.module.js';
import { MailSender } from '../notifications/mail-sender.js';
import { OutboxHandlers, OutboxService, type OutboxEventRef } from '../notifications/outbox.service.js';
import { StaffService } from '../staff/staff.service.js';
import {
  FakePaymentGateway,
  InvalidNotificationError,
  PaymentGateway,
  PaymentGatewayError,
  type GatewaySubscriptionStatus,
  type IncomingNotification,
} from './payment-gateway.js';
import { accessOf, addInterval } from './access.js';
import type { CheckoutView, SubscriptionDetail } from './subscriptions.responses.js';
import type { ChangePlanInput, StartCheckoutInput } from './subscriptions.schemas.js';
import { priceChangeEffectiveAt, publishPriceChange } from './subscriptions.service.js';

/** Para onde o pagador volta depois do checkout: o painel confere a confirmação do gateway. */
export const CHECKOUT_BACK_PATH = '/painel/configuracoes?assinatura=retorno#plano';
/** Um checkout aberto há menos tempo que isso, no mesmo plano, ciclo e preço, é reaproveitado. */
const CHECKOUT_REUSE_MS = 60 * 60 * 1000;

const INTERVAL_LABELS: Record<BillingInterval, string> = { MONTHLY: 'mensal', YEARLY: 'anual' };

/**
 * Situação do gateway na assinatura do TaNaRegua. `pending` não muda nada. Pausada vira "em
 * atraso" até as regras de inadimplência (mvp-plan, entrega 4): os recursos seguem liberados.
 */
const STATUS_FROM_GATEWAY: Record<GatewaySubscriptionStatus, SubscriptionStatus | null> = {
  pending: null,
  authorized: 'ACTIVE',
  paused: 'PAST_DUE',
  cancelled: 'CANCELED',
};

const billingUnavailable = () =>
  new DomainError(
    'billing-unavailable',
    'Service Unavailable',
    'A assinatura online ainda não está disponível. Fale com o suporte do TaNaRegua.',
    HttpStatus.SERVICE_UNAVAILABLE,
  );

const gatewayUnavailable = () =>
  new DomainError(
    'billing-gateway-unavailable',
    'Bad Gateway',
    'O serviço de pagamento não respondeu. Tente de novo em alguns minutos.',
    HttpStatus.BAD_GATEWAY,
  );

/** Assinatura que o gateway cobra hoje: enquanto existir, um checkout novo seria cobrança dupla. */
const hasPaidSubscription = (subscription: {
  gatewaySubscriptionId: string | null;
  status: SubscriptionStatus;
}) => subscription.gatewaySubscriptionId !== null && subscription.status !== 'CANCELED';

const formatMoney = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface GatewayRef {
  provider: string;
  gatewaySubscriptionId: string;
}

/**
 * Cobrança recorrente da assinatura (business-rules §5 e §12) pela porta `PaymentGateway`.
 *
 * - O dono abre o checkout hospedado do gateway; o cartão nunca passa pelo TaNaRegua.
 * - A assinatura só muda por notificação verificada seguida de consulta ao gateway (pelo
 *   outbox), nunca pelo retorno do navegador.
 * - Reajuste de preço: aviso por e-mail ao dono e repasse ao gateway 30 dias depois.
 */
@Injectable()
export class BillingService implements OnModuleInit {
  private readonly logger = new Logger(BillingService.name);
  private readonly publicUrl: string;

  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PaymentGateway) private readonly gateway: PaymentGateway,
    @Inject(StaffService) private readonly staff: StaffService,
    @Inject(BarbershopsService) private readonly barbershops: BarbershopsService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(OutboxHandlers) private readonly handlers: OutboxHandlers,
    @Inject(MailSender) private readonly mail: MailSender,
    @Inject(ConfigService) config: ConfigService<Env, true>,
  ) {
    this.publicUrl = config.get('APP_PUBLIC_URL');
  }

  onModuleInit(): void {
    this.handlers.register('GatewaySubscriptionChanged', { handle: (event) => this.syncFromGateway(event) });
    this.handlers.register('GatewaySubscriptionCancelRequested', {
      handle: (event) => this.cancelAtGateway(event),
    });
    this.handlers.register('SubscriptionPriceChangeNotice', {
      handle: (event) => this.sendPriceNotice(event),
    });
    this.handlers.register('SubscriptionPriceChangeDue', { handle: (event) => this.applyPriceChange(event) });
    this.handlers.register('GatewayPaymentChanged', { handle: (event) => this.syncPayment(event) });
    this.handlers.register('SubscriptionAmountSync', { handle: (event) => this.pushAmount(event) });
    this.handlers.register('SubscriptionPlanChangeDue', { handle: (event) => this.applyPlanChange(event) });
  }

  /** Assinatura da barbearia da requisição, para quem assina e paga. */
  detail(): Promise<SubscriptionDetail> {
    const provider = this.gateway.provider;
    return this.db.run(async (tx, auth) => {
      const subscription = await tx.subscription.findUnique({
        where: { barbershopId: auth.barbershopId },
        include: {
          plan: { select: { key: true, name: true } },
          scheduledPlan: { select: { key: true, name: true } },
        },
      });
      if (!subscription) throw notFound('Assinatura');
      const pending = provider
        ? await tx.subscriptionCheckout.findFirst({
            where: { barbershopId: auth.barbershopId, status: 'PENDING', gatewayProvider: provider },
            include: { plan: { select: { key: true, name: true } } },
            orderBy: { createdAt: 'desc' },
          })
        : null;
      const { scheduledAmountCents, scheduledAmountAt, scheduledPlan, scheduledPlanAt } = subscription;
      return {
        plan: subscription.plan,
        status: subscription.status,
        access: accessOf(subscription),
        interval: subscription.interval,
        amountCents: subscription.amountCents,
        scheduledChange:
          scheduledAmountCents !== null && scheduledAmountAt !== null
            ? { amountCents: scheduledAmountCents, effectiveAt: scheduledAmountAt }
            : null,
        pendingCheckout: pending
          ? {
              plan: pending.plan,
              interval: pending.interval,
              amountCents: pending.amountCents,
              checkoutUrl: pending.checkoutUrl,
              createdAt: pending.createdAt,
            }
          : null,
        onlineBilling: provider !== null,
        scheduledPlan:
          scheduledPlan && scheduledPlanAt ? { plan: scheduledPlan, effectiveAt: scheduledPlanAt } : null,
        canSubscribe: provider !== null && !hasPaidSubscription(subscription),
        canChangePlan:
          provider !== null && subscription.status === 'ACTIVE' && hasPaidSubscription(subscription),
      };
    });
  }

  /**
   * Abre o checkout do gateway para o plano e ciclo escolhidos, com o preço do catálogo. Um
   * checkout igual e recente é reaproveitado (clique duplo); os outros abertos são cancelados.
   */
  async startCheckout(input: StartCheckoutInput): Promise<CheckoutView> {
    const provider = this.gateway.provider;
    if (!provider) throw billingUnavailable();

    const prepared = await this.db.run(async (tx, auth) => {
      const subscription = await tx.subscription.findUnique({
        where: { barbershopId: auth.barbershopId },
        select: { gatewaySubscriptionId: true, status: true },
      });
      if (!subscription) throw notFound('Assinatura');
      if (hasPaidSubscription(subscription)) {
        throw conflict(
          'plan-change-unavailable',
          'Sua barbearia já tem uma assinatura paga. A troca de plano estará disponível em breve.',
        );
      }
      const plan = await tx.plan.findUnique({
        where: { key: input.planKey },
        select: {
          id: true,
          name: true,
          prices: { where: { interval: input.interval }, select: { amountCents: true } },
        },
      });
      if (!plan) throw notFound('Plano');
      const amountCents = plan.prices[0]?.amountCents;
      if (!amountCents) {
        throw unprocessable(
          'plan-not-for-sale',
          `O plano ${plan.name} não está à venda no ciclo ${INTERVAL_LABELS[input.interval]}.`,
        );
      }
      const reusable = await tx.subscriptionCheckout.findFirst({
        where: {
          barbershopId: auth.barbershopId,
          status: 'PENDING',
          gatewayProvider: provider,
          planId: plan.id,
          interval: input.interval,
          amountCents,
          createdAt: { gte: new Date(Date.now() - CHECKOUT_REUSE_MS) },
        },
        select: { checkoutUrl: true },
        orderBy: { createdAt: 'desc' },
      });
      if (reusable) return { kind: 'reuse', checkoutUrl: reusable.checkoutUrl } as const;
      const payer = await this.staff.contactOf(tx, auth.barbershopId, auth.userId);
      return { kind: 'new', plan, amountCents, payerEmail: payer.email } as const;
    });
    if (prepared.kind === 'reuse') return { checkoutUrl: prepared.checkoutUrl };

    const checkoutId = randomUUID();
    let created;
    try {
      created = await this.gateway.createSubscription({
        reference: checkoutId,
        payerEmail: prepared.payerEmail,
        reason: `TaNaRegua - Plano ${prepared.plan.name} (${INTERVAL_LABELS[input.interval]})`,
        amountCents: prepared.amountCents,
        interval: input.interval,
        backPath: CHECKOUT_BACK_PATH,
      });
    } catch (error) {
      if (!(error instanceof PaymentGatewayError)) throw error;
      this.logger.warn({ event: 'billing.checkout.failed', status: error.status, code: error.providerCode });
      throw gatewayUnavailable();
    }

    return this.db.run(async (tx, auth) => {
      await this.supersedePendingCheckouts(tx, auth.barbershopId);
      await tx.subscriptionCheckout.create({
        data: {
          id: checkoutId,
          barbershopId: auth.barbershopId,
          planId: prepared.plan.id,
          interval: input.interval,
          amountCents: prepared.amountCents,
          gatewayProvider: provider,
          gatewaySubscriptionId: created.id,
          checkoutUrl: created.checkoutUrl,
        },
      });
      this.logger.log({ event: 'billing.checkout.started', barbershopId: auth.barbershopId, checkoutId });
      return { checkoutUrl: created.checkoutUrl };
    });
  }

  /**
   * Troca de plano com a assinatura paga em dia, no mesmo ciclo (§12). Upgrade vale na hora;
   * downgrade, no fim do período pago. Nos dois casos, o gateway passa a cobrar o valor do
   * plano novo a partir da próxima cobrança, sem cobrança proporcional. Escolher de novo o
   * plano atual desfaz um downgrade agendado.
   */
  async changePlan(input: ChangePlanInput): Promise<SubscriptionDetail> {
    if (!this.gateway.provider) throw billingUnavailable();
    await this.db.run(async (tx, auth) => {
      const barbershopId = auth.barbershopId;
      await tx.$executeRaw`SELECT 1 FROM subscriptions WHERE barbershop_id = ${barbershopId}::uuid FOR UPDATE`;
      const subscription = await tx.subscription.findUnique({
        where: { barbershopId },
        include: { plan: { select: { position: true } } },
      });
      if (!subscription) throw notFound('Assinatura');
      const { interval, paidThrough } = subscription;
      if (
        subscription.status !== 'ACTIVE' ||
        !hasPaidSubscription(subscription) ||
        !interval ||
        !paidThrough
      ) {
        throw conflict(
          'plan-change-unavailable',
          'A troca de plano precisa de uma assinatura paga e em dia. Regularize o pagamento ou assine um plano.',
        );
      }
      const target = await tx.plan.findUnique({
        where: { key: input.planKey },
        select: {
          id: true,
          name: true,
          position: true,
          prices: { where: { interval }, select: { amountCents: true } },
        },
      });
      if (!target) throw notFound('Plano');
      const amountCents = target.prices[0]?.amountCents;
      if (!amountCents) {
        throw unprocessable(
          'plan-not-for-sale',
          `O plano ${target.name} não está à venda no ciclo ${INTERVAL_LABELS[interval]}.`,
        );
      }
      const keepsPlan = target.id === subscription.planId;
      if (keepsPlan && !subscription.scheduledPlanId) return;

      const upgrade = !keepsPlan && target.position > subscription.plan.position;
      const downgrade = !keepsPlan && !upgrade;
      await tx.subscription.update({
        where: { barbershopId },
        data: {
          ...(upgrade ? { planId: target.id } : {}),
          scheduledPlanId: downgrade ? target.id : null,
          scheduledPlanAt: downgrade ? paidThrough : null,
          amountCents,
          // O valor do plano novo é o do catálogo de hoje: um reajuste avisado do plano antigo cai.
          scheduledAmountCents: null,
          scheduledAmountAt: null,
        },
      });
      const ref = { subscriptionId: subscription.id };
      await this.outbox.publish(tx, barbershopId, { type: 'SubscriptionAmountSync', payload: ref });
      if (downgrade) {
        await this.outbox.publish(
          tx,
          barbershopId,
          { type: 'SubscriptionPlanChangeDue', payload: ref },
          { availableAt: paidThrough },
        );
      }
      this.logger.log({
        event: 'billing.plan.changed',
        barbershopId,
        kind: upgrade ? 'upgrade' : downgrade ? 'downgrade' : 'downgrade-undone',
      });
    });
    return this.detail();
  }

  /**
   * Cancela a cobrança recorrente no gateway (§12). A barbearia usa até o fim do período pago e
   * depois fica só para consulta; pode assinar de novo a qualquer momento.
   */
  async cancel(): Promise<SubscriptionDetail> {
    if (!this.gateway.provider) throw billingUnavailable();
    await this.db.run(async (tx, auth) => {
      const barbershopId = auth.barbershopId;
      await tx.$executeRaw`SELECT 1 FROM subscriptions WHERE barbershop_id = ${barbershopId}::uuid FOR UPDATE`;
      const subscription = await tx.subscription.findUnique({ where: { barbershopId } });
      if (!subscription) throw notFound('Assinatura');
      const { gatewayProvider, gatewaySubscriptionId } = subscription;
      if (!hasPaidSubscription(subscription) || !gatewayProvider || !gatewaySubscriptionId) {
        throw conflict('subscription-not-active', 'A barbearia não tem assinatura paga para cancelar.');
      }
      await tx.subscription.update({
        where: { barbershopId },
        data: {
          status: 'CANCELED',
          scheduledPlanId: null,
          scheduledPlanAt: null,
          scheduledAmountCents: null,
          scheduledAmountAt: null,
        },
      });
      await this.outbox.publish(tx, barbershopId, {
        type: 'GatewaySubscriptionCancelRequested',
        payload: { provider: gatewayProvider, gatewaySubscriptionId },
      });
      this.logger.log({ event: 'billing.subscription.canceled', barbershopId });
    });
    return this.detail();
  }

  /**
   * Notificação do gateway (rota pública). Só confere a assinatura, descarta repetidas e põe
   * a consulta na fila: responde rápido, e o estado vem do gateway, não da notificação.
   *
   * A notificação de cobrança não diz de qual assinatura ela é: uma consulta ao gateway (com
   * timeout) acha a assinatura e, por ela, a barbearia. Se o gateway falhar, a resposta é 502
   * e nada é gravado: o gateway reenvia a notificação.
   */
  async receiveNotification(notification: IncomingNotification): Promise<void> {
    const provider = this.gateway.provider;
    let notice;
    try {
      notice = this.gateway.parseNotification(notification);
    } catch (error) {
      if (!(error instanceof InvalidNotificationError)) throw error;
      this.logger.warn({ event: 'billing.webhook.rejected' });
      throw new UnauthorizedException('Assinatura da notificação inválida.');
    }
    if (!notice || !provider) return;

    let gatewaySubscriptionId = notice.resourceId;
    if (notice.kind === 'payment') {
      try {
        gatewaySubscriptionId = (await this.gateway.getPayment(notice.resourceId)).subscriptionId;
      } catch (error) {
        if (!(error instanceof PaymentGatewayError)) throw error;
        this.logger.warn({ event: 'billing.webhook.payment-lookup-failed', status: error.status });
        throw gatewayUnavailable();
      }
    }

    await this.prisma.withContext({}, async (tx) => {
      const fresh = await tx.billingWebhookEvent.createMany({
        data: [{ provider, eventId: notice.eventId }],
        skipDuplicates: true,
      });
      if (fresh.count === 0) return;
      const barbershopId = await this.tenantOf(tx, { provider, gatewaySubscriptionId });
      if (!barbershopId) return;
      await this.outbox.publish(
        tx,
        barbershopId,
        notice.kind === 'payment'
          ? { type: 'GatewayPaymentChanged', payload: { provider, paymentId: notice.resourceId } }
          : { type: 'GatewaySubscriptionChanged', payload: { provider, gatewaySubscriptionId } },
      );
    });
  }

  /**
   * Checkout do gateway simulado (só desenvolvimento e testes): aprova a assinatura e segue o
   * mesmo caminho de uma notificação. Devolve para onde o navegador volta.
   */
  async approveFakeCheckout(gatewaySubscriptionId: string): Promise<string> {
    const gateway = this.gateway;
    if (!(gateway instanceof FakePaymentGateway)) throw notFound('Checkout');
    try {
      gateway.setStatus(gatewaySubscriptionId, 'authorized');
    } catch {
      throw notFound('Checkout');
    }
    await this.prisma.withContext({}, (tx) =>
      this.enqueueSync(tx, { provider: gateway.provider, gatewaySubscriptionId }),
    );
    return gateway.inspect(gatewaySubscriptionId).backPath;
  }

  private async enqueueSync(tx: Tx, ref: GatewayRef): Promise<void> {
    const barbershopId = await this.tenantOf(tx, ref);
    if (!barbershopId) return;
    await this.outbox.publish(tx, barbershopId, { type: 'GatewaySubscriptionChanged', payload: { ...ref } });
  }

  /** Barbearia dona da assinatura no gateway (função SQL: a notificação chega sem tenant). */
  private async tenantOf(tx: Tx, ref: GatewayRef): Promise<string | null> {
    const [row] = await tx.$queryRaw<{ barbershop_id: string | null }[]>`
      SELECT billing_tenant_of(${ref.provider}, ${ref.gatewaySubscriptionId}) AS barbershop_id`;
    if (!row?.barbershop_id) {
      // Assinatura que não é nossa (outra aplicação na mesma conta, teste do painel do gateway).
      this.logger.warn({ event: 'billing.webhook.unknown-subscription', provider: ref.provider });
      return null;
    }
    return row.barbershop_id;
  }

  private async supersedePendingCheckouts(tx: Tx, barbershopId: string, keepId?: string): Promise<void> {
    const pending = await tx.subscriptionCheckout.findMany({
      where: { barbershopId, status: 'PENDING', ...(keepId ? { id: { not: keepId } } : {}) },
      select: { id: true, gatewayProvider: true, gatewaySubscriptionId: true },
    });
    if (pending.length === 0) return;
    await tx.subscriptionCheckout.updateMany({
      where: { barbershopId, id: { in: pending.map((checkout) => checkout.id) } },
      data: { status: 'CANCELED' },
    });
    for (const checkout of pending) {
      await this.outbox.publish(tx, barbershopId, {
        type: 'GatewaySubscriptionCancelRequested',
        payload: {
          provider: checkout.gatewayProvider,
          gatewaySubscriptionId: checkout.gatewaySubscriptionId,
        },
      });
    }
  }

  /** Consulta o gateway e aplica a situação: ativa o checkout aprovado ou atualiza a assinatura. */
  private async syncFromGateway(event: OutboxEventRef): Promise<void> {
    const ref = event.payload as unknown as GatewayRef;
    if (ref.provider !== this.gateway.provider) {
      this.logger.warn({ event: 'billing.sync.other-provider', provider: ref.provider });
      return;
    }
    const remote = await this.gateway.getSubscription(ref.gatewaySubscriptionId);
    const barbershopId = event.barbershopId;

    await this.prisma.withContext({ barbershopId }, async (tx) => {
      // Uma consulta por vez por barbearia: duas notificações seguidas não se atropelam.
      await tx.$executeRaw`SELECT 1 FROM subscriptions WHERE barbershop_id = ${barbershopId}::uuid FOR UPDATE`;
      const subscription = await tx.subscription.findUniqueOrThrow({ where: { barbershopId } });

      if (
        subscription.gatewayProvider === ref.provider &&
        subscription.gatewaySubscriptionId === ref.gatewaySubscriptionId
      ) {
        const status = STATUS_FROM_GATEWAY[remote.status];
        // Cancelada aqui é definitivo: uma notificação antiga ("autorizada") que chegue depois
        // do cancelamento não a reativa. Assinar de novo cria outra assinatura no gateway.
        if (status && status !== subscription.status && subscription.status !== 'CANCELED') {
          await tx.subscription.update({ where: { barbershopId }, data: { status } });
          this.logger.log({ event: 'billing.subscription.status', barbershopId, status });
        }
        return;
      }

      const checkout = await tx.subscriptionCheckout.findFirst({
        where: {
          barbershopId,
          gatewayProvider: ref.provider,
          gatewaySubscriptionId: ref.gatewaySubscriptionId,
        },
      });
      if (!checkout || remote.status === 'pending') return;
      if (remote.status !== 'authorized') {
        if (checkout.status === 'PENDING') {
          await tx.subscriptionCheckout.update({ where: { id: checkout.id }, data: { status: 'CANCELED' } });
        }
        return;
      }

      if (checkout.status !== 'PENDING' || hasPaidSubscription(subscription)) {
        // Aprovado depois de substituído (outra aba, checkout antigo): não pode cobrar em dobro.
        if (checkout.status === 'PENDING') {
          await tx.subscriptionCheckout.update({ where: { id: checkout.id }, data: { status: 'CANCELED' } });
        }
        if (checkout.status !== 'COMPLETED') {
          await this.outbox.publish(tx, barbershopId, {
            type: 'GatewaySubscriptionCancelRequested',
            payload: { ...ref },
          });
          this.logger.warn({ event: 'billing.checkout.superseded', barbershopId, checkoutId: checkout.id });
        }
        return;
      }

      await tx.subscription.update({
        where: { barbershopId },
        data: {
          planId: checkout.planId,
          interval: checkout.interval,
          gatewayProvider: checkout.gatewayProvider,
          gatewaySubscriptionId: checkout.gatewaySubscriptionId,
          amountCents: checkout.amountCents,
          status: 'ACTIVE',
          // A primeira cobrança acontece na autorização: o período pago começa agora. Assinar
          // durante o teste grátis encerra o teste (§12).
          paidThrough: addInterval(new Date(), checkout.interval),
          trialEndsAt: null,
          scheduledAmountCents: null,
          scheduledAmountAt: null,
          scheduledPlanId: null,
          scheduledPlanAt: null,
        },
      });
      await tx.subscriptionCheckout.update({ where: { id: checkout.id }, data: { status: 'COMPLETED' } });
      await this.supersedePendingCheckouts(tx, barbershopId, checkout.id);
      this.logger.log({ event: 'billing.subscription.activated', barbershopId, checkoutId: checkout.id });

      // O preço mudou entre o checkout e a aprovação: o reajuste vale para esta também (§12).
      const price = await tx.planPrice.findUnique({
        where: { planId_interval: { planId: checkout.planId, interval: checkout.interval } },
        select: { amountCents: true },
      });
      if (price && price.amountCents !== checkout.amountCents) {
        const effectiveAt = priceChangeEffectiveAt();
        await tx.subscription.update({
          where: { barbershopId },
          data: { scheduledAmountCents: price.amountCents, scheduledAmountAt: effectiveAt },
        });
        await publishPriceChange(this.outbox, tx, barbershopId, subscription.id, effectiveAt);
      }
    });
  }

  private async cancelAtGateway(event: OutboxEventRef): Promise<void> {
    const ref = event.payload as unknown as GatewayRef;
    if (ref.provider !== this.gateway.provider) {
      this.logger.warn({ event: 'billing.cancel.other-provider', provider: ref.provider });
      return;
    }
    await this.gateway.cancelSubscription(ref.gatewaySubscriptionId);
  }

  /** E-mail de aviso do reajuste para quem cuida da assinatura (dono). */
  private async sendPriceNotice(event: OutboxEventRef): Promise<void> {
    const subscriptionId = String(event.payload['subscriptionId']);
    const barbershopId = event.barbershopId;
    const notice = await this.prisma.withContext({ barbershopId }, async (tx) => {
      const subscription = await tx.subscription.findFirst({
        where: { id: subscriptionId, barbershopId },
        include: { plan: { select: { name: true } } },
      });
      const { amountCents, scheduledAmountCents, scheduledAmountAt, interval } = subscription ?? {};
      // Reajuste desfeito antes do envio (preço voltou ao valor pago): nada a avisar.
      if (!subscription || !amountCents || !scheduledAmountCents || !scheduledAmountAt || !interval)
        return null;
      const settings = await this.barbershops.settings(tx, barbershopId);
      const recipients = await this.staff.contactsWithPermission(tx, barbershopId, 'subscription:manage');
      const when = new Intl.DateTimeFormat('pt-BR', {
        timeZone: settings.timezone,
        dateStyle: 'long',
      }).format(scheduledAmountAt);
      return {
        recipients,
        lines: [
          `O valor da assinatura da ${settings.name} no plano ${subscription.plan.name} (${INTERVAL_LABELS[interval]}) vai mudar de ${formatMoney(amountCents)} para ${formatMoney(scheduledAmountCents)}.`,
          `O novo valor vale a partir da primeira cobrança depois de ${when}. Até lá, nada muda.`,
          '',
          `Os detalhes estão em ${this.publicUrl}/painel/configuracoes#plano.`,
        ],
      };
    });
    if (!notice) return;

    for (const [index, recipient] of notice.recipients.entries()) {
      await this.mail.send(
        {
          to: recipient.email,
          subject: 'Reajuste da sua assinatura do TaNaRegua',
          text: [`Olá, ${recipient.name}.`, '', ...notice.lines, '', 'Equipe TaNaRegua'].join('\n'),
        },
        `${event.id}:${index}`,
      );
    }
  }

  /** Na data do reajuste, repassa o novo valor ao gateway e passa a mostrá-lo como atual. */
  private async applyPriceChange(event: OutboxEventRef): Promise<void> {
    const subscriptionId = String(event.payload['subscriptionId']);
    const barbershopId = event.barbershopId;
    const target = await this.prisma.withContext({ barbershopId }, async (tx) => {
      const subscription = await tx.subscription.findFirst({ where: { id: subscriptionId, barbershopId } });
      const { scheduledAmountCents, scheduledAmountAt, gatewayProvider, gatewaySubscriptionId } =
        subscription ?? {};
      // Substituído por outro reajuste (com data posterior) ou desfeito: o evento dele cuida.
      if (!scheduledAmountCents || !scheduledAmountAt || scheduledAmountAt > new Date()) return null;
      if (!gatewayProvider || !gatewaySubscriptionId || subscription?.status === 'CANCELED') return null;
      return { gatewayProvider, gatewaySubscriptionId, amountCents: scheduledAmountCents };
    });
    if (!target) return;
    if (target.gatewayProvider !== this.gateway.provider) {
      this.logger.warn({ event: 'billing.price.other-provider', provider: target.gatewayProvider });
      return;
    }

    await this.gateway.updateSubscriptionAmount(target.gatewaySubscriptionId, target.amountCents);
    await this.prisma.withContext({ barbershopId }, (tx) =>
      tx.subscription.updateMany({
        where: {
          id: subscriptionId,
          barbershopId,
          gatewaySubscriptionId: target.gatewaySubscriptionId,
          scheduledAmountCents: target.amountCents,
        },
        data: { amountCents: target.amountCents, scheduledAmountCents: null, scheduledAmountAt: null },
      }),
    );
    this.logger.log({ event: 'billing.price.applied', barbershopId });
  }

  /** Cobrança de ciclo aprovada: o período pago passa a ir até um ciclo depois dela. */
  private async syncPayment(event: OutboxEventRef): Promise<void> {
    const { provider, paymentId } = event.payload as { provider: string; paymentId: string };
    if (provider !== this.gateway.provider) {
      this.logger.warn({ event: 'billing.payment.other-provider', provider });
      return;
    }
    const payment = await this.gateway.getPayment(paymentId);
    const barbershopId = event.barbershopId;
    if (payment.status !== 'approved') {
      // Recusada ou ainda em processamento: o período pago não muda e, passado o fim dele,
      // corre a carência (o gateway tenta cobrar de novo nesse meio tempo).
      this.logger.log({ event: 'billing.payment.not-approved', barbershopId, status: payment.status });
      return;
    }
    await this.prisma.withContext({ barbershopId }, async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM subscriptions WHERE barbershop_id = ${barbershopId}::uuid FOR UPDATE`;
      const subscription = await tx.subscription.findUniqueOrThrow({ where: { barbershopId } });
      // Cobrança de uma assinatura antiga (substituída ou de antes de assinar de novo): ignora.
      if (
        subscription.gatewayProvider !== provider ||
        subscription.gatewaySubscriptionId !== payment.subscriptionId ||
        !subscription.interval
      ) {
        return;
      }
      const through = addInterval(payment.chargedAt, subscription.interval);
      if (subscription.paidThrough && subscription.paidThrough >= through) return;
      await tx.subscription.update({ where: { barbershopId }, data: { paidThrough: through } });
      this.logger.log({ event: 'billing.payment.approved', barbershopId });
    });
  }

  /** Repassa ao gateway o valor por ciclo atual (troca de plano). Lê o valor na hora: idempotente. */
  private async pushAmount(event: OutboxEventRef): Promise<void> {
    const subscriptionId = String(event.payload['subscriptionId']);
    const barbershopId = event.barbershopId;
    const target = await this.prisma.withContext({ barbershopId }, (tx) =>
      tx.subscription.findFirst({ where: { id: subscriptionId, barbershopId } }),
    );
    const { gatewayProvider, gatewaySubscriptionId, amountCents, status } = target ?? {};
    if (!gatewayProvider || !gatewaySubscriptionId || !amountCents || status === 'CANCELED') return;
    if (gatewayProvider !== this.gateway.provider) {
      this.logger.warn({ event: 'billing.amount.other-provider', provider: gatewayProvider });
      return;
    }
    await this.gateway.updateSubscriptionAmount(gatewaySubscriptionId, amountCents);
  }

  /** Fim do período pago com downgrade agendado: o plano novo passa a valer. */
  private async applyPlanChange(event: OutboxEventRef): Promise<void> {
    const subscriptionId = String(event.payload['subscriptionId']);
    const barbershopId = event.barbershopId;
    await this.prisma.withContext({ barbershopId }, async (tx) => {
      const applied = await tx.$executeRaw`
        UPDATE subscriptions
           SET plan_id = scheduled_plan_id, scheduled_plan_id = NULL, scheduled_plan_at = NULL, updated_at = now()
         WHERE id = ${subscriptionId}::uuid AND barbershop_id = ${barbershopId}::uuid
           AND scheduled_plan_id IS NOT NULL AND scheduled_plan_at <= now()`;
      // Desfeito, cancelado ou reagendado: nada a fazer (o evento do novo agendamento cuida).
      if (applied > 0) this.logger.log({ event: 'billing.plan.downgraded', barbershopId });
    });
  }
}
