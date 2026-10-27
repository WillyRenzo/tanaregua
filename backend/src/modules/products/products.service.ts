import { Inject, Injectable } from '@nestjs/common';
import { notFound, unprocessable } from '../../common/http/domain-error.js';
import type { AuthContext } from '../../common/tenancy/request-context.js';
import { TenantDb } from '../../common/tenancy/tenant-db.service.js';
import { Clock } from '../../common/time/clock.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { Tx } from '../../prisma/prisma.service.js';
import { StaffService } from '../staff/staff.service.js';
import type { ProductView, StockMovementView } from './products.responses.js';
import type {
  CreateProductInput,
  ListProductsQuery,
  StockAdjustmentInput,
  StockEntryInput,
  UpdateProductInput,
} from './products.schemas.js';

const productSelect = {
  id: true,
  name: true,
  description: true,
  priceCents: true,
  costCents: true,
  stockQuantity: true,
  minStockQuantity: true,
  active: true,
} as const;

type ProductRow = Prisma.ProductGetPayload<{ select: typeof productSelect }>;

/** Produto a vender numa comanda (snapshot de nome e preço vai para o item). */
export interface ProductForSale {
  id: string;
  name: string;
  priceCents: number;
}

export interface SoldProduct {
  productId: string;
  quantity: number;
}

const canManage = (auth: AuthContext) => auth.permissions.includes('products:manage');

const insufficientStock = (name: string, available: number) =>
  unprocessable(
    'insufficient-stock',
    `Estoque insuficiente de ${name}: ${available === 1 ? 'resta 1 unidade' : `restam ${available} unidades`}.`,
  );

/**
 * Produtos e estoque (business-rules §7). O saldo só muda por movimentação (entrada,
 * venda, estorno de venda, ajuste), aplicada por trigger no banco, que também impede
 * saldo negativo. Aqui a checagem prévia existe só para dar uma mensagem clara.
 */
