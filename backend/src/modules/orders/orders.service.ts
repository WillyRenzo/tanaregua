import { Inject, Injectable } from '@nestjs/common';
import { conflict, notFound, unprocessable } from '../../common/http/domain-error.js';
import { cursorArgs, toPage, type Page } from '../../common/http/pagination.js';
import { TenantDb } from '../../common/tenancy/tenant-db.service.js';
import { Clock } from '../../common/time/clock.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { Tx } from '../../prisma/prisma.service.js';
import type { OrderView } from '../finance/finance.responses.js';
import { AppointmentsService } from '../appointments/appointments.service.js';
import { CatalogService } from '../catalog/catalog.service.js';
import {
  calculateCommissionCents,
  resolveCommissionRule,
  type CommissionRuleTerms,
} from '../catalog/commission-policy.js';
import { ClientsService } from '../clients/clients.service.js';
import { FinanceService } from '../finance/finance.service.js';
import { ProductsService } from '../products/products.service.js';
import { PackagesService, packageTermsKey, type PackageUseTerms } from '../packages/packages.service.js';
import { StaffService } from '../staff/staff.service.js';
import type {
  CloseOrderInput,
  ListOrdersQuery,
  OpenOrderInput,
  ApplyPackageInput,
  OrderItemInput,
  UpdateOrderItemInput,
  VoidOrderInput,
} from './orders.schemas.js';

const orderInclude = {
  client: { select: { id: true, name: true } },
  items: {
    orderBy: { createdAt: 'asc' },
    include: { professional: { select: { id: true, user: { select: { name: true } } } } },
  },
} as const satisfies Prisma.OrderInclude;

type OrderRow = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

export type { OrderView };

const ORDERABLE_APPOINTMENT_STATUSES = ['SCHEDULED', 'CONFIRMED', 'IN_SERVICE'];

