import { Inject, Injectable } from '@nestjs/common';
import { conflict, notFound } from '../../common/http/domain-error.js';
import { TenantDb } from '../../common/tenancy/tenant-db.service.js';
import type { BillingInterval } from '../../generated/prisma/client.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { OutboxService } from '../notifications/outbox.service.js';
import { accessOf, trialEnd, type Access } from './access.js';
import { grantedFeatures, isFeature, type Feature } from './features.js';
import type { PlanSummary, SubscriptionSummary } from './subscriptions.responses.js';
import type { SetPlanPricesInput } from './subscriptions.schemas.js';

const PLAN_SELECT = {
  key: true,
  name: true,
  features: true,
  prices: { select: { interval: true, amountCents: true } },
} as const;

type PlanRow = {
  key: string;
  name: string;
  features: string[];
  prices: { interval: BillingInterval; amountCents: number }[];
};

const priceOf = (plan: PlanRow, interval: BillingInterval) =>
  plan.prices.find((price) => price.interval === interval)?.amountCents ?? null;

const toPlanSummary = (plan: PlanRow): PlanSummary => ({
  key: plan.key,
  name: plan.name,
  features: plan.features.filter(isFeature),
  prices: { monthlyCents: priceOf(plan, 'MONTHLY'), yearlyCents: priceOf(plan, 'YEARLY') },
});

const readPlans = async (tx: Tx): Promise<PlanSummary[]> =>
  (await tx.plan.findMany({ select: PLAN_SELECT, orderBy: { position: 'asc' } })).map(toPlanSummary);

/** Antecedência do aviso de reajuste ao dono, por e-mail (business-rules §12). */
export const PRICE_CHANGE_NOTICE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export const priceChangeEffectiveAt = (from: Date = new Date()): Date =>
  new Date(from.getTime() + PRICE_CHANGE_NOTICE_DAYS * DAY_MS);

/**
 * Publica o aviso por e-mail (agora) e o repasse ao gateway (na data do reajuste). O repasse
 * confere de novo o reajuste agendado: se outro o substituiu, não faz nada.
 */
export async function publishPriceChange(
  outbox: OutboxService,
  tx: Tx,
  barbershopId: string,
  subscriptionId: string,
  effectiveAt: Date,
): Promise<void> {
  await outbox.publish(tx, barbershopId, {
    type: 'SubscriptionPriceChangeNotice',
    payload: { subscriptionId },
  });
  await outbox.publish(
    tx,
    barbershopId,
    { type: 'SubscriptionPriceChangeDue', payload: { subscriptionId } },
    { availableAt: effectiveAt },
  );
}

const INTERVAL_LABELS: Record<BillingInterval, string> = { MONTHLY: 'mensal', YEARLY: 'anual' };

