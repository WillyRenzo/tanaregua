import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { AuthContext } from '../../common/tenancy/request-context.js';
import { TenantDb } from '../../common/tenancy/tenant-db.service.js';
import type { Tx } from '../../prisma/prisma.service.js';
import { localDateSchema } from '../appointments/appointments.schemas.js';
import { dayBounds, nextDate } from '../appointments/availability.js';
import { BarbershopsService } from '../barbershops/barbershops.module.js';

export type PaymentMethod = 'CASH' | 'PIX' | 'CARD_CREDIT' | 'CARD_DEBIT' | 'OTHER';
export const PAYMENT_METHODS = ['CASH', 'PIX', 'CARD_CREDIT', 'CARD_DEBIT', 'OTHER'] as const;

export const cashDayQuerySchema = z.strictObject({ date: localDateSchema });
export type CashDayQuery = z.infer<typeof cashDayQuerySchema>;

const MAX_PERIOD_DAYS = 93;

/** Período de datas locais da barbearia, `to` inclusivo. */
export const periodQuerySchema = z
  .strictObject({
    from: localDateSchema,
    to: localDateSchema,
    professionalId: z.uuid().optional(),
  })
  .refine((period) => period.from <= period.to, 'O início precisa ser antes do fim.')
  .refine(
    (period) => (Date.parse(period.to) - Date.parse(period.from)) / 86_400_000 < MAX_PERIOD_DAYS,
    `Período máximo de ${MAX_PERIOD_DAYS} dias.`,
  );
export type PeriodQuery = z.infer<typeof periodQuerySchema>;

export interface SaleRecord {
  orderId: string;
  method: PaymentMethod;
  totalCents: number;
  commissions: { orderItemId: string; professionalId: string; amountCents: number }[];
  occurredAt: Date;
}

/**
 * Dono dos lançamentos de caixa e comissão. Lançamentos são append-only (o banco nega
 * UPDATE/DELETE ao usuário da aplicação): estorno gera lançamentos inversos.
 */
