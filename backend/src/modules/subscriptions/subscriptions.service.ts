import { Inject, Injectable } from '@nestjs/common';
import { notFound } from '../../common/http/domain-error.js';
import { TenantDb } from '../../common/tenancy/tenant-db.service.js';
import type { BillingInterval } from '../../generated/prisma/client.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
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

@Injectable()
export class SubscriptionsService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  /** Assinatura de uma barbearia recém-criada, no plano padrão (chamado pelo cadastro). */
  async startDefault(tx: Tx, barbershopId: string): Promise<void> {
    const plan = await tx.plan.findFirst({ where: { isDefault: true }, select: { id: true } });
    if (!plan) throw new Error('Nenhum plano padrão cadastrado');
    await tx.subscription.create({ data: { barbershopId, planId: plan.id, status: 'ACTIVE' } });
  }

  /** Resumo para o perfil da sessão. `null` só se a barbearia ficou sem assinatura (nada liberado). */
  async summary(tx: Tx, barbershopId: string): Promise<SubscriptionSummary | null> {
    const subscription = await tx.subscription.findUnique({
      where: { barbershopId },
      select: { status: true, plan: { select: { key: true, name: true, features: true } } },
    });
    if (!subscription) return null;
    const { status, plan } = subscription;
    return {
      plan: { key: plan.key, name: plan.name },
      status,
      features: grantedFeatures(status, plan.features),
    };
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
   * administrador no contexto, sem o qual o RLS de `plan_prices` recusa a escrita. Mudar o
   * preço reajusta todas as assinaturas do plano naquele ciclo, a partir da próxima cobrança
   * (com a cobrança recorrente, o novo valor é repassado ao gateway).
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
        if (amountCents === null) {
          await tx.planPrice.deleteMany({ where: { planId: plan.id, interval } });
        } else {
          await tx.planPrice.upsert({
            where: { planId_interval: { planId: plan.id, interval } },
            create: { planId: plan.id, interval, amountCents, updatedById: adminId },
            update: { amountCents, updatedById: adminId },
          });
        }
      }
      return toPlanSummary(await tx.plan.findUniqueOrThrow({ where: { id: plan.id }, select: PLAN_SELECT }));
    });
  }

  /**
   * Troca o plano da barbearia. Nunca chamado por rota da barbearia: só pela confirmação do
   * gateway de pagamento (webhook verificado, próxima entrega) e pelo seed. Não apaga dados.
   */
  changePlan(barbershopId: string, planKey: string): Promise<void> {
    return this.db.runAs(barbershopId, async (tx) => {
      const plan = await tx.plan.findUniqueOrThrow({ where: { key: planKey }, select: { id: true } });
      await tx.subscription.update({ where: { barbershopId }, data: { planId: plan.id } });
    });
  }
}
