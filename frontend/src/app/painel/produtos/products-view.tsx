'use client';

import { useState } from 'react';
import { History, PackagePlus, Pencil, Plus, SlidersHorizontal, TriangleAlert } from 'lucide-react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { CommissionRules } from '@/components/commission-rules';
import { Field } from '@/components/form/field';
import { MoneyInput } from '@/components/money-input';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { errorMessage } from '@/lib/api/errors';
import { formatDateTime, formatMoney } from '@/lib/format';
import { zodResolver } from '@/lib/forms/zod-resolver';
import { can } from '@/lib/permissions';
import {
  useBarbershop,
  useCreateProduct,
  useProductMovements,
  useProducts,
  useStockAdjustment,
  useStockEntry,
  useUpdateProduct,
  type Product,
  type StockMovement,
} from '@/lib/queries';
import { useAuthenticatedSession } from '@/lib/session/use-session';
import { cn } from '@/lib/utils';

type Dialogs =
  | { kind: 'none' }
  | { kind: 'form'; product?: Product }
  | { kind: 'entry' | 'adjust' | 'history'; product: Product };

const MOVEMENT_LABEL: Record<StockMovement['kind'], string> = {
  ENTRY: 'Entrada',
  SALE: 'Venda',
  SALE_REVERSAL: 'Estorno de venda',
  ADJUSTMENT: 'Ajuste',
};

