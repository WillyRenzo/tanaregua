import { Inject, Injectable } from '@nestjs/common';
import { notFound, unprocessable } from '../../common/http/domain-error.js';
import { TenantDb } from '../../common/tenancy/tenant-db.service.js';
import { Clock } from '../../common/time/clock.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { Tx } from '../../prisma/prisma.service.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { FinanceService } from '../finance/finance.service.js';
import type { ClientPackageView, MyPackageView, ServicePackageView } from './packages.responses.js';
import type {
  CreatePackageInput,
  ListClientPackagesQuery,
  ListPackagesQuery,
  RefundPackageInput,
  UpdatePackageInput,
} from './packages.schemas.js';

const packageInclude = {
  items: { include: { service: { select: { name: true } } }, orderBy: { serviceId: 'asc' } },
} as const satisfies Prisma.ServicePackageInclude;

const clientPackageInclude = {
  client: { select: { id: true, name: true } },
  balances: { include: { service: { select: { name: true } } }, orderBy: { serviceId: 'asc' } },
} as const satisfies Prisma.ClientPackageInclude;

type PackageRow = Prisma.ServicePackageGetPayload<{ include: typeof packageInclude }>;
type ClientPackageRow = Prisma.ClientPackageGetPayload<{ include: typeof clientPackageInclude }>;

/** Serviço da comanda pago com sessão de pacote. */
export interface PackageUse {
  orderItemId: string;
  clientPackageId: string;
  serviceId: string;
  quantity: number;
}

/** O que a comanda precisa saber de cada uso para a comissão (business-rules §4 e §6). */
export interface PackageUseTerms {
  sessionValueCents: number;
  commissionOnSessions: boolean;
}

/**
 * Pacotes de serviços (business-rules §6). O saldo de sessões só muda por movimentação
 * (compra, uso, devolução por estorno), aplicada por trigger no banco, que também impede
 * saldo negativo. As checagens aqui existem para dar mensagens claras.
 */
