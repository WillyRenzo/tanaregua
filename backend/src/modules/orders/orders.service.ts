import { Inject, Injectable } from '@nestjs/common';
import { conflict, notFound, unprocessable } from '../../common/http/domain-error.js';
import { cursorArgs, toPage, type Page } from '../../common/http/pagination.js';
import { TenantDb } from '../../common/tenancy/tenant-db.service.js';
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
import { StaffService } from '../staff/staff.service.js';
import type {
  CloseOrderInput,
  ListOrdersQuery,
  OpenOrderInput,
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
      return { items: page.items.map((row) => toView(row, rules)), nextCursor: page.nextCursor };
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
        data: { barbershopId: auth.barbershopId, clientId: input.clientId, openedByUserId: auth.userId },
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
   * Fechamento em UMA transação (business-rules §3/§4): congela as comissões nos itens,
   * fecha a comanda, lança caixa e comissões e conclui o agendamento. Se qualquer passo
   * falhar, nada é gravado.
   */
  close(orderId: string, input: CloseOrderInput): Promise<OrderView> {
    return this.db.run(async (tx, auth) => {
      const order = await this.lockOpen(tx, auth.barbershopId, orderId);
      const items = await tx.orderItem.findMany({ where: { barbershopId: auth.barbershopId, orderId } });
      if (items.length === 0) {
        throw unprocessable('order-empty', 'Adicione ao menos um serviço antes de fechar a comanda.');
      }

      const rules = await this.catalog.commissionRules(tx, auth.barbershopId);
      const commissions: { orderItemId: string; professionalId: string; amountCents: number }[] = [];
      for (const item of items) {
        const rule = resolveCommissionRule(rules, item.professionalId, item.serviceId);
        const commissionCents = calculateCommissionCents(item.totalCents, rule);
        await tx.orderItem.update({
          where: { id: item.id },
          data: { commissionType: rule?.type ?? null, commissionValue: rule?.value ?? null, commissionCents },
        });
        commissions.push({
          orderItemId: item.id,
          professionalId: item.professionalId,
          amountCents: commissionCents,
        });
      }

      const totalCents = items.reduce((sum, item) => sum + item.totalCents, 0);
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'CLOSED',
          paymentMethod: input.paymentMethod,
          totalCents,
          closedAt: new Date(),
          closedByUserId: auth.userId,
        },
      });
      await this.finance.recordSale(tx, auth.barbershopId, {
        orderId,
        method: input.paymentMethod,
        totalCents,
        commissions,
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
      if (order.status === 'CLOSED') {
        await this.finance.recordReversal(tx, auth.barbershopId, orderId);
      }
      await tx.order.update({
        where: { id: orderId },
        data: { status: 'VOIDED', voidedAt: new Date(), voidReason: input.reason },
      });
      return this.view(tx, auth.barbershopId, orderId);
    });
  }

  /** Itens vendidos no período (relatório de serviços mais vendidos). */
  async topServices(tx: Tx, barbershopId: string, from: Date, to: Date) {
    const rows = await tx.$queryRaw<
      { service_id: string; name: string; quantity: bigint; revenue_cents: bigint }[]
    >`
      SELECT oi.service_id, MIN(oi.name) AS name, SUM(oi.quantity)::bigint AS quantity,
             SUM(oi.total_cents)::bigint AS revenue_cents
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id AND o.barbershop_id = oi.barbershop_id
       WHERE oi.barbershop_id = ${barbershopId}::uuid AND o.status = 'CLOSED'
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

  /** Faturamento por profissional (itens de comandas fechadas) no período. Nomes ficam com a equipe. */
  async revenueByProfessional(tx: Tx, barbershopId: string, from: Date, to: Date) {
    const rows = await tx.$queryRaw<{ professional_id: string; revenue_cents: bigint; services: bigint }[]>`
      SELECT oi.professional_id, SUM(oi.total_cents)::bigint AS revenue_cents,
             SUM(oi.quantity)::bigint AS services
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id AND o.barbershop_id = oi.barbershop_id
       WHERE oi.barbershop_id = ${barbershopId}::uuid AND o.status = 'CLOSED'
         AND o.closed_at >= ${from} AND o.closed_at < ${to}
       GROUP BY oi.professional_id
       ORDER BY revenue_cents DESC`;
    return rows.map((row) => ({
      professionalId: row.professional_id,
      revenueCents: Number(row.revenue_cents),
      services: Number(row.services),
    }));
  }

  private async insertItem(tx: Tx, barbershopId: string, orderId: string, input: OrderItemInput) {
    const [service] = await this.catalog.servicesForBooking(tx, barbershopId, [input.serviceId]);
    await this.staff.assertProfessional(tx, barbershopId, input.professionalId);
    await tx.orderItem.create({
      data: {
        barbershopId,
        orderId,
        serviceId: service!.id,
        professionalId: input.professionalId,
        name: service!.name,
        unitPriceCents: service!.priceCents,
        quantity: input.quantity,
        discountCents: input.discountCents,
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
    const rules = row.status === 'OPEN' ? await this.catalog.commissionRules(tx, barbershopId) : [];
    return toView(row, rules);
  }
}

function itemTotal(unitPriceCents: number, quantity: number, discountCents: number): number {
  const gross = unitPriceCents * quantity;
  if (discountCents > gross) {
    throw unprocessable('discount-too-high', 'O desconto não pode ser maior que o valor do item.');
  }
  return gross - discountCents;
}

function toView(row: OrderRow, rules: CommissionRuleTerms[]): OrderView {
  const items = row.items.map((item) => ({
    id: item.id,
    serviceId: item.serviceId,
    name: item.name,
    professional: { id: item.professional.id, name: item.professional.user.name },
    unitPriceCents: item.unitPriceCents,
    quantity: item.quantity,
    discountCents: item.discountCents,
    totalCents: item.totalCents,
    commissionCents:
      item.commissionCents ??
      calculateCommissionCents(
        item.totalCents,
        resolveCommissionRule(rules, item.professionalId, item.serviceId),
      ),
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
