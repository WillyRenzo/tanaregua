'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
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
  useBarbershop,
  useCloseOrder,
  useOrder,
  useRemoveOrderItem,
  useServices,
  useStaff,
  useUpdateOrderItem,
  useVoidOrder,
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
          {data.status === 'OPEN' && <AddItem orderId={data.id} />}
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
  const update = useUpdateOrderItem(order.id);
  const remove = useRemoveOrderItem(order.id);
  const open = order.status === 'OPEN';
  const commissionTotal = order.items.reduce((sum, item) => sum + item.commissionCents, 0);

  if (order.items.length === 0) {
    return (
      <p className="text-muted-foreground py-6 text-sm">Nenhum item. Adicione os serviços realizados.</p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Serviço</TableHead>
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
              <p className="text-muted-foreground text-xs">
                {item.professional?.name ?? 'Balcão'} · {formatMoney(item.unitPriceCents)}
              </p>
            </TableCell>
            <TableCell className="text-right">
              {open ? (
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
              {open ? (
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

function AddItem({ orderId }: { orderId: string }) {
  const services = useServices();
  const staff = useStaff();
  const add = useAddOrderItem(orderId);
  const [serviceId, setServiceId] = useState('');
  const [professionalId, setProfessionalId] = useState('');
  const professionals = (staff.data ?? []).filter((member) => member.isProfessional && member.active);

  const submit = async () => {
    if (!serviceId || !professionalId) {
      toast.error('Escolha o serviço e quem atendeu.');
      return;
    }
    try {
      await add.mutateAsync({ serviceId, professionalId, quantity: 1, discountCents: 0 });
      setServiceId('');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="border-border mt-4 grid gap-3 rounded-lg border border-dashed p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <div className="grid gap-1.5">
        <Label htmlFor="add-service">Serviço</Label>
        <Select value={serviceId} onValueChange={setServiceId}>
          <SelectTrigger id="add-service" className="w-full">
            <SelectValue placeholder="Escolha" />
          </SelectTrigger>
          <SelectContent>
            {services.data?.map((service) => (
              <SelectItem key={service.id} value={service.id}>
                {service.name} · {formatMoney(service.priceCents)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="add-professional">Quem atendeu</Label>
        <Select value={professionalId} onValueChange={setProfessionalId}>
          <SelectTrigger id="add-professional" className="w-full">
            <SelectValue placeholder="Escolha" />
          </SelectTrigger>
          <SelectContent>
            {professionals.map((member) => (
              <SelectItem key={member.id} value={member.id}>
                {member.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button variant="outline" onClick={submit} disabled={add.isPending}>
        <Plus aria-hidden /> Adicionar
      </Button>
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
