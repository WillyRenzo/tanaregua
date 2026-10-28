import { Inject, Injectable } from '@nestjs/common';
import { TenantDb } from '../../common/tenancy/tenant-db.service.js';
import type { Tx } from '../../prisma/prisma.service.js';
import { grantedFeatures, isFeature, type Feature } from './features.js';
import type { PlanSummary, SubscriptionSummary } from './subscriptions.responses.js';

@Injectable()
export class SubscriptionsService {
  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

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

  listPlans(): Promise<PlanSummary[]> {
    return this.db.run(async (tx) => {
      const plans = await tx.plan.findMany({
        select: { key: true, name: true, features: true },
        orderBy: { position: 'asc' },
      });
      return plans.map((plan) => ({ ...plan, features: plan.features.filter(isFeature) }));
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