@Injectable()
export class OrdersService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(AppointmentsService) private readonly appointments: AppointmentsService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(StaffService) private readonly staff: StaffService,
    @Inject(ClientsService) private readonly clients: ClientsService,
    @Inject(FinanceService) private readonly finance: FinanceService,
    @Inject(ProductsService) private readonly products: ProductsService,
    @Inject(PackagesService) private readonly packages: PackagesService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  list(query: ListOrdersQuery): Promise<Page<OrderView>> {
    return this.db.run(async (tx, auth) => {
      const rows = await tx.order.findMany({
        where: {
          barbershopId: auth.barbershopId,
          ...(query.status ? { status: query.status } : {}),
          ...(query.appointmentId ? { appointmentId: query.appointmentId } : {}),
        },
        include: orderInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...cursorArgs(query),
      });
      const page = toPage(rows, query.limit);
      const rules = await this.catalog.commissionRules(tx, auth.barbershopId);
      return { items: page.items.map((row) => toView(row, rules, new Map())), nextCursor: page.nextCursor };
    });
  }

  get(orderId: string): Promise<OrderView> {
    return this.db.run(async (tx, auth) => this.view(tx, auth.barbershopId, orderId));
  }

  open(input: OpenOrderInput): Promise<OrderView> {
    return this.db.run(async (tx, auth) => {
      if ('appointmentId' in input) {
        const appointment = await this.appointments.getInTx(tx, auth.barbershopId, input.appointmentId);
        // Antes do status: "já tem comanda" deixa o frontend abrir a existente.
        const existing = await tx.order.findFirst({
          where: { barbershopId: auth.barbershopId, appointmentId: appointment.id },
          select: { id: true },
        });
        if (existing) {
          throw conflict('order-already-exists', 'Este agendamento já tem uma comanda.');
        }
        if (!ORDERABLE_APPOINTMENT_STATUSES.includes(appointment.status)) {
          throw unprocessable('appointment-not-orderable', 'Este agendamento não pode gerar comanda.');
        }
        const order = await tx.order.create({
          data: {
            barbershopId: auth.barbershopId,
            appointmentId: appointment.id,
            clientId: appointment.client.id,
            openedByUserId: auth.userId,
            createdAt: this.clock.now(),
          },
        });
        // Copia os serviços agendados (com o preço do snapshot do agendamento).
        await tx.orderItem.createMany({
          data: appointment.items.map((item) => ({
            barbershopId: auth.barbershopId,
            orderId: order.id,
            serviceId: item.serviceId,
            professionalId: appointment.professional.id,
            name: item.name,
            unitPriceCents: item.priceCents,
            totalCents: item.priceCents,
          })),
        });
        return this.view(tx, auth.barbershopId, order.id);
      }

      if (input.clientId) await this.clients.assertExists(tx, auth.barbershopId, input.clientId);
      const order = await tx.order.create({
        data: {
          barbershopId: auth.barbershopId,
          clientId: input.clientId,
          openedByUserId: auth.userId,
          createdAt: this.clock.now(),
        },
      });
      for (const item of input.items) {
        await this.insertItem(tx, auth.barbershopId, order.id, item);
      }
      return this.view(tx, auth.barbershopId, order.id);
    });
  }

  addItem(orderId: string, input: OrderItemInput): Promise<OrderView> {
    return this.db.run(async (tx, auth) => {
      await this.lockOpen(tx, auth.barbershopId, orderId);
      await this.insertItem(tx, auth.barbershopId, orderId, input);
      return this.view(tx, auth.barbershopId, orderId);
    });
  }

  updateItem(orderId: string, itemId: string, input: UpdateOrderItemInput): Promise<OrderView> {
    return this.db.run(async (tx, auth) => {
      await this.lockOpen(tx, auth.barbershopId, orderId);
      const item = await tx.orderItem.findFirst({
        where: { id: itemId, orderId, barbershopId: auth.barbershopId },
      });
      if (!item) throw notFound('Item');
      const quantity = input.quantity ?? item.quantity;
      const discountCents = input.discountCents ?? item.discountCents;
      if (item.kind === 'PACKAGE' && quantity !== 1) {
        throw unprocessable('package-quantity', 'Venda um pacote por item.');
      }
      if (item.clientPackageId) {
        // Pago com pacote: não há valor a descontar; muda só a quantidade de sessões.
        if (discountCents > 0) {
          throw unprocessable('package-item-discount', 'Serviço pago com pacote não tem desconto.');
        }
        await tx.orderItem.update({ where: { id: itemId }, data: { quantity } });
        return this.view(tx, auth.barbershopId, orderId);
      }
      await tx.orderItem.update({
        where: { id: itemId },
        data: {
          quantity,
          discountCents,
          totalCents: itemTotal(item.unitPriceCents, quantity, discountCents),
        },
      });
      return this.view(tx, auth.barbershopId, orderId);
    });
  }

  /**
   * Paga um serviço da comanda com sessão de pacote do cliente (o item passa a cobrar
   * zero) ou desfaz (null). As sessões só saem do saldo no fechamento.
   */
  applyPackage(orderId: string, itemId: string, input: ApplyPackageInput): Promise<OrderView> {
    return this.db.run(async (tx, auth) => {
      await this.lockOpen(tx, auth.barbershopId, orderId);
      const item = await tx.orderItem.findFirst({
        where: { id: itemId, orderId, barbershopId: auth.barbershopId },
      });
      if (!item) throw notFound('Item');
      if (item.kind !== 'SERVICE' || !item.serviceId) {
        throw unprocessable('package-service-mismatch', 'Só serviços podem ser pagos com pacote.');
      }

      if (input.clientPackageId === null) {
        await tx.orderItem.update({
          where: { id: itemId },
          data: { clientPackageId: null, discountCents: 0, totalCents: item.unitPriceCents * item.quantity },
        });
        return this.view(tx, auth.barbershopId, orderId);
      }

      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { clientId: true } });
      if (!order.clientId) {
        throw unprocessable('package-needs-client', 'Escolha o cliente da comanda para usar o pacote dele.');
      }
      // Outros itens desta comanda já marcados no mesmo pacote e serviço também contam.
      const sameUse = await tx.orderItem.aggregate({
        where: {
          barbershopId: auth.barbershopId,
          orderId,
          clientPackageId: input.clientPackageId,
          serviceId: item.serviceId,
          id: { not: itemId },
        },
        _sum: { quantity: true },
      });
      await this.packages.assertUsable(tx, auth.barbershopId, {
        clientPackageId: input.clientPackageId,
        clientId: order.clientId,
        serviceId: item.serviceId,
        quantity: item.quantity + (sameUse._sum.quantity ?? 0),
        at: this.clock.now(),
      });
      await tx.orderItem.update({
        where: { id: itemId },
        data: { clientPackageId: input.clientPackageId, discountCents: 0, totalCents: 0 },
      });
      return this.view(tx, auth.barbershopId, orderId);
    });
  }

  removeItem(orderId: string, itemId: string): Promise<OrderView> {
    return this.db.run(async (tx, auth) => {
      await this.lockOpen(tx, auth.barbershopId, orderId);
      const deleted = await tx.orderItem.deleteMany({
        where: { id: itemId, orderId, barbershopId: auth.barbershopId },
      });
      if (deleted.count === 0) throw notFound('Item');
      return this.view(tx, auth.barbershopId, orderId);
    });
  }

  /**
   * Fechamento em UMA transação (business-rules §3/§4/§6/§7): dá baixa nos produtos e nas
   * sessões de pacote (recusa se faltar), cria os pacotes vendidos, congela as comissões
   * nos itens, fecha a comanda, lança caixa e comissões e conclui o agendamento. Se
   * qualquer passo falhar, nada é gravado.
   */
  close(orderId: string, input: CloseOrderInput): Promise<OrderView> {
    return this.db.run(async (tx, auth) => {
      const order = await this.lockOpen(tx, auth.barbershopId, orderId);
      const items = await tx.orderItem.findMany({ where: { barbershopId: auth.barbershopId, orderId } });
      if (items.length === 0) {
        throw unprocessable('order-empty', 'Adicione ao menos um item antes de fechar a comanda.');
      }
      const { clientId } = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        select: { clientId: true },
      });

      const closedAt = this.clock.now();
      await this.products.recordSale(tx, auth.barbershopId, {
        orderId,
        items: items.flatMap((item) =>
          item.productId ? [{ productId: item.productId, quantity: item.quantity }] : [],
        ),
        authorUserId: auth.userId,
        occurredAt: closedAt,
      });
      const packageTerms = await this.packages.recordUses(tx, auth.barbershopId, {
        orderId,
        clientId,
        uses: items.flatMap((item) =>
          item.clientPackageId && item.serviceId
            ? [
                {
                  orderItemId: item.id,
                  clientPackageId: item.clientPackageId,
                  serviceId: item.serviceId,
                  quantity: item.quantity,
                },
              ]
            : [],
        ),
        authorUserId: auth.userId,
        occurredAt: closedAt,
      });
      await this.packages.recordPurchases(tx, auth.barbershopId, {
        orderId,
        clientId,
        items: items.flatMap((item) =>
          item.packageId ? [{ packageId: item.packageId, pricePaidCents: item.totalCents }] : [],
        ),
        authorUserId: auth.userId,
        occurredAt: closedAt,
      });

      const rules = await this.catalog.commissionRules(tx, auth.barbershopId);
      const commissions: { orderItemId: string; professionalId: string; amountCents: number }[] = [];
      for (const item of items) {
        const terms =
          item.clientPackageId && item.serviceId
            ? packageTerms.get(packageTermsKey(item.clientPackageId, item.serviceId))
            : undefined;
        // Pacote vendido não gera comissão na venda: ela sai quando cada sessão é usada.
        const rule =
          item.kind === 'PACKAGE'
            ? undefined
            : resolveCommissionRule(rules, item.professionalId, commissionTarget(item));
        const commissionCents = calculateCommissionCents(commissionBase(item, terms), rule);
        await tx.orderItem.update({
          where: { id: item.id },
          data: {
            commissionType: rule?.type ?? null,
            commissionValue: rule?.value ?? null,
            commissionCents,
            ...(terms ? { packageSessionValueCents: terms.sessionValueCents } : {}),
          },
        });
        // Venda de balcão (produto sem profissional) não tem a quem pagar comissão.
        if (item.professionalId) {
          commissions.push({
            orderItemId: item.id,
            professionalId: item.professionalId,
            amountCents: commissionCents,
          });
        }
      }

      const totalCents = items.reduce((sum, item) => sum + item.totalCents, 0);
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'CLOSED',
          paymentMethod: input.paymentMethod,
          totalCents,
          closedAt,
          closedByUserId: auth.userId,
        },
      });
      await this.finance.recordSale(tx, auth.barbershopId, {
        orderId,
        method: input.paymentMethod,
        totalCents,
        commissions,
        occurredAt: closedAt,
      });
      if (order.appointmentId) {
        await this.appointments.completeFromOrder(tx, auth.barbershopId, order.appointmentId);
      }
      return this.view(tx, auth.barbershopId, orderId);
    });
  }

  /** Comanda aberta é descartada; fechada é estornada com lançamentos inversos. */
  void(orderId: string, input: VoidOrderInput): Promise<OrderView> {
    return this.db.run(async (tx, auth) => {
      const order = await this.lock(tx, auth.barbershopId, orderId);
      if (order.status === 'VOIDED') {
        throw unprocessable('order-already-voided', 'Esta comanda já foi estornada.');
      }
      const voidedAt = this.clock.now();
      if (order.status === 'CLOSED') {
        // Primeiro: recusa (sem gravar nada) se um pacote vendido aqui já foi usado ou reembolsado.
        await this.packages.reverseForOrder(tx, auth.barbershopId, {
          orderId,
          authorUserId: auth.userId,
          occurredAt: voidedAt,
        });
        await this.finance.recordReversal(tx, auth.barbershopId, orderId, voidedAt);
        // Produto vendido volta para o estoque (business-rules §7).
        await this.products.recordSaleReversal(tx, auth.barbershopId, {
          orderId,
          authorUserId: auth.userId,
          occurredAt: voidedAt,
        });
      }
      await tx.order.update({
        where: { id: orderId },
        data: { status: 'VOIDED', voidedAt, voidReason: input.reason },
      });
      return this.view(tx, auth.barbershopId, orderId);
    });
  }

  /** Serviços mais vendidos no período (comandas fechadas). */
  async topServices(tx: Tx, barbershopId: string, from: Date, to: Date) {
    const rows = await tx.$queryRaw<
      { service_id: string; name: string; quantity: bigint; revenue_cents: bigint }[]
    >`
      SELECT oi.service_id, MIN(oi.name) AS name, SUM(oi.quantity)::bigint AS quantity,
             SUM(oi.total_cents)::bigint AS revenue_cents
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id AND o.barbershop_id = oi.barbershop_id
       WHERE oi.barbershop_id = ${barbershopId}::uuid AND o.status = 'CLOSED' AND oi.kind = 'SERVICE'
         AND o.closed_at >= ${from} AND o.closed_at < ${to}
       GROUP BY oi.service_id
       ORDER BY revenue_cents DESC
       LIMIT 10`;
    return rows.map((row) => ({
      serviceId: row.service_id,
      name: row.name,
      quantity: Number(row.quantity),
      revenueCents: Number(row.revenue_cents),
    }));
  }

  /** Produtos mais vendidos no período (comandas fechadas). */
  async topProducts(tx: Tx, barbershopId: string, from: Date, to: Date) {
    const rows = await tx.$queryRaw<
      { product_id: string; name: string; quantity: bigint; revenue_cents: bigint }[]
    >`
      SELECT oi.product_id, MIN(oi.name) AS name, SUM(oi.quantity)::bigint AS quantity,
             SUM(oi.total_cents)::bigint AS revenue_cents
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id AND o.barbershop_id = oi.barbershop_id
       WHERE oi.barbershop_id = ${barbershopId}::uuid AND o.status = 'CLOSED' AND oi.kind = 'PRODUCT'
         AND o.closed_at >= ${from} AND o.closed_at < ${to}
       GROUP BY oi.product_id
       ORDER BY revenue_cents DESC
       LIMIT 10`;
    return rows.map((row) => ({
      productId: row.product_id,
      name: row.name,
      quantity: Number(row.quantity),
      revenueCents: Number(row.revenue_cents),
    }));
  }

  /**
   * Faturamento por profissional (itens de comandas fechadas, inclusive produtos que ele
   * vendeu) no período. Venda de balcão não entra aqui. Nomes ficam com a equipe.
   */
  async revenueByProfessional(tx: Tx, barbershopId: string, from: Date, to: Date) {
    const rows = await tx.$queryRaw<{ professional_id: string; revenue_cents: bigint; services: bigint }[]>`
      SELECT oi.professional_id, SUM(oi.total_cents)::bigint AS revenue_cents,
             COALESCE(SUM(oi.quantity) FILTER (WHERE oi.kind = 'SERVICE'), 0)::bigint AS services
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id AND o.barbershop_id = oi.barbershop_id
       WHERE oi.barbershop_id = ${barbershopId}::uuid AND o.status = 'CLOSED'
         AND oi.professional_id IS NOT NULL
         AND o.closed_at >= ${from} AND o.closed_at < ${to}
       GROUP BY oi.professional_id
       ORDER BY revenue_cents DESC`;
    return rows.map((row) => ({
      professionalId: row.professional_id,
      revenueCents: Number(row.revenue_cents),
      services: Number(row.services),
    }));
  }

  /**
   * Serviço sempre com profissional; produto com profissional opcional (venda de balcão);
   * pacote sem profissional (a comissão sai quando cada sessão é usada).
   */
  private async insertItem(tx: Tx, barbershopId: string, orderId: string, input: OrderItemInput) {
    const amounts = { quantity: input.quantity, discountCents: input.discountCents };

    if ('packageId' in input) {
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { clientId: true } });
      if (!order.clientId) {
        throw unprocessable(
          'package-needs-client',
          'Pacote é do cliente: escolha o cliente da comanda antes de vender.',
        );
      }
      const template = await this.packages.packageForSale(tx, barbershopId, input.packageId);
      await tx.orderItem.create({
        data: {
          barbershopId,
          orderId,
          kind: 'PACKAGE',
          packageId: template.id,
          name: template.name,
          unitPriceCents: template.priceCents,
          ...amounts,
          totalCents: itemTotal(template.priceCents, input.quantity, input.discountCents),
        },
      });
      return;
    }

    if (input.professionalId) await this.staff.assertProfessional(tx, barbershopId, input.professionalId);
    if ('productId' in input) {
      const [product] = await this.products.productsForSale(tx, barbershopId, [input.productId]);
      await tx.orderItem.create({
        data: {
          barbershopId,
          orderId,
          kind: 'PRODUCT',
          productId: product!.id,
          professionalId: input.professionalId,
          name: product!.name,
          unitPriceCents: product!.priceCents,
          ...amounts,
          totalCents: itemTotal(product!.priceCents, input.quantity, input.discountCents),
        },
      });
      return;
    }

    const [service] = await this.catalog.servicesForBooking(tx, barbershopId, [input.serviceId]);
    await tx.orderItem.create({
      data: {
        barbershopId,
        orderId,
        kind: 'SERVICE',
        serviceId: service!.id,
        professionalId: input.professionalId,
        name: service!.name,
        unitPriceCents: service!.priceCents,
        ...amounts,
        totalCents: itemTotal(service!.priceCents, input.quantity, input.discountCents),
      },
    });
  }

  /** Trava a linha da comanda (FOR UPDATE): dois fechamentos simultâneos não passam juntos. */
  private async lock(tx: Tx, barbershopId: string, orderId: string) {
    const rows = await tx.$queryRaw<
      { status: 'OPEN' | 'CLOSED' | 'VOIDED'; appointment_id: string | null }[]
    >`
      SELECT status, appointment_id FROM orders
       WHERE id = ${orderId}::uuid AND barbershop_id = ${barbershopId}::uuid
       FOR UPDATE`;
    const row = rows[0];
    if (!row) throw notFound('Comanda');
    return { status: row.status, appointmentId: row.appointment_id };
  }

  private async lockOpen(tx: Tx, barbershopId: string, orderId: string) {
    const order = await this.lock(tx, barbershopId, orderId);
    if (order.status !== 'OPEN') {
      throw unprocessable('order-not-open', 'Comanda fechada não pode ser alterada. Use o estorno.');
    }
    return order;
  }

  private async view(tx: Tx, barbershopId: string, orderId: string): Promise<OrderView> {
    const row = await tx.order.findFirst({ where: { id: orderId, barbershopId }, include: orderInclude });
    if (!row) throw notFound('Comanda');
    if (row.status !== 'OPEN') return toView(row, [], new Map());
    const rules = await this.catalog.commissionRules(tx, barbershopId);
    // Comissão prevista de serviço pago com pacote usa o valor da sessão.
    const terms = await this.packages.sessionTerms(
      tx,
      barbershopId,
      row.items.flatMap((item) =>
        item.clientPackageId && item.serviceId
          ? [{ clientPackageId: item.clientPackageId, serviceId: item.serviceId }]
          : [],
      ),
    );
    return toView(row, rules, terms);
  }
}