@Injectable()
export class SubscriptionsService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  /** Barbearia recém-criada: teste grátis de 14 dias no plano do teste (chamado pelo cadastro, §12). */
  async startTrial(tx: Tx, barbershopId: string): Promise<void> {
    const plan = await tx.plan.findFirst({ where: { isDefault: true }, select: { id: true } });
    if (!plan) throw new Error('Nenhum plano de teste cadastrado');
    await tx.subscription.create({
      data: { barbershopId, planId: plan.id, status: 'TRIALING', trialEndsAt: trialEnd() },
    });
  }

  /** Resumo para o perfil da sessão. `null` só se a barbearia ficou sem assinatura (nada liberado). */
  async summary(tx: Tx, barbershopId: string): Promise<SubscriptionSummary | null> {
    const subscription = await tx.subscription.findUnique({
      where: { barbershopId },
      select: {
        status: true,
        trialEndsAt: true,
        paidThrough: true,
        gatewaySubscriptionId: true,
        plan: { select: { key: true, name: true, features: true } },
      },
    });
    if (!subscription) return null;
    const { status, plan } = subscription;
    return {
      plan: { key: plan.key, name: plan.name },
      status,
      features: grantedFeatures(plan.features),
      access: accessOf(subscription),
    };
  }

  /** Situação de uso da barbearia da requisição (o `ReadOnlyGuard` confere a cada escrita). */
  currentAccess(): Promise<Access> {
    return this.db.run(
      async (tx, auth) =>
        (await this.summary(tx, auth.barbershopId))?.access ?? { state: 'read-only', until: null },
    );
  }

  /** Recursos liberados para a barbearia da requisição (lidos a cada checagem: o plano muda sem o token saber). */
  currentFeatures(): Promise<Feature[]> {
    return this.db.run(async (tx, auth) => (await this.summary(tx, auth.barbershopId))?.features ?? []);
  }

  /** Catálogo para o painel da barbearia: planos, recursos e preços. */
  listPlans(): Promise<PlanSummary[]> {
    return this.db.run(readPlans);
  }

  /** Mesmo catálogo, para a administração da plataforma (sem tenant). */
  listPlansAsPlatform(adminId: string): Promise<PlanSummary[]> {
    return this.prisma.withContext({ platformAdminId: adminId }, readPlans);
  }

  /**
   * Define os preços de um plano. Só a administração da plataforma chama: a transação leva o
   * administrador no contexto, sem o qual o RLS de `plan_prices` recusa a escrita.
   *
   * Mudar o preço reajusta todas as assinaturas pagas do plano naquele ciclo (§12): o dono de
   * cada uma é avisado por e-mail e o novo valor passa ao gateway 30 dias depois, valendo a
   * partir da cobrança seguinte. Tirar o ciclo de venda é recusado enquanto houver assinante.
   */
  setPlanPrices(adminId: string, planKey: string, input: SetPlanPricesInput): Promise<PlanSummary> {
    return this.prisma.withContext({ platformAdminId: adminId }, async (tx) => {
      const plan = await tx.plan.findUnique({ where: { key: planKey }, select: { id: true } });
      if (!plan) throw notFound('Plano');
      const prices: [BillingInterval, number | null][] = [
        ['MONTHLY', input.monthlyCents],
        ['YEARLY', input.yearlyCents],
      ];
      for (const [interval, amountCents] of prices) {
        const where = { planId_interval: { planId: plan.id, interval } };
        const current = await tx.planPrice.findUnique({ where, select: { amountCents: true } });
        if (amountCents === null) {
          if (!current) continue;
          await this.assertCycleWithoutSubscribers(tx, plan.id, interval);
          await tx.planPrice.delete({ where });
        } else {
          await tx.planPrice.upsert({
            where,
            create: { planId: plan.id, interval, amountCents, updatedById: adminId },
            update: { amountCents, updatedById: adminId },
          });
          if (current?.amountCents !== amountCents) {
            await this.schedulePriceChange(tx, plan.id, interval, amountCents);
          }
        }
      }
      return toPlanSummary(await tx.plan.findUniqueOrThrow({ where: { id: plan.id }, select: PLAN_SELECT }));
    });
  }

  private async assertCycleWithoutSubscribers(tx: Tx, planId: string, interval: BillingInterval) {
    const [row] = await tx.$queryRaw<{ count: number }[]>`
      SELECT plan_cycle_subscriber_count(${planId}::uuid, ${interval}::"BillingInterval") AS count`;
    const count = row?.count ?? 0;
    if (count > 0) {
      throw conflict(
        'plan-price-in-use',
        `O ciclo ${INTERVAL_LABELS[interval]} tem ${count} ${count === 1 ? 'assinatura ativa' : 'assinaturas ativas'} e não pode sair de venda.`,
      );
    }
  }

  /** Agenda o reajuste em todas as barbearias do plano e ciclo (função SQL da plataforma). */
  private async schedulePriceChange(tx: Tx, planId: string, interval: BillingInterval, amountCents: number) {
    const effectiveAt = priceChangeEffectiveAt();
    const scheduled = await tx.$queryRaw<{ barbershop_id: string; subscription_id: string }[]>`
      SELECT barbershop_id, subscription_id
        FROM schedule_plan_price_change(${planId}::uuid, ${interval}::"BillingInterval", ${amountCents}::int, ${effectiveAt}::timestamptz)`;
    for (const row of scheduled) {
      await publishPriceChange(this.outbox, tx, row.barbershop_id, row.subscription_id, effectiveAt);
    }
  }

  /**
   * Cortesia: plano ativo sem cobrança e sem prazo. Nunca chamado por rota: só pelo seed de
   * desenvolvimento e pelos testes (em produção, só o suporte, direto no banco). Recusado numa
   * assinatura paga, que só muda pelo gateway. Não apaga dados.
   */
  grantPlan(barbershopId: string, planKey: string): Promise<void> {
    return this.db.runAs(barbershopId, async (tx) => {
      const plan = await tx.plan.findUniqueOrThrow({ where: { key: planKey }, select: { id: true } });
      const current = await tx.subscription.findUniqueOrThrow({ where: { barbershopId } });
      if (current.gatewaySubscriptionId) throw new Error('Assinatura paga: o plano muda pelo gateway');
      await tx.subscription.update({
        where: { barbershopId },
        data: { planId: plan.id, status: 'ACTIVE', trialEndsAt: null },
      });
    });
  }
}
