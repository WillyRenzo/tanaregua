import { Inject, Injectable } from '@nestjs/common';
import { notFound, unprocessable } from '../../common/http/domain-error.js';
import { TenantDb } from '../../common/tenancy/tenant-db.service.js';
import type { Tx } from '../../prisma/prisma.service.js';
import type { ServiceView } from '../registry.responses.js';
import { ProductsService } from '../products/products.service.js';
import { StaffService } from '../staff/staff.service.js';
import type {
  CreateServiceInput,
  ListServicesQuery,
  UpdateServiceInput,
  UpsertCommissionRuleInput,
} from './catalog.schemas.js';
import type { CommissionRuleTerms } from './commission-policy.js';

const serviceSelect = {
  id: true,
  name: true,
  description: true,
  priceCents: true,
  durationMinutes: true,
  active: true,
} as const;

export type { ServiceView };

const ruleSelect = {
  id: true,
  membershipId: true,
  serviceId: true,
  productId: true,
  type: true,
  value: true,
} as const;

@Injectable()
export class CatalogService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(StaffService) private readonly staff: StaffService,
    @Inject(ProductsService) private readonly products: ProductsService,
  ) {}

  listServices(query: ListServicesQuery): Promise<ServiceView[]> {
    return this.db.run((tx, auth) => this.activeServices(tx, auth.barbershopId, query.includeInactive));
  }

  /** Também usado pelas rotas públicas de agendamento. */
  activeServices(tx: Tx, barbershopId: string, includeInactive = false): Promise<ServiceView[]> {
    return tx.service.findMany({
      where: { barbershopId, ...(includeInactive ? {} : { active: true }) },
      select: serviceSelect,
      orderBy: { name: 'asc' },
    });
  }

  createService(input: CreateServiceInput): Promise<ServiceView> {
    return this.db.run((tx, auth) =>
      tx.service.create({ data: { ...input, barbershopId: auth.barbershopId }, select: serviceSelect }),
    );
  }

  updateService(serviceId: string, input: UpdateServiceInput): Promise<ServiceView> {
    return this.db.run(async (tx, auth) => {
      await this.findService(tx, auth.barbershopId, serviceId);
      return tx.service.update({ where: { id: serviceId }, data: input, select: serviceSelect });
    });
  }

  /**
   * Serviços pedidos num agendamento/comanda, na ordem pedida. Lança 422 se algum
   * não existir nesta barbearia ou estiver inativo.
   */
  async servicesForBooking(tx: Tx, barbershopId: string, serviceIds: string[]): Promise<ServiceView[]> {
    const rows = await tx.service.findMany({
      where: { barbershopId, id: { in: serviceIds }, active: true },
      select: serviceSelect,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return serviceIds.map((id) => {
      const service = byId.get(id);
      if (!service) throw unprocessable('invalid-service', 'Serviço inexistente ou inativo.');
      return service;
    });
  }

  /** Nome e preço atual de serviços (inclusive inativos), para pacotes calcularem o valor da sessão. */
  async servicePrices(tx: Tx, barbershopId: string, serviceIds: string[]) {
    const rows = await tx.service.findMany({
      where: { barbershopId, id: { in: serviceIds } },
      select: { id: true, name: true, priceCents: true },
    });
    return new Map(rows.map((row) => [row.id, row]));
  }

  listCommissionRules() {
    return this.db.run((tx, auth) => this.commissionRules(tx, auth.barbershopId));
  }

  /** Regras vigentes, consumidas pelo fechamento de comanda. */
  commissionRules(tx: Tx, barbershopId: string): Promise<(CommissionRuleTerms & { id: string })[]> {
    return tx.commissionRule.findMany({
      where: { barbershopId },
      select: ruleSelect,
      orderBy: { createdAt: 'asc' },
    });
  }

  upsertCommissionRule(input: UpsertCommissionRuleInput) {
    return this.db.run(async (tx, auth) => {
      if (input.membershipId) {
        await this.staff.assertStaffMember(tx, auth.barbershopId, input.membershipId);
      }
      if (input.serviceId) {
        await this.findService(tx, auth.barbershopId, input.serviceId);
      }
      if (input.productId) {
        await this.products.assertExists(tx, auth.barbershopId, input.productId);
      }

      // NULL significa "qualquer"; o Prisma não faz upsert por unique com NULL, então buscamos antes.
      const existing = await tx.commissionRule.findFirst({
        where: {
          barbershopId: auth.barbershopId,
          membershipId: input.membershipId,
          serviceId: input.serviceId,
          productId: input.productId,
        },
        select: { id: true },
      });
      const data = { type: input.type, value: input.value };
      return existing
        ? tx.commissionRule.update({ where: { id: existing.id }, data, select: ruleSelect })
        : tx.commissionRule.create({
            data: {
              ...data,
              barbershopId: auth.barbershopId,
              membershipId: input.membershipId,
              serviceId: input.serviceId,
              productId: input.productId,
            },
            select: ruleSelect,
          });
    });
  }

  deleteCommissionRule(ruleId: string): Promise<void> {
    return this.db.run(async (tx, auth) => {
      const deleted = await tx.commissionRule.deleteMany({
        where: { id: ruleId, barbershopId: auth.barbershopId },
      });
      if (deleted.count === 0) throw notFound('Regra de comissão');
    });
  }

  private async findService(tx: Tx, barbershopId: string, serviceId: string) {
    const service = await tx.service.findFirst({
      where: { id: serviceId, barbershopId },
      select: { id: true },
    });
    if (!service) throw notFound('Serviço');
    return service;
  }
}