/**
 * Base da comissão do item (business-rules §4 e §6): o valor cobrado; num serviço pago com
 * pacote, o valor das sessões usadas, ou zero se o pacote não comissiona sessões.
 */
function commissionBase(
  item: { totalCents: number; quantity: number; clientPackageId: string | null },
  terms: PackageUseTerms | undefined,
): number {
  if (!item.clientPackageId) return item.totalCents;
  return terms?.commissionOnSessions ? terms.sessionValueCents * item.quantity : 0;
}

function itemTotal(unitPriceCents: number, quantity: number, discountCents: number): number {
  const gross = unitPriceCents * quantity;
  if (discountCents > gross) {
    throw unprocessable('discount-too-high', 'O desconto não pode ser maior que o valor do item.');
  }
  return gross - discountCents;
}

/** O que o item vendeu, para escolher a regra de comissão (o CHECK do banco garante um dos dois). */
function commissionTarget(item: { serviceId: string | null; productId: string | null }) {
  return item.productId ? { productId: item.productId } : { serviceId: item.serviceId! };
}

function toView(row: OrderRow, rules: CommissionRuleTerms[], terms: Map<string, PackageUseTerms>): OrderView {
  const items = row.items.map((item) => ({
    id: item.id,
    kind: item.kind,
    serviceId: item.serviceId,
    productId: item.productId,
    packageId: item.packageId,
    clientPackageId: item.clientPackageId,
    name: item.name,
    professional: item.professional ? { id: item.professional.id, name: item.professional.user.name } : null,
    unitPriceCents: item.unitPriceCents,
    quantity: item.quantity,
    discountCents: item.discountCents,
    totalCents: item.totalCents,
    commissionCents:
      item.commissionCents ??
      (item.kind === 'PACKAGE'
        ? 0
        : calculateCommissionCents(
            commissionBase(
              item,
              item.clientPackageId && item.serviceId
                ? terms.get(packageTermsKey(item.clientPackageId, item.serviceId))
                : undefined,
            ),
            resolveCommissionRule(rules, item.professionalId, commissionTarget(item)),
          )),
  }));
  return {
    id: row.id,
    status: row.status,
    appointmentId: row.appointmentId,
    client: row.client,
    items,
    totalCents: row.totalCents ?? items.reduce((sum, item) => sum + item.totalCents, 0),
    paymentMethod: row.paymentMethod,
    closedAt: row.closedAt,
    voidedAt: row.voidedAt,
    voidReason: row.voidReason,
    createdAt: row.createdAt,
  };
}
