'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ArrowLeft, Package, Plus, Ticket, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { MoneyInput } from '@/components/money-input';
import { ErrorState, LoadingRows, PageHeader } from '@/components/states';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/lib/api/errors';
import { formatDateTime, formatMoney } from '@/lib/format';
import { PAYMENT_METHODS, paymentLabel } from '@/lib/payment-methods';
import { can } from '@/lib/permissions';
import {
  useAddOrderItem,
  useApplyPackage,
  useBarbershop,
  useClientPackages,
  useCloseOrder,
  useOrder,
  usePackages,
  useProducts,
  useRemoveOrderItem,
  useServices,
  useStaff,
  useUpdateOrderItem,
  useVoidOrder,
  type ClientPackage,
  type Order,
  type PaymentMethod,
} from '@/lib/queries';
import { useAuthenticatedSession } from '@/lib/session/use-session';
import { cn } from '@/lib/utils';

const STATUS_LABEL: Record<Order['status'], { label: string; variant: 'default' | 'secondary' | 'outline' }> =
  {
    OPEN: { label: 'Aberta', variant: 'default' },
    CLOSED: { label: 'Fechada', variant: 'secondary' },
    VOIDED: { label: 'Estornada', variant: 'outline' },
  };

export function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const order = useOrder(id);
  const barbershop = useBarbershop();
  const timezone = barbershop.data?.timezone ?? 'America/Sao_Paulo';

  if (order.isLoading) return <LoadingRows rows={6} label="Carregando comanda" />;
  if (order.error) return <ErrorState error={order.error} onRetry={() => order.refetch()} />;
  const data = order.data!;
  const status = STATUS_LABEL[data.status];

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
        <Link href="/painel/comandas">
          <ArrowLeft aria-hidden /> Comandas
        </Link>
      </Button>
      <PageHeader
        title={data.client?.name ?? 'Cliente balcão'}
        description={`Aberta em ${formatDateTime(data.createdAt, timezone)}`}
        actions={
          <Badge variant={status.variant} className="text-sm">
            {status.label}
          </Badge>
        }
      />

      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <section aria-label="Itens">
          <Items order={data} />
          {data.status === 'OPEN' && <AddItem orderId={data.id} hasClient={Boolean(data.client)} />}
        </section>
        <aside>
          {data.status === 'OPEN' && <CloseOrder order={data} />}
          {data.status === 'CLOSED' && <ClosedSummary order={data} timezone={timezone} />}
          {data.status === 'VOIDED' && (
            <Alert>
              <AlertTitle>Comanda estornada</AlertTitle>
              <AlertDescription>
                {data.voidedAt && `${formatDateTime(data.voidedAt, timezone)} · `}
                {data.voidReason}
              </AlertDescription>
            </Alert>
          )}
        </aside>
      </div>
    </>
  );
}