/** Produtos e estoque (business-rules §7): saldo nunca negativo, histórico de movimentações. */
export function ProductsView() {
  const session = useAuthenticatedSession();
  const canManage = can(session, 'products:manage');
  const canManageCommissions = can(session, 'services:manage');
  const [showInactive, setShowInactive] = useState(false);
  const products = useProducts(showInactive);
  const allProducts = useProducts(true);
  const [dialog, setDialog] = useState<Dialogs>({ kind: 'none' });
  const close = () => setDialog({ kind: 'none' });

  const list = products.data ?? [];
  const lowStock = list.filter((product) => product.active && product.lowStock);
  const stockValue = list.reduce((sum, product) => sum + (product.stockValueCents ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Produtos"
        description="Saldo atualizado a cada venda, entrada e ajuste. O estoque nunca fica negativo."
        actions={
          canManage && (
            <Button onClick={() => setDialog({ kind: 'form' })}>
              <Plus aria-hidden /> Novo produto
            </Button>
          )
        }
      />

      {lowStock.length > 0 && (
        <Alert className="mb-4">
          <TriangleAlert aria-hidden />
          <AlertDescription>
            {lowStock.length === 1 ? 'Repor estoque de ' : `Repor estoque de ${lowStock.length} produtos: `}
            {lowStock.map((product) => product.name).join(', ')}.
          </AlertDescription>
        </Alert>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Switch id="show-inactive" checked={showInactive} onCheckedChange={setShowInactive} />
          <Label htmlFor="show-inactive">Mostrar desativados</Label>
        </div>
        {canManage && products.data && (
          <p className="text-muted-foreground text-sm">
            Valor em estoque (custo): <strong className="text-foreground">{formatMoney(stockValue)}</strong>
          </p>
        )}
      </div>

      {products.isLoading ? (
        <LoadingRows rows={4} />
      ) : products.error ? (
        <ErrorState error={products.error} onRetry={() => products.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState title="Nenhum produto">
          {canManage
            ? 'Cadastre os produtos que você vende na comanda.'
            : 'A barbearia ainda não cadastrou produtos.'}
        </EmptyState>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produto</TableHead>
              <TableHead className="text-right">Preço</TableHead>
              <TableHead className="text-right">Estoque</TableHead>
              {canManage && <TableHead className="hidden text-right md:table-cell">Custo</TableHead>}
              {canManage && (
                <TableHead className="hidden text-right md:table-cell">Valor em estoque</TableHead>
              )}
              {canManage && (
                <TableHead className="w-40">
                  <span className="sr-only">Ações</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((product) => (
              <TableRow key={product.id} className={cn(!product.active && 'opacity-60')}>
                <TableCell>
                  <span className="font-medium">{product.name}</span>
                  {!product.active && (
                    <Badge variant="outline" className="ml-2">
                      Desativado
                    </Badge>
                  )}
                  {product.description && (
                    <p className="text-muted-foreground text-xs">{product.description}</p>
                  )}
                </TableCell>
                <TableCell className="text-right">{formatMoney(product.priceCents)}</TableCell>
                <TableCell className="text-right">
                  <span className="font-medium">{product.stockQuantity}</span>
                  {product.lowStock && (
                    <Badge variant="destructive" className="ml-2">
                      <TriangleAlert aria-hidden /> Repor
                    </Badge>
                  )}
                  {product.minStockQuantity !== null && (
                    <p className="text-muted-foreground text-xs">mín. {product.minStockQuantity}</p>
                  )}
                </TableCell>
                {canManage && (
                  <TableCell className="hidden text-right md:table-cell">
                    {formatMoney(product.costCents ?? 0)}
                  </TableCell>
                )}
                {canManage && (
                  <TableCell className="hidden text-right md:table-cell">
                    {formatMoney(product.stockValueCents ?? 0)}
                  </TableCell>
                )}
                {canManage && (
                  <TableCell className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Entrada de ${product.name}`}
                      onClick={() => setDialog({ kind: 'entry', product })}
                    >
                      <PackagePlus />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Ajustar estoque de ${product.name}`}
                      onClick={() => setDialog({ kind: 'adjust', product })}
                    >
                      <SlidersHorizontal />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Histórico de ${product.name}`}
                      onClick={() => setDialog({ kind: 'history', product })}
                    >
                      <History />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Editar ${product.name}`}
                      onClick={() => setDialog({ kind: 'form', product })}
                    >
                      <Pencil />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {canManageCommissions && <CommissionRules target="product" items={allProducts.data ?? []} />}

      <Dialog open={dialog.kind !== 'none'} onOpenChange={(open) => !open && close()}>
        <DialogContent className={cn(dialog.kind === 'history' && 'sm:max-w-2xl')}>
          {dialog.kind === 'form' && <ProductForm product={dialog.product} onDone={close} />}
          {dialog.kind === 'entry' && <EntryForm product={dialog.product} onDone={close} />}
          {dialog.kind === 'adjust' && <AdjustForm product={dialog.product} onDone={close} />}
          {dialog.kind === 'history' && <MovementHistory product={dialog.product} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

const productSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome.').max(100),
  description: z.string().max(500),
  priceCents: z.number({ error: 'Informe o preço.' }).int().min(0),
  costCents: z.number().int().min(0).nullable(),
  minStock: z.string().regex(/^\d*$/, 'Use um número inteiro.'),
  active: z.boolean(),
});

function ProductForm({ product, onDone }: { product?: Product; onDone: () => void }) {
  const create = useCreateProduct();
  const update = useUpdateProduct();
  const form = useForm({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name: product?.name ?? '',
      description: product?.description ?? '',
      priceCents: product?.priceCents ?? (null as unknown as number),
      costCents: product?.costCents ?? null,
      minStock: product?.minStockQuantity?.toString() ?? '',
      active: product?.active ?? true,
    },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    const body = {
      name: values.name,
      description: values.description || null,
      priceCents: values.priceCents,
      costCents: values.costCents ?? 0,
      minStockQuantity: values.minStock === '' ? null : Number(values.minStock),
    };
    try {
      if (product) await update.mutateAsync({ id: product.id, ...body, active: values.active });
      else await create.mutateAsync(body);
      toast.success('Produto salvo.');
      onDone();
    } catch (error) {
      form.setError('root', { message: errorMessage(error) });
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle className="font-heading text-2xl uppercase">
          {product ? 'Editar produto' : 'Novo produto'}
        </DialogTitle>
        <DialogDescription>
          {product
            ? 'O estoque não muda por aqui: use entrada ou ajuste.'
            : 'O produto começa com estoque zero; registre a primeira entrada depois.'}
        </DialogDescription>
      </DialogHeader>
      {errors.root && (
        <Alert variant="destructive">
          <AlertDescription>{errors.root.message}</AlertDescription>
        </Alert>
      )}
      <Field label="Nome" error={errors.name?.message}>
        <Input autoFocus {...form.register('name')} />
      </Field>
      <Field label="Descrição (opcional)">
        <Input {...form.register('description')} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Controller
          control={form.control}
          name="priceCents"
          render={({ field }) => (
            <Field label="Preço de venda" error={errors.priceCents?.message}>
              <MoneyInput value={field.value} onChange={field.onChange} />
            </Field>
          )}
        />
        <Controller
          control={form.control}
          name="costCents"
          render={({ field }) => (
            <Field label="Custo por unidade" hint="Atualizado a cada entrada.">
              <MoneyInput value={field.value} onChange={field.onChange} />
            </Field>
          )}
        />
      </div>
      <Field
        label="Estoque mínimo (opcional)"
        hint="No mínimo ou abaixo, o produto aparece para repor."
        error={errors.minStock?.message}
      >
        <Input inputMode="numeric" {...form.register('minStock')} />
      </Field>
      {product && (
        <Controller
          control={form.control}
          name="active"
          render={({ field }) => (
            <div className="flex items-center gap-2">
              <Switch id="product-active" checked={field.value} onCheckedChange={field.onChange} />
              <Label htmlFor="product-active">Ativo (aparece para venda na comanda)</Label>
            </div>
          )}
        />
      )}
      <Button type="submit" disabled={isSubmitting}>
        Salvar
      </Button>
    </form>
  );
}

const entrySchema = z.object({
  quantity: z.string().regex(/^[1-9]\d{0,3}$/, 'Informe a quantidade (1 a 9999).'),
  unitCostCents: z.number({ error: 'Informe o custo.' }).int().min(0),
  note: z.string().max(200),
});

function EntryForm({ product, onDone }: { product: Product; onDone: () => void }) {
  const entry = useStockEntry();
  const form = useForm({
    resolver: zodResolver(entrySchema),
    defaultValues: { quantity: '', unitCostCents: product.costCents ?? 0, note: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await entry.mutateAsync({
        id: product.id,
        quantity: Number(values.quantity),
        unitCostCents: values.unitCostCents,
        note: values.note || undefined,
      });
      toast.success('Entrada registrada.');
      onDone();
    } catch (error) {
      form.setError('root', { message: errorMessage(error) });
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle className="font-heading text-2xl uppercase">Entrada de mercadoria</DialogTitle>
        <DialogDescription>
          {product.name} · saldo atual {product.stockQuantity}
        </DialogDescription>
      </DialogHeader>
      {errors.root && (
        <Alert variant="destructive">
          <AlertDescription>{errors.root.message}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Quantidade" error={errors.quantity?.message}>
          <Input autoFocus inputMode="numeric" {...form.register('quantity')} />
        </Field>
        <Controller
          control={form.control}
          name="unitCostCents"
          render={({ field }) => (
            <Field label="Custo por unidade" error={errors.unitCostCents?.message}>
              <MoneyInput value={field.value} onChange={field.onChange} />
            </Field>
          )}
        />
      </div>
      <Field label="Observação (opcional)" hint="Ex.: nota fiscal, fornecedor.">
        <Input {...form.register('note')} />
      </Field>
      <Button type="submit" disabled={isSubmitting}>
        Registrar entrada
      </Button>
    </form>
  );
}

const adjustSchema = z.object({
  direction: z.enum(['out', 'in']),
  quantity: z.string().regex(/^[1-9]\d{0,3}$/, 'Informe a quantidade (1 a 9999).'),
  reason: z.string().trim().min(3, 'Informe o motivo do ajuste.').max(200),
});

function AdjustForm({ product, onDone }: { product: Product; onDone: () => void }) {
  const adjust = useStockAdjustment();
  const form = useForm({
    resolver: zodResolver(adjustSchema),
    defaultValues: { direction: 'out' as 'out' | 'in', quantity: '', reason: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    const quantity = Number(values.quantity) * (values.direction === 'out' ? -1 : 1);
    try {
      await adjust.mutateAsync({ id: product.id, quantity, reason: values.reason });
      toast.success('Ajuste registrado.');
      onDone();
    } catch (error) {
      form.setError('root', { message: errorMessage(error) });
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle className="font-heading text-2xl uppercase">Ajuste de estoque</DialogTitle>
        <DialogDescription>
          {product.name} · saldo atual {product.stockQuantity}. Use para perda, quebra ou contagem.
        </DialogDescription>
      </DialogHeader>
      {errors.root && (
        <Alert variant="destructive">
          <AlertDescription>{errors.root.message}</AlertDescription>
        </Alert>
      )}
      <Controller
        control={form.control}
        name="direction"
        render={({ field }) => (
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Tipo</legend>
            <div className="grid grid-cols-2 gap-2" role="radiogroup">
              {(
                [
                  ['out', 'Retirar do estoque'],
                  ['in', 'Acrescentar ao estoque'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={field.value === value}
                  onClick={() => field.onChange(value)}
                  className={cn(
                    'border-border hover:bg-accent rounded-md border px-3 py-2 text-sm',
                    'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                    field.value === value && 'border-primary bg-accent font-medium',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
        )}
      />
      <Field label="Quantidade" error={errors.quantity?.message}>
        <Input inputMode="numeric" {...form.register('quantity')} />
      </Field>
      <Field label="Motivo" error={errors.reason?.message}>
        <Input placeholder="Ex.: embalagem danificada" {...form.register('reason')} />
      </Field>
      <Button type="submit" disabled={isSubmitting}>
        Registrar ajuste
      </Button>
    </form>
  );
}

function MovementHistory({ product }: { product: Product }) {
  const movements = useProductMovements(product.id);
  const timezone = useBarbershop().data?.timezone ?? 'America/Sao_Paulo';

  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle className="font-heading text-2xl uppercase">Histórico</DialogTitle>
        <DialogDescription>
          {product.name} · saldo atual {product.stockQuantity} (soma das movimentações)
        </DialogDescription>
      </DialogHeader>
      {movements.isLoading ? (
        <LoadingRows rows={4} />
      ) : movements.error ? (
        <ErrorState error={movements.error} onRetry={() => movements.refetch()} />
      ) : movements.data!.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nenhuma movimentação ainda.</p>
      ) : (
        <div className="max-h-[60dvh] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quando</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Qtd.</TableHead>
                <TableHead className="hidden sm:table-cell">Por</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements.data!.map((movement) => (
                <TableRow key={movement.id}>
                  <TableCell className="text-sm whitespace-nowrap">
                    {formatDateTime(movement.occurredAt, timezone)}
                  </TableCell>
                  <TableCell>
                    {MOVEMENT_LABEL[movement.kind]}
                    {movement.reason && <p className="text-muted-foreground text-xs">{movement.reason}</p>}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {movement.quantity > 0 ? `+${movement.quantity}` : movement.quantity}
                  </TableCell>
                  <TableCell className="hidden text-sm sm:table-cell">{movement.author.name}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