@Injectable()
export class FinanceService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(BarbershopsService) private readonly barbershops: BarbershopsService,
  ) {}

  async recordSale(tx: Tx, barbershopId: string, sale: SaleRecord): Promise<void> {
    const commissions = sale.commissions.filter((commission) => commission.amountCents > 0);
    if (commissions.length > 0) {
      await tx.commissionEntry.createMany({
        data: commissions.map((commission) => ({
          barbershopId,
          orderId: sale.orderId,
          kind: 'ENTRY' as const,
          occurredAt: sale.occurredAt,
          ...commission,
        })),
      });
    }
    await tx.cashEntry.create({
      data: {
        barbershopId,
        orderId: sale.orderId,
        method: sale.method,
        kind: 'ENTRY',
        amountCents: sale.totalCents,
        occurredAt: sale.occurredAt,
      },
    });
  }

  /**
   * Reembolso de pacote pago antecipadamente (business-rules §6): saída de caixa ligada à
   * comanda da venda, que continua fechada e intacta. Não mexe em comissões já lançadas.
   */
  async recordRefund(
    tx: Tx,
    barbershopId: string,
    refund: { orderId: string; method: PaymentMethod; amountCents: number; occurredAt: Date },
  ): Promise<void> {
    if (refund.amountCents === 0) return;
    await tx.cashEntry.create({
      data: {
        barbershopId,
        orderId: refund.orderId,
        method: refund.method,
        kind: 'REFUND',
        amountCents: -refund.amountCents,
        occurredAt: refund.occurredAt,
      },
    });
  }

  /** Estorno: espelha cada lançamento original com o valor negativo. */
  async recordReversal(tx: Tx, barbershopId: string, orderId: string, occurredAt: Date): Promise<void> {
    const commissions = await tx.commissionEntry.findMany({
      where: { barbershopId, orderId, kind: 'ENTRY' },
    });
    const cash = await tx.cashEntry.findMany({ where: { barbershopId, orderId, kind: 'ENTRY' } });
    if (commissions.length > 0) {
      await tx.commissionEntry.createMany({
        data: commissions.map((entry) => ({
          barbershopId,
          orderId,
          orderItemId: entry.orderItemId,
          professionalId: entry.professionalId,
          kind: 'REVERSAL' as const,
          amountCents: -entry.amountCents,
          occurredAt,
        })),
      });
    }
    if (cash.length > 0) {
      await tx.cashEntry.createMany({
        data: cash.map((entry) => ({
          barbershopId,
          orderId,
          method: entry.method,
          kind: 'REVERSAL' as const,
          amountCents: -entry.amountCents,
          occurredAt,
        })),
      });
    }
  }

  /** Caixa do dia: lançamentos e totais por forma de pagamento (estornos já abatidos). */
  cashDay(query: CashDayQuery) {
    return this.db.run(async (tx, auth) => {
      const settings = await this.barbershops.settings(tx, auth.barbershopId);
      const { from, to } = dayBounds(query.date, settings.timezone);
      const entries = await tx.cashEntry.findMany({
        where: { barbershopId: auth.barbershopId, occurredAt: { gte: from, lt: to } },
        select: {
          id: true,
          orderId: true,
          method: true,
          kind: true,
          amountCents: true,
          occurredAt: true,
          order: { select: { client: { select: { name: true } } } },
        },
        orderBy: { occurredAt: 'asc' },
      });

      const totals = Object.fromEntries(PAYMENT_METHODS.map((method) => [method, 0])) as Record<
        PaymentMethod,
        number
      >;
      for (const entry of entries) totals[entry.method] += entry.amountCents;

      return {
        date: query.date,
        timezone: settings.timezone,
        totals,
        netCents: entries.reduce((sum, entry) => sum + entry.amountCents, 0),
        entries: entries.map(({ order, ...entry }) => ({ ...entry, clientName: order.client?.name ?? null })),
      };
    });
  }

  /** Comissões por profissional no período. Quem só tem `:own` vê apenas as próprias. */
  commissions(query: PeriodQuery) {
    return this.db.run(async (tx, auth) => {
      const professionalId = this.scopedProfessional(auth, query.professionalId);
      const settings = await this.barbershops.settings(tx, auth.barbershopId);
      const { from, to } = periodBounds(query, settings.timezone);

      const entries = await tx.commissionEntry.findMany({
        where: {
          barbershopId: auth.barbershopId,
          occurredAt: { gte: from, lt: to },
          ...(professionalId ? { professionalId } : {}),
        },
        select: {
          professionalId: true,
          kind: true,
          amountCents: true,
          occurredAt: true,
          orderId: true,
          professional: { select: { user: { select: { name: true } } } },
        },
        orderBy: { occurredAt: 'asc' },
      });

      const byProfessional = new Map<
        string,
        { professionalId: string; name: string; totalCents: number; entries: number }
      >();
      for (const entry of entries) {
        const summary = byProfessional.get(entry.professionalId) ?? {
          professionalId: entry.professionalId,
          name: entry.professional.user.name,
          totalCents: 0,
          entries: 0,
        };
        summary.totalCents += entry.amountCents;
        summary.entries += 1;
        byProfessional.set(entry.professionalId, summary);
      }
      return {
        from: query.from,
        to: query.to,
        professionals: [...byProfessional.values()].sort((a, b) => b.totalCents - a.totalCents),
      };
    });
  }

  /** Receita líquida (caixa) no período, por dia local. Usado pelos relatórios. */
  async revenueByDay(tx: Tx, barbershopId: string, timezone: string, period: PeriodQuery) {
    const { from, to } = periodBounds(period, timezone);
    const rows = await tx.$queryRaw<{ day: string; net_cents: bigint }[]>`
      SELECT to_char(occurred_at AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS day,
             SUM(amount_cents)::bigint AS net_cents
        FROM cash_entries
       WHERE barbershop_id = ${barbershopId}::uuid AND occurred_at >= ${from} AND occurred_at < ${to}
       GROUP BY 1
       ORDER BY 1`;
    return rows.map((row) => ({ day: row.day, netCents: Number(row.net_cents) }));
  }

  private scopedProfessional(auth: AuthContext, requested?: string): string | undefined {
    if (auth.permissions.includes('commissions:read:any')) return requested;
    if (requested && requested !== auth.membershipId) {
      throw new ForbiddenException('Você só pode ver as próprias comissões.');
    }
    return auth.membershipId;
  }
}

/** Período local → instantes UTC [início do `from`, início do dia seguinte ao `to`). */
export function periodBounds(period: { from: string; to: string }, timezone: string) {
  return {
    from: dayBounds(period.from, timezone).from,
    to: dayBounds(nextDate(period.to), timezone).from,
  };
}