@Injectable()
export class PackagesService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(FinanceService) private readonly finance: FinanceService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  // ───────────── Pacotes à venda ─────────────

  list(query: ListPackagesQuery): Promise<ServicePackageView[]> {
    return this.db.run(async (tx, auth) => {
      const rows = await tx.servicePackage.findMany({
        where: { barbershopId: auth.barbershopId, ...(query.includeInactive ? {} : { active: true }) },
        include: packageInclude,
        orderBy: { name: 'asc' },
      });
      return rows.map(toPackageView);
    });
  }

  create(input: CreatePackageInput): Promise<ServicePackageView> {
    return this.db.run(async (tx, auth) => {
      const { items, ...data } = input;
      await this.assertServices(tx, auth.barbershopId, items);
      const created = await tx.servicePackage.create({ data: { ...data, barbershopId: auth.barbershopId } });
      await tx.servicePackageItem.createMany({
        data: items.map((item) => ({ ...item, barbershopId: auth.barbershopId, packageId: created.id })),
      });
      return this.packageView(tx, auth.barbershopId, created.id);
    });
  }

  update(packageId: string, input: UpdatePackageInput): Promise<ServicePackageView> {
    return this.db.run(async (tx, auth) => {
      await this.findPackage(tx, auth.barbershopId, packageId);
      const { items, ...data } = input;
      await tx.servicePackage.update({ where: { id: packageId }, data });
      if (items) {
        await this.assertServices(tx, auth.barbershopId, items);
        await tx.servicePackageItem.deleteMany({ where: { barbershopId: auth.barbershopId, packageId } });
        await tx.servicePackageItem.createMany({
          data: items.map((item) => ({ ...item, barbershopId: auth.barbershopId, packageId })),
        });
      }
      return this.packageView(tx, auth.barbershopId, packageId);
    });
  }

  // ───────────── Pacotes vendidos ─────────────

  listSold(query: ListClientPackagesQuery): Promise<ClientPackageView[]> {
    return this.db.run(async (tx, auth) => {
      const now = this.clock.now();
      const rows = await tx.clientPackage.findMany({
        where: {
          barbershopId: auth.barbershopId,
          ...(query.clientId ? { clientId: query.clientId } : {}),
          ...statusFilter(query.status, now),
        },
        include: clientPackageInclude,
        orderBy: [{ purchasedAt: 'desc' }, { id: 'desc' }],
        take: 100,
      });
      return rows.map((row) => toClientPackageView(row, now));
    });
  }

  /** Pacotes do cliente final (área "Meus agendamentos"): só consulta. */
  async listForClient(tx: Tx, barbershopId: string, clientId: string): Promise<MyPackageView[]> {
    const now = this.clock.now();
    const rows = await tx.clientPackage.findMany({
      where: { barbershopId, clientId, status: 'ACTIVE' },
      include: clientPackageInclude,
      orderBy: { expiresAt: 'asc' },
    });
    return rows.map((row) => {
      const { id, name, purchasedAt, expiresAt, status, balances } = toClientPackageView(row, now);
      return { id, name, purchasedAt, expiresAt, status, balances };
    });
  }

  /**
   * Reembolso (business-rules §6): só pacote ativo e dentro da validade (todo pacote é pago
   * antecipadamente, na comanda). Valor definido pela barbearia, até o que foi pago; vira
   * saída no caixa e encerra o pacote, sem apagar a venda nem as comissões já pagas.
   */
  refund(clientPackageId: string, input: RefundPackageInput): Promise<ClientPackageView> {
    return this.db.run(async (tx, auth) => {
      const now = this.clock.now();
      const current = await this.lockClientPackage(tx, auth.barbershopId, clientPackageId);
      if (current.status !== 'ACTIVE') {
        throw unprocessable('package-not-refundable', 'Este pacote já foi reembolsado ou cancelado.');
      }
      if (current.expiresAt <= now) {
        throw unprocessable('package-expired', 'Pacote vencido não pode ser reembolsado.');
      }
      if (input.amountCents > current.pricePaidCents) {
        throw unprocessable('refund-too-high', 'O reembolso não pode passar do valor pago pelo pacote.');
      }
      await tx.clientPackage.update({
        where: { id: clientPackageId },
        data: {
          status: 'REFUNDED',
          refundedAt: now,
          refundCents: input.amountCents,
          refundReason: input.reason,
        },
      });
      await this.finance.recordRefund(tx, auth.barbershopId, {
        orderId: current.orderId,
        method: input.paymentMethod,
        amountCents: input.amountCents,
        occurredAt: now,
      });
      return toClientPackageView(await this.findClientPackage(tx, auth.barbershopId, clientPackageId), now);
    });
  }

  // ───────────── Para a comanda, na transação dela ─────────────

  /** Pacote ativo à venda. 422 se não existir aqui ou estiver inativo. */
  async packageForSale(tx: Tx, barbershopId: string, packageId: string) {
    const row = await tx.servicePackage.findFirst({
      where: { id: packageId, barbershopId, active: true },
      select: { id: true, name: true, priceCents: true },
    });
    if (!row) throw unprocessable('invalid-package', 'Pacote inexistente ou inativo.');
    return row;
  }

  /**
   * Confere se o pacote do cliente cobre o serviço (ao marcar o item na comanda). O
   * fechamento confere de novo, com o saldo travado: esta checagem é para o aviso rápido.
   */
  async assertUsable(
    tx: Tx,
    barbershopId: string,
    use: { clientPackageId: string; clientId: string; serviceId: string; quantity: number; at: Date },
  ): Promise<void> {
    const row = await tx.clientPackage.findFirst({
      where: { id: use.clientPackageId, barbershopId },
      include: { balances: { where: { serviceId: use.serviceId } } },
    });
    if (!row || row.clientId !== use.clientId) throw notFound('Pacote');
    assertActive(row, use.at);
    const balance = row.balances[0];
    if (!balance) throw unprocessable('package-service-mismatch', 'Este pacote não inclui este serviço.');
    if (balance.remaining < use.quantity) throw noSessionsLeft(row.name, balance.remaining);
  }

  /** Valor da sessão de cada (pacote, serviço), para a comissão prevista da comanda aberta. */
  async sessionTerms(
    tx: Tx,
    barbershopId: string,
    uses: { clientPackageId: string; serviceId: string }[],
  ): Promise<Map<string, PackageUseTerms>> {
    if (uses.length === 0) return new Map();
    const rows = await tx.clientPackageBalance.findMany({
      where: { barbershopId, clientPackageId: { in: uses.map((use) => use.clientPackageId) } },
      include: { clientPackage: { select: { commissionOnSessions: true } } },
    });
    return new Map(
      rows.map((row) => [
        packageTermsKey(row.clientPackageId, row.serviceId),
        {
          sessionValueCents: row.sessionValueCents,
          commissionOnSessions: row.clientPackage.commissionOnSessions,
        },
      ]),
    );
  }

  /**
   * Fechamento da comanda: consome as sessões. Trava os saldos (ordem fixa, sem deadlock
   * entre fechamentos), confere cliente, validade e saldo e lança os usos.
   */
  async recordUses(
    tx: Tx,
    barbershopId: string,
    sale: {
      orderId: string;
      clientId: string | null;
      uses: PackageUse[];
      authorUserId: string;
      occurredAt: Date;
    },
  ): Promise<Map<string, PackageUseTerms>> {
    const terms = new Map<string, PackageUseTerms>();
    if (sale.uses.length === 0) return terms;

    const totals = new Map<string, number>();
    for (const use of sale.uses) {
      const key = packageTermsKey(use.clientPackageId, use.serviceId);
      totals.set(key, (totals.get(key) ?? 0) + use.quantity);
    }
    const ids = [...new Set(sale.uses.map((use) => use.clientPackageId))].sort();
    // Trava os pacotes (não os saldos: a aplicação não tem UPDATE neles, só o trigger), o
    // que serializa dois fechamentos usando o mesmo pacote; o saldo lido depois é o atual.
    await tx.$queryRaw`
      SELECT id FROM client_packages
       WHERE barbershop_id = ${barbershopId}::uuid AND id = ANY(${ids}::uuid[])
       ORDER BY id
       FOR UPDATE`;
    const packages = await tx.clientPackage.findMany({ where: { barbershopId, id: { in: ids } } });
    const balances = await tx.clientPackageBalance.findMany({
      where: { barbershopId, clientPackageId: { in: ids } },
    });

    for (const [key, quantity] of totals) {
      const [clientPackageId, serviceId] = key.split('|') as [string, string];
      const owner = packages.find((row) => row.id === clientPackageId);
      if (!owner || owner.clientId !== sale.clientId) throw notFound('Pacote');
      assertActive(owner, sale.occurredAt);
      const balance = balances.find(
        (row) => row.clientPackageId === clientPackageId && row.serviceId === serviceId,
      );
      if (!balance) throw unprocessable('package-service-mismatch', 'Este pacote não inclui este serviço.');
      if (balance.remaining < quantity) throw noSessionsLeft(owner.name, balance.remaining);
      terms.set(key, {
        sessionValueCents: balance.sessionValueCents,
        commissionOnSessions: owner.commissionOnSessions,
      });
    }

    for (const use of sale.uses) {
      await tx.packageMovement.create({
        data: {
          barbershopId,
          clientPackageId: use.clientPackageId,
          serviceId: use.serviceId,
          kind: 'USE',
          quantity: -use.quantity,
          orderId: sale.orderId,
          authorUserId: sale.authorUserId,
          occurredAt: sale.occurredAt,
        },
      });
    }
    return terms;
  }

  /**
   * Fechamento da comanda: cria o pacote comprado (retrato do modelo), os saldos e a
   * compra. O valor de cada sessão divide o preço pago pelo peso de cada serviço (preço
   * atual × quantidade), e é a base da comissão quando a sessão for usada.
   */
  async recordPurchases(
    tx: Tx,
    barbershopId: string,
    sale: {
      orderId: string;
      clientId: string | null;
      items: { packageId: string; pricePaidCents: number }[];
      authorUserId: string;
      occurredAt: Date;
    },
  ): Promise<void> {
    if (sale.items.length === 0) return;
    if (!sale.clientId) {
      throw unprocessable(
        'package-needs-client',
        'Pacote é do cliente: escolha o cliente da comanda antes de vender.',
      );
    }
    for (const item of sale.items) {
      const template = await this.findPackage(tx, barbershopId, item.packageId);
      const prices = await this.catalog.servicePrices(
        tx,
        barbershopId,
        template.items.map((line) => line.serviceId),
      );
      const values = sessionValues(
        item.pricePaidCents,
        template.items.map((line) => ({
          serviceId: line.serviceId,
          quantity: line.quantity,
          listPriceCents: prices.get(line.serviceId)?.priceCents ?? 0,
        })),
      );
      const expiresAt = new Date(sale.occurredAt.getTime() + template.validityDays * 86_400_000);
      const bought = await tx.clientPackage.create({
        data: {
          barbershopId,
          clientId: sale.clientId,
          packageId: template.id,
          orderId: sale.orderId,
          name: template.name,
          pricePaidCents: item.pricePaidCents,
          commissionOnSessions: template.commissionOnSessions,
          purchasedAt: sale.occurredAt,
          expiresAt,
        },
      });
      for (const line of template.items) {
        await tx.clientPackageBalance.create({
          data: {
            barbershopId,
            clientPackageId: bought.id,
            serviceId: line.serviceId,
            initialQuantity: line.quantity,
            sessionValueCents: values.get(line.serviceId)!,
          },
        });
        await tx.packageMovement.create({
          data: {
            barbershopId,
            clientPackageId: bought.id,
            serviceId: line.serviceId,
            kind: 'PURCHASE',
            quantity: line.quantity,
            orderId: sale.orderId,
            authorUserId: sale.authorUserId,
            occurredAt: sale.occurredAt,
          },
        });
      }
    }
  }

  /**
   * Estorno da comanda. Pacote vendido nela só é cancelado se nenhuma sessão foi usada
   * (senão, o caminho é o reembolso); sessões usadas nela voltam para o saldo. Confere
   * tudo antes de gravar qualquer coisa.
   */
  async reverseForOrder(
    tx: Tx,
    barbershopId: string,
    reversal: { orderId: string; authorUserId: string; occurredAt: Date },
  ): Promise<void> {
    const sold = await tx.clientPackage.findMany({
      where: { barbershopId, orderId: reversal.orderId },
      include: { balances: true },
    });
    for (const row of sold) {
      if (row.status === 'REFUNDED') {
        throw unprocessable('package-refunded', `O pacote ${row.name} desta comanda já foi reembolsado.`);
      }
      if (row.balances.some((balance) => balance.remaining < balance.initialQuantity)) {
        throw unprocessable(
          'package-in-use',
          `O pacote ${row.name} desta comanda já teve sessões usadas: faça o reembolso do pacote em vez do estorno.`,
        );
      }
    }

    for (const row of sold) {
      await tx.clientPackage.update({ where: { id: row.id }, data: { status: 'VOIDED' } });
    }
    const uses = await tx.packageMovement.findMany({
      where: { barbershopId, orderId: reversal.orderId, kind: 'USE' },
      orderBy: { id: 'asc' },
    });
    for (const use of uses) {
      await tx.packageMovement.create({
        data: {
          barbershopId,
          clientPackageId: use.clientPackageId,
          serviceId: use.serviceId,
          kind: 'USE_REVERSAL',
          quantity: -use.quantity,
          orderId: reversal.orderId,
          authorUserId: reversal.authorUserId,
          occurredAt: reversal.occurredAt,
        },
      });
    }
  }

  // ───────────── Interno ─────────────

  private async assertServices(tx: Tx, barbershopId: string, items: { serviceId: string }[]) {
    const found = await this.catalog.servicePrices(
      tx,
      barbershopId,
      items.map((item) => item.serviceId),
    );
    if (found.size !== items.length) throw unprocessable('invalid-service', 'Serviço inexistente.');
  }

  private async findPackage(tx: Tx, barbershopId: string, packageId: string): Promise<PackageRow> {
    const row = await tx.servicePackage.findFirst({
      where: { id: packageId, barbershopId },
      include: packageInclude,
    });
    if (!row) throw notFound('Pacote');
    return row;
  }

  private async packageView(tx: Tx, barbershopId: string, packageId: string) {
    return toPackageView(await this.findPackage(tx, barbershopId, packageId));
  }

  private async findClientPackage(tx: Tx, barbershopId: string, id: string): Promise<ClientPackageRow> {
    const row = await tx.clientPackage.findFirst({
      where: { id, barbershopId },
      include: clientPackageInclude,
    });
    if (!row) throw notFound('Pacote');
    return row;
  }

  /** Trava o pacote comprado (FOR UPDATE): dois reembolsos simultâneos não passam juntos. */
  private async lockClientPackage(tx: Tx, barbershopId: string, id: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM client_packages
       WHERE id = ${id}::uuid AND barbershop_id = ${barbershopId}::uuid
       FOR UPDATE`;
    if (rows.length === 0) throw notFound('Pacote');
    return this.findClientPackage(tx, barbershopId, id);
  }
}

/** Chave (pacote do cliente, serviço) dos mapas de uso. */
export const packageTermsKey = (clientPackageId: string, serviceId: string) =>
  `${clientPackageId}|${serviceId}`;

function assertActive(row: { status: string; expiresAt: Date; name: string }, at: Date) {
  if (row.status !== 'ACTIVE') {
    throw unprocessable('package-not-active', `O pacote ${row.name} foi reembolsado ou cancelado.`);
  }
  if (row.expiresAt <= at) throw unprocessable('package-expired', `O pacote ${row.name} está vencido.`);
}

const noSessionsLeft = (name: string, remaining: number) =>
  unprocessable(
    'package-no-sessions',
    `O pacote ${name} não tem sessões suficientes deste serviço (${remaining === 1 ? 'resta 1' : `restam ${remaining}`}).`,
  );

/**
 * Valor de uma sessão de cada serviço: o preço pago dividido pelo peso de cada serviço
 * (preço de tabela × quantidade). Arredonda para baixo; a sobra de centavos não vira
 * comissão. Sem preço de tabela, divide igualmente entre as sessões.
 */
export function sessionValues(
  pricePaidCents: number,
  lines: { serviceId: string; quantity: number; listPriceCents: number }[],
): Map<string, number> {
  const totalWeight = lines.reduce((sum, line) => sum + line.listPriceCents * line.quantity, 0);
  const totalSessions = lines.reduce((sum, line) => sum + line.quantity, 0);
  return new Map(
    lines.map((line) => [
      line.serviceId,
      totalWeight === 0
        ? Math.floor(pricePaidCents / totalSessions)
        : Math.floor((pricePaidCents * line.listPriceCents) / totalWeight),
    ]),
  );
}

function statusFilter(status: ListClientPackagesQuery['status'], now: Date): Prisma.ClientPackageWhereInput {
  switch (status) {
    case 'ACTIVE':
      return { status: 'ACTIVE', expiresAt: { gt: now } };
    case 'EXPIRED':
      return { status: 'ACTIVE', expiresAt: { lte: now } };
    case 'REFUNDED':
    case 'VOIDED':
      return { status };
    default:
      return {};
  }
}

function toPackageView(row: PackageRow): ServicePackageView {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    priceCents: row.priceCents,
    validityDays: row.validityDays,
    commissionOnSessions: row.commissionOnSessions,
    active: row.active,
    items: row.items.map((item) => ({
      serviceId: item.serviceId,
      name: item.service.name,
      quantity: item.quantity,
    })),
  };
}

function toClientPackageView(row: ClientPackageRow, now: Date): ClientPackageView {
  return {
    id: row.id,
    name: row.name,
    purchasedAt: row.purchasedAt,
    expiresAt: row.expiresAt,
    status: row.status === 'ACTIVE' && row.expiresAt <= now ? 'EXPIRED' : row.status,
    balances: row.balances.map((balance) => ({
      serviceId: balance.serviceId,
      name: balance.service.name,
      initialQuantity: balance.initialQuantity,
      remaining: balance.remaining,
    })),
    client: row.client,
    packageId: row.packageId,
    orderId: row.orderId,
    pricePaidCents: row.pricePaidCents,
    commissionOnSessions: row.commissionOnSessions,
    refundCents: row.refundCents,
    refundedAt: row.refundedAt,
    refundReason: row.refundReason,
  };
}