function Items({ order }: { order: Order }) {
  const session = useAuthenticatedSession();
  const update = useUpdateOrderItem(order.id);
  const remove = useRemoveOrderItem(order.id);
  const open = order.status === 'OPEN';
  const commissionTotal = order.items.reduce((sum, item) => sum + item.commissionCents, 0);
  // Pacotes ativos do cliente: só numa comanda aberta, com cliente identificado.
  const clientPackages = useClientPackages(
    { clientId: order.client?.id, status: 'ACTIVE' },
    open && Boolean(order.client) && can(session, 'packages:read'),
  );
  const packageName = (clientPackageId: string) =>
    clientPackages.data?.find((candidate) => candidate.id === clientPackageId)?.name ?? 'pacote';

  if (order.items.length === 0) {
    return (
      <p className="text-muted-foreground py-6 text-sm">
        Nenhum item. Adicione os serviços realizados e os produtos vendidos.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Item</TableHead>
          <TableHead className="w-20 text-right">Qtd.</TableHead>
          <TableHead className="w-32 text-right">Desconto</TableHead>
          <TableHead className="text-right">Total</TableHead>
          <TableHead className="hidden text-right sm:table-cell">
            Comissão{open && <span className="text-muted-foreground font-normal"> (prevista)</span>}
          </TableHead>
          {open && (
            <TableHead className="w-10">
              <span className="sr-only">Remover</span>
            </TableHead>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {order.items.map((item) => (
          <TableRow key={item.id}>
            <TableCell>
              <span className="font-medium">{item.name}</span>
              {item.kind === 'PRODUCT' && (
                <Badge variant="outline" className="ml-2">
                  <Package aria-hidden /> Produto
                </Badge>
              )}
              {item.kind === 'PACKAGE' && (
                <Badge variant="outline" className="ml-2">
                  <Ticket aria-hidden /> Pacote
                </Badge>
              )}
              {item.clientPackageId && (
                <Badge variant="secondary" className="ml-2">
                  <Ticket aria-hidden /> Sessão de {open ? packageName(item.clientPackageId) : 'pacote'}
                </Badge>
              )}
              <p className="text-muted-foreground text-xs">
                {item.kind === 'PACKAGE' ? 'Venda de pacote' : (item.professional?.name ?? 'Balcão')} ·{' '}
                {formatMoney(item.unitPriceCents)}
              </p>
              {open && item.kind === 'SERVICE' && order.client && clientPackages.data && (
                <PackageUse orderId={order.id} item={item} packages={clientPackages.data} />
              )}
            </TableCell>
            <TableCell className="text-right">
              {open && item.kind !== 'PACKAGE' ? (
                <Input
                  aria-label={`Quantidade de ${item.name}`}
                  type="number"
                  min={1}
                  max={20}
                  defaultValue={item.quantity}
                  className="ml-auto w-16 text-right"
                  onBlur={(event) => {
                    const quantity = Number(event.target.value);
                    if (quantity !== item.quantity && quantity >= 1) {
                      update.mutate(
                        { itemId: item.id, quantity },
                        { onError: (error) => toast.error(errorMessage(error)) },
                      );
                    }
                  }}
                />
              ) : (
                item.quantity
              )}
            </TableCell>
            <TableCell className="text-right">
              {open && !item.clientPackageId ? (
                <DiscountInput
                  label={`Desconto em ${item.name}`}
                  cents={item.discountCents}
                  onCommit={(discountCents) =>
                    update.mutate(
                      { itemId: item.id, discountCents },
                      { onError: (error) => toast.error(errorMessage(error)) },
                    )
                  }
                />
              ) : item.discountCents > 0 ? (
                `− ${formatMoney(item.discountCents)}`
              ) : (
                '—'
              )}
            </TableCell>
            <TableCell className="text-right font-medium">{formatMoney(item.totalCents)}</TableCell>
            <TableCell className="text-muted-foreground hidden text-right sm:table-cell">
              {formatMoney(item.commissionCents)}
            </TableCell>
            {open && (
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remover ${item.name}`}
                  disabled={remove.isPending}
                  onClick={() =>
                    remove.mutate(item.id, { onError: (error) => toast.error(errorMessage(error)) })
                  }
                >
                  <Trash2 />
                </Button>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell colSpan={3} className="font-heading text-lg uppercase">
            Total
          </TableCell>
          <TableCell className="text-right text-lg font-bold">{formatMoney(order.totalCents)}</TableCell>
          <TableCell className="text-muted-foreground hidden text-right sm:table-cell">
            {formatMoney(commissionTotal)}
          </TableCell>
          {open && <TableCell />}
        </TableRow>
      </TableFooter>
    </Table>
  );
}

/**
 * Paga o serviço com sessão de um pacote do cliente (o item fica R$ 0) ou volta a cobrar.
 * Só oferece pacotes que incluem o serviço e ainda têm saldo; a API confere tudo de novo.
 */
function PackageUse({
  orderId,
  item,
  packages,
}: {
  orderId: string;
  item: Order['items'][number];
  packages: ClientPackage[];
}) {
  const apply = useApplyPackage(orderId);
  const usable = packages.filter((candidate) =>
    candidate.balances.some((balance) => balance.serviceId === item.serviceId && balance.remaining > 0),
  );
  const run = (clientPackageId: string | null) =>
    apply.mutate(
      { itemId: item.id, clientPackageId },
      {
        onSuccess: () =>
          toast.success(clientPackageId ? 'Sessão do pacote aplicada.' : 'Item volta a ser cobrado.'),
        onError: (error) => toast.error(errorMessage(error)),
      },
    );

  if (item.clientPackageId) {
    return (
      <Button
        variant="link"
        size="sm"
        className="h-auto px-0"
        disabled={apply.isPending}
        onClick={() => run(null)}
      >
        Não usar pacote
      </Button>
    );
  }
  if (usable.length === 0) return null;
  return (
    <div className="mt-1 max-w-64">
      <Select value="" onValueChange={run} disabled={apply.isPending}>
        <SelectTrigger size="sm" aria-label={`Usar pacote em ${item.name}`} className="w-full">
          <SelectValue placeholder="Usar sessão de pacote" />
        </SelectTrigger>
        <SelectContent>
          {usable.map((candidate) => {
            const balance = candidate.balances.find((entry) => entry.serviceId === item.serviceId)!;
            return (
              <SelectItem key={candidate.id} value={candidate.id}>
                {candidate.name} · {balance.remaining} de {balance.initialQuantity}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Edita o desconto em reais e só grava ao sair do campo (uma requisição por edição). */
function DiscountInput({
  label,
  cents,
  onCommit,
}: {
  label: string;
  cents: number;
  onCommit: (cents: number) => void;
}) {
  const [value, setValue] = useState<number | null>(cents);
  return (
    <MoneyInput
      aria-label={label}
      value={value}
      className="pl-9 text-right"
      onChange={setValue}
      onBlur={() => {
        const next = value ?? 0;
        if (next !== cents) onCommit(next);
      }}
    />
  );
}

/** Venda de produto sem profissional: balcão, sem comissão (business-rules §4). */
const COUNTER = '__balcao__';

type ItemKind = 'service' | 'product' | 'package';

function AddItem({ orderId, hasClient }: { orderId: string; hasClient: boolean }) {
  const session = useAuthenticatedSession();
  const canSellProducts = can(session, 'products:read');
  const canSellPackages = can(session, 'packages:read');
  const services = useServices();
  const products = useProducts(false);
  const packages = usePackages(false, canSellPackages);
  const staff = useStaff();
  const add = useAddOrderItem(orderId);
  const [kind, setKind] = useState<ItemKind>('service');
  const [itemId, setItemId] = useState('');
  const [professionalId, setProfessionalId] = useState('');
  const professionals = (staff.data ?? []).filter((member) => member.isProfessional && member.active);
  const isProduct = kind === 'product';
  const isPackage = kind === 'package';
  const kinds: [ItemKind, string][] = [
    ['service', 'Serviço'],
    ...(canSellProducts ? [['product', 'Produto'] as [ItemKind, string]] : []),
    ...(canSellPackages ? [['package', 'Pacote'] as [ItemKind, string]] : []),
  ];

  const switchKind = (next: ItemKind) => {
    setKind(next);
    setItemId('');
    setProfessionalId(next === 'product' ? COUNTER : '');
  };

  const submit = async () => {
    if (!itemId || (!isPackage && !professionalId)) {
      toast.error(
        isProduct
          ? 'Escolha o produto.'
          : isPackage
            ? 'Escolha o pacote.'
            : 'Escolha o serviço e quem atendeu.',
      );
      return;
    }
    try {
      await add.mutateAsync(
        isPackage
          ? { packageId: itemId, quantity: 1, discountCents: 0 }
          : isProduct
            ? {
                productId: itemId,
                professionalId: professionalId === COUNTER ? null : professionalId,
                quantity: 1,
                discountCents: 0,
              }
            : { serviceId: itemId, professionalId, quantity: 1, discountCents: 0 },
      );
      setItemId('');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="border-border mt-4 grid gap-3 rounded-lg border border-dashed p-4">
      {kinds.length > 1 && (
        <div className="flex gap-2" role="radiogroup" aria-label="Tipo de item">
          {kinds.map(([value, label]) => (
            <Button
              key={value}
              type="button"
              size="sm"
              role="radio"
              aria-checked={kind === value}
              variant={kind === value ? 'default' : 'outline'}
              onClick={() => switchKind(value)}
            >
              {label}
            </Button>
          ))}
        </div>
      )}
      {isPackage && !hasClient ? (
        <p className="text-muted-foreground text-sm">
          Pacote é do cliente que comprou: abra a comanda com o cliente identificado para vender um pacote.
        </p>
      ) : (
        <div
          className={cn(
            'grid gap-3 sm:items-end',
            isPackage ? 'sm:grid-cols-[1fr_auto]' : 'sm:grid-cols-[1fr_1fr_auto]',
          )}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="add-item">{isProduct ? 'Produto' : isPackage ? 'Pacote' : 'Serviço'}</Label>
            <Select value={itemId} onValueChange={setItemId}>
              <SelectTrigger id="add-item" className="w-full">
                <SelectValue placeholder="Escolha" />
              </SelectTrigger>
              <SelectContent>
                {isPackage
                  ? packages.data?.map((servicePackage) => (
                      <SelectItem key={servicePackage.id} value={servicePackage.id}>
                        {servicePackage.name} · {formatMoney(servicePackage.priceCents)} ·{' '}
                        {servicePackage.validityDays} dias
                      </SelectItem>
                    ))
                  : isProduct
                    ? products.data?.map((product) => (
                        <SelectItem key={product.id} value={product.id} disabled={product.stockQuantity < 1}>
                          {product.name} · {formatMoney(product.priceCents)} ·{' '}
                          {product.stockQuantity < 1 ? 'sem estoque' : `${product.stockQuantity} em estoque`}
                        </SelectItem>
                      ))
                    : services.data?.map((service) => (
                        <SelectItem key={service.id} value={service.id}>
                          {service.name} · {formatMoney(service.priceCents)}
                        </SelectItem>
                      ))}
              </SelectContent>
            </Select>
          </div>
          {!isPackage && (
            <div className="grid gap-1.5">
              <Label htmlFor="add-professional">{isProduct ? 'Quem vendeu' : 'Quem atendeu'}</Label>
              <Select value={professionalId} onValueChange={setProfessionalId}>
                <SelectTrigger id="add-professional" className="w-full">
                  <SelectValue placeholder="Escolha" />
                </SelectTrigger>
                <SelectContent>
                  {isProduct && <SelectItem value={COUNTER}>Balcão (sem comissão)</SelectItem>}
                  {professionals.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <Button variant="outline" onClick={submit} disabled={add.isPending}>
            <Plus aria-hidden /> Adicionar
          </Button>
        </div>
      )}
    </div>
  );
}

function CloseOrder({ order }: { order: Order }) {
  const close = useCloseOrder(order.id);
  const [method, setMethod] = useState<PaymentMethod | null>(null);

  const submit = async () => {
    if (!method) return;
    try {
      await close.mutateAsync({ paymentMethod: method });
      toast.success('Comanda fechada. Comissões lançadas.');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="bg-card border-border grid gap-4 rounded-lg border p-4 lg:sticky lg:top-6">
      <p className="font-heading text-xl font-semibold uppercase">Fechar comanda</p>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Forma de pagamento</legend>
        <div className="grid grid-cols-2 gap-2" role="radiogroup">
          {PAYMENT_METHODS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={method === option.value}
              onClick={() => setMethod(option.value)}
              className={cn(
                'border-border hover:bg-accent flex items-center gap-2 rounded-md border px-3 py-2 text-sm',
                'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                method === option.value && 'border-primary bg-accent font-medium',
              )}
            >
              <option.icon aria-hidden className="size-4" /> {option.label}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="flex items-baseline justify-between">
        <span className="text-muted-foreground text-sm">A receber</span>
        <span className="text-2xl font-bold">{formatMoney(order.totalCents)}</span>
      </div>
      <Button size="lg" onClick={submit} disabled={!method || order.items.length === 0 || close.isPending}>
        {close.isPending ? 'Fechando…' : 'Fechar e lançar no caixa'}
      </Button>
      <p className="text-muted-foreground text-xs">Depois de fechada, a comanda só pode ser estornada.</p>
    </div>
  );
}

function ClosedSummary({ order, timezone }: { order: Order; timezone: string }) {
  const session = useAuthenticatedSession();
  const voidOrder = useVoidOrder(order.id);
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);

  const submit = async () => {
    try {
      await voidOrder.mutateAsync({ reason });
      toast.success('Comanda estornada. Caixa e comissões foram ajustados.');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="bg-card border-border grid gap-3 rounded-lg border p-4">
      <p className="font-heading text-xl font-semibold uppercase">Paga</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Forma</dt>
        <dd>{paymentLabel(order.paymentMethod)}</dd>
        <dt className="text-muted-foreground">Fechada em</dt>
        <dd>{order.closedAt && formatDateTime(order.closedAt, timezone)}</dd>
        <dt className="text-muted-foreground">Total</dt>
        <dd className="font-bold">{formatMoney(order.totalCents)}</dd>
      </dl>
      {can(session, 'orders:void') &&
        (confirming ? (
          <div className="grid gap-2">
            <Label htmlFor="void-reason">Motivo do estorno</Label>
            <Textarea
              id="void-reason"
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <Button
              variant="destructive"
              onClick={submit}
              disabled={reason.trim().length < 3 || voidOrder.isPending}
            >
              Confirmar estorno
            </Button>
          </div>
        ) : (
          <Button variant="ghost" className="text-destructive" onClick={() => setConfirming(true)}>
            Estornar comanda
          </Button>
        ))}
    </div>
  );
}