@Injectable()
export class ProductsService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(StaffService) private readonly staff: StaffService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  list(query: ListProductsQuery): Promise<ProductView[]> {
    return this.db.run(async (tx, auth) => {
      const rows = await tx.product.findMany({
        where: { barbershopId: auth.barbershopId, ...(query.includeInactive ? {} : { active: true }) },
        select: productSelect,
        orderBy: { name: 'asc' },
      });
      const values = canManage(auth) ? await this.stockValues(tx, auth.barbershopId) : null;
      return rows.map((row) => toView(row, auth, values));
    });
  }

  get(productId: string): Promise<ProductView> {
    return this.db.run((tx, auth) => this.view(tx, auth, productId));
  }

  create(input: CreateProductInput): Promise<ProductView> {
    return this.db.run(async (tx, auth) => {
      const row = await tx.product.create({
        data: { ...input, barbershopId: auth.barbershopId },
        select: productSelect,
      });
      return toView(row, auth, new Map());
    });
  }

  update(productId: string, input: UpdateProductInput): Promise<ProductView> {
    return this.db.run(async (tx, auth) => {
      await this.find(tx, auth.barbershopId, productId);
      await tx.product.update({ where: { id: productId }, data: input, select: { id: true } });
      return this.view(tx, auth, productId);
    });
  }

  movements(productId: string): Promise<StockMovementView[]> {
    return this.db.run(async (tx, auth) => {
      await this.find(tx, auth.barbershopId, productId);
      const rows = await tx.stockMovement.findMany({
        where: { barbershopId: auth.barbershopId, productId },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: 100,
      });
      const names = await this.staff.namesByUser(tx, auth.barbershopId, [
        ...new Set(rows.map((row) => row.authorUserId)),
      ]);
      return rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        quantity: row.quantity,
        unitCostCents: row.unitCostCents,
        reason: row.reason,
        orderId: row.orderId,
        author: { id: row.authorUserId, name: names.get(row.authorUserId) ?? '—' },
        occurredAt: row.occurredAt,
      }));
    });
  }

  /** Entrada de mercadoria: soma ao saldo e passa a ser o custo de referência. */
  addEntry(productId: string, input: StockEntryInput): Promise<ProductView> {
    return this.db.run(async (tx, auth) => {
      await this.find(tx, auth.barbershopId, productId);
      await tx.stockMovement.create({
        data: {
          barbershopId: auth.barbershopId,
          productId,
          kind: 'ENTRY',
          quantity: input.quantity,
          unitCostCents: input.unitCostCents,
          reason: input.note,
          authorUserId: auth.userId,
          occurredAt: this.clock.now(),
        },
      });
      await tx.product.update({ where: { id: productId }, data: { costCents: input.unitCostCents } });
      return this.view(tx, auth, productId);
    });
  }

  /** Ajuste de inventário (perda, quebra, contagem). Nunca deixa o saldo negativo. */
  adjust(productId: string, input: StockAdjustmentInput): Promise<ProductView> {
    return this.db.run(async (tx, auth) => {
      const [product] = await this.lockForUpdate(tx, auth.barbershopId, [productId]);
      if (!product) throw notFound('Produto');
      if (product.stockQuantity + input.quantity < 0) {
        throw insufficientStock(product.name, product.stockQuantity);
      }
      await tx.stockMovement.create({
        data: {
          barbershopId: auth.barbershopId,
          productId,
          kind: 'ADJUSTMENT',
          quantity: input.quantity,
          unitCostCents: product.costCents,
          reason: input.reason,
          authorUserId: auth.userId,
          occurredAt: this.clock.now(),
        },
      });
      return this.view(tx, auth, productId);
    });
  }

  // ───────────── Para outros módulos (comanda, comissões), na transação deles ─────────────

  /** Produtos ativos pedidos numa comanda. 422 se algum não existir aqui ou estiver inativo. */
  async productsForSale(tx: Tx, barbershopId: string, productIds: string[]): Promise<ProductForSale[]> {
    const rows = await tx.product.findMany({
      where: { barbershopId, id: { in: productIds }, active: true },
      select: { id: true, name: true, priceCents: true },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return productIds.map((id) => {
      const product = byId.get(id);
      if (!product) throw unprocessable('invalid-product', 'Produto inexistente ou inativo.');
      return product;
    });
  }

  async assertExists(tx: Tx, barbershopId: string, productId: string): Promise<void> {
    await this.find(tx, barbershopId, productId);
  }

  /**
   * Baixa do estoque no fechamento da comanda: trava os produtos (ordem por id, sem
   * deadlock entre fechamentos simultâneos), confere o saldo e lança as vendas.
   */
  async recordSale(
    tx: Tx,
    barbershopId: string,
    sale: { orderId: string; items: SoldProduct[]; authorUserId: string; occurredAt: Date },
  ): Promise<void> {
    const totals = new Map<string, number>();
    for (const item of sale.items)
      totals.set(item.productId, (totals.get(item.productId) ?? 0) + item.quantity);
    if (totals.size === 0) return;

    const products = await this.lockForUpdate(tx, barbershopId, [...totals.keys()]);
    for (const product of products) {
      const quantity = totals.get(product.id)!;
      if (product.stockQuantity < quantity) throw insufficientStock(product.name, product.stockQuantity);
    }
    for (const product of products) {
      await tx.stockMovement.create({
        data: {
          barbershopId,
          productId: product.id,
          kind: 'SALE',
          quantity: -totals.get(product.id)!,
          unitCostCents: product.costCents,
          orderId: sale.orderId,
          authorUserId: sale.authorUserId,
          occurredAt: sale.occurredAt,
        },
      });
    }
  }

  /** Estorno da comanda: devolve ao estoque o que a venda tirou, ao mesmo custo. */
  async recordSaleReversal(
    tx: Tx,
    barbershopId: string,
    reversal: { orderId: string; authorUserId: string; occurredAt: Date },
  ): Promise<void> {
    const sales = await tx.stockMovement.findMany({
      where: { barbershopId, orderId: reversal.orderId, kind: 'SALE' },
      orderBy: { productId: 'asc' },
    });
    for (const sale of sales) {
      await tx.stockMovement.create({
        data: {
          barbershopId,
          productId: sale.productId,
          kind: 'SALE_REVERSAL',
          quantity: -sale.quantity,
          unitCostCents: sale.unitCostCents,
          orderId: reversal.orderId,
          authorUserId: reversal.authorUserId,
          occurredAt: reversal.occurredAt,
        },
      });
    }
  }

  // ───────────── Interno ─────────────

  private async view(tx: Tx, auth: AuthContext, productId: string): Promise<ProductView> {
    const row = await this.find(tx, auth.barbershopId, productId);
    const values = canManage(auth) ? await this.stockValues(tx, auth.barbershopId, productId) : null;
    return toView(row, auth, values);
  }

  private async find(tx: Tx, barbershopId: string, productId: string): Promise<ProductRow> {
    const row = await tx.product.findFirst({ where: { id: productId, barbershopId }, select: productSelect });
    if (!row) throw notFound('Produto');
    return row;
  }

  private async lockForUpdate(tx: Tx, barbershopId: string, productIds: string[]) {
    const rows = await tx.$queryRaw<
      { id: string; name: string; stock_quantity: number; cost_cents: number }[]
    >`
      SELECT id, name, stock_quantity, cost_cents FROM products
       WHERE barbershop_id = ${barbershopId}::uuid AND id = ANY(${productIds}::uuid[])
       ORDER BY id
       FOR UPDATE`;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      stockQuantity: row.stock_quantity,
      costCents: row.cost_cents,
    }));
  }

  /** Valor do estoque por produto: Σ quantidade × custo das movimentações (pode ser negativo). */
  private async stockValues(tx: Tx, barbershopId: string, productId?: string): Promise<Map<string, number>> {
    const rows = await tx.$queryRaw<{ product_id: string; value: bigint }[]>`
      SELECT product_id, SUM(quantity::bigint * unit_cost_cents)::bigint AS value
        FROM stock_movements
       WHERE barbershop_id = ${barbershopId}::uuid
         AND (${productId ?? null}::uuid IS NULL OR product_id = ${productId ?? null}::uuid)
       GROUP BY product_id`;
    return new Map(rows.map((row) => [row.product_id, Number(row.value)]));
  }
}

function toView(row: ProductRow, auth: AuthContext, values: Map<string, number> | null): ProductView {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    priceCents: row.priceCents,
    costCents: canManage(auth) ? row.costCents : null,
    stockQuantity: row.stockQuantity,
    minStockQuantity: row.minStockQuantity,
    lowStock: row.minStockQuantity !== null && row.stockQuantity <= row.minStockQuantity,
    stockValueCents: values ? (values.get(row.id) ?? 0) : null,
    active: row.active,
  };
}
