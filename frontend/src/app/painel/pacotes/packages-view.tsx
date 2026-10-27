'use client';

import { useState } from 'react';
import { Pencil, Plus, Trash2, Undo2 } from 'lucide-react';
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Field } from '@/components/form/field';
import { MoneyInput } from '@/components/money-input';
import { formatBalances, PACKAGE_STATUS, PackageStatusBadge } from '@/components/package-status';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { errorMessage } from '@/lib/api/errors';
import { formatDate, formatMoney } from '@/lib/format';
import { zodResolver } from '@/lib/forms/zod-resolver';
import { PAYMENT_METHODS } from '@/lib/payment-methods';
import { can } from '@/lib/permissions';
import {
  useBarbershop,
  useClientPackages,
  useCreatePackage,
  usePackages,
  useRefundPackage,
  useServices,
  useUpdatePackage,
  type ClientPackage,
  type PaymentMethod,
  type ServicePackage,
} from '@/lib/queries';
import { useAuthenticatedSession } from '@/lib/session/use-session';
import { cn } from '@/lib/utils';

type Dialogs =
  | { kind: 'none' }
  | { kind: 'form'; servicePackage?: ServicePackage }
  | { kind: 'refund'; clientPackage: ClientPackage };

type SoldStatus = ClientPackage['status'];

/** Pacotes de serviços (business-rules §6): venda na comanda, sessões por serviço, validade e reembolso. */
export function PackagesView() {
  const session = useAuthenticatedSession();
  const canManage = can(session, 'packages:manage');
  const [tab, setTab] = useState<'catalog' | 'sold'>('catalog');
  const [dialog, setDialog] = useState<Dialogs>({ kind: 'none' });
  const close = () => setDialog({ kind: 'none' });

  return (
    <>
      <PageHeader
        title="Pacotes"
        description="Venda sessões antecipadas na comanda. Cada atendimento consome uma sessão do saldo do cliente."
        actions={
          canManage && (
            <Button onClick={() => setDialog({ kind: 'form' })}>
              <Plus aria-hidden /> Novo pacote
            </Button>
          )
        }
      />

      <Tabs value={tab} onValueChange={(value) => setTab(value as 'catalog' | 'sold')}>
        <TabsList>
          <TabsTrigger value="catalog">À venda</TabsTrigger>
          <TabsTrigger value="sold">Vendidos</TabsTrigger>
        </TabsList>
        <TabsContent value="catalog" className="pt-4">
          <Catalog
            canManage={canManage}
            onEdit={(servicePackage) => setDialog({ kind: 'form', servicePackage })}
          />
        </TabsContent>
        <TabsContent value="sold" className="pt-4">
          <Sold onRefund={(clientPackage) => setDialog({ kind: 'refund', clientPackage })} />
        </TabsContent>
      </Tabs>

      <Dialog open={dialog.kind !== 'none'} onOpenChange={(open) => !open && close()}>
        <DialogContent className={cn(dialog.kind === 'form' && 'sm:max-w-xl')}>
          {dialog.kind === 'form' && <PackageForm servicePackage={dialog.servicePackage} onDone={close} />}
          {dialog.kind === 'refund' && <RefundForm clientPackage={dialog.clientPackage} onDone={close} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Catalog({
  canManage,
  onEdit,
}: {
  canManage: boolean;
  onEdit: (servicePackage: ServicePackage) => void;
}) {
  const [showInactive, setShowInactive] = useState(false);
  const packages = usePackages(showInactive);
  const list = packages.data ?? [];

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <Switch id="show-inactive" checked={showInactive} onCheckedChange={setShowInactive} />
        <Label htmlFor="show-inactive">Mostrar desativados</Label>
      </div>
      {packages.isLoading ? (
        <LoadingRows rows={3} />
      ) : packages.error ? (
        <ErrorState error={packages.error} onRetry={() => packages.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState title="Nenhum pacote">
          {canManage
            ? 'Crie um pacote (ex.: 4 cortes por mês) para vender na comanda.'
            : 'A barbearia ainda não criou pacotes.'}
        </EmptyState>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pacote</TableHead>
              <TableHead className="hidden md:table-cell">Sessões</TableHead>
              <TableHead className="text-right">Preço</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Validade</TableHead>
              {canManage && (
                <TableHead className="w-12">
                  <span className="sr-only">Ações</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((servicePackage) => (
              <TableRow key={servicePackage.id} className={cn(!servicePackage.active && 'opacity-60')}>
                <TableCell>
                  <span className="font-medium">{servicePackage.name}</span>
                  {!servicePackage.active && (
                    <Badge variant="outline" className="ml-2">
                      Desativado
                    </Badge>
                  )}
                  {!servicePackage.commissionOnSessions && (
                    <Badge variant="secondary" className="ml-2">
                      Sessões sem comissão
                    </Badge>
                  )}
                  {servicePackage.description && (
                    <p className="text-muted-foreground text-xs">{servicePackage.description}</p>
                  )}
                  <p className="text-muted-foreground text-xs md:hidden">{formatItems(servicePackage)}</p>
                </TableCell>
                <TableCell className="hidden md:table-cell">{formatItems(servicePackage)}</TableCell>
                <TableCell className="text-right">{formatMoney(servicePackage.priceCents)}</TableCell>
                <TableCell className="hidden text-right sm:table-cell">
                  {servicePackage.validityDays} dias
                </TableCell>
                {canManage && (
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Editar ${servicePackage.name}`}
                      onClick={() => onEdit(servicePackage)}
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
    </>
  );
}

function formatItems(servicePackage: ServicePackage): string {
  return servicePackage.items.map((item) => `${item.quantity}× ${item.name}`).join(' + ');
}

const ALL = 'ALL';

function Sold({ onRefund }: { onRefund: (clientPackage: ClientPackage) => void }) {
  const session = useAuthenticatedSession();
  const canRefund = can(session, 'orders:void');
  const [status, setStatus] = useState<SoldStatus | typeof ALL>('ACTIVE');
  const sold = useClientPackages({ status: status === ALL ? undefined : status });
  const timezone = useBarbershop().data?.timezone ?? 'America/Sao_Paulo';
  const list = sold.data ?? [];

  return (
    <>
      <div className="mb-4 grid max-w-56 gap-1.5">
        <Label htmlFor="sold-status">Situação</Label>
        <Select value={status} onValueChange={(value) => setStatus(value as SoldStatus | typeof ALL)}>
          <SelectTrigger id="sold-status" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos</SelectItem>
            {(Object.keys(PACKAGE_STATUS) as SoldStatus[]).map((value) => (
              <SelectItem key={value} value={value}>
                {PACKAGE_STATUS[value].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {sold.isLoading ? (
        <LoadingRows rows={3} />
      ) : sold.error ? (
        <ErrorState error={sold.error} onRetry={() => sold.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState title="Nenhum pacote vendido">
          Pacotes são vendidos na comanda do cliente, como um item.
        </EmptyState>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Saldo</TableHead>
              <TableHead className="hidden text-right md:table-cell">Pago</TableHead>
              <TableHead className="hidden sm:table-cell">Validade</TableHead>
              <TableHead>Situação</TableHead>
              {canRefund && (
                <TableHead className="w-12">
                  <span className="sr-only">Ações</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((clientPackage) => (
              <TableRow key={clientPackage.id}>
                <TableCell>
                  <span className="font-medium">{clientPackage.client.name}</span>
                  <p className="text-muted-foreground text-xs">
                    {clientPackage.name} · {formatDate(clientPackage.purchasedAt, timezone)}
                  </p>
                </TableCell>
                <TableCell className="text-sm">{formatBalances(clientPackage.balances)}</TableCell>
                <TableCell className="hidden text-right md:table-cell">
                  {formatMoney(clientPackage.pricePaidCents)}
                  {clientPackage.refundCents !== null && (
                    <p className="text-muted-foreground text-xs">
                      reembolso {formatMoney(clientPackage.refundCents)}
                    </p>
                  )}
                </TableCell>
                <TableCell className="hidden text-sm sm:table-cell">
                  até {formatDate(clientPackage.expiresAt, timezone)}
                </TableCell>
                <TableCell>
                  <PackageStatusBadge status={clientPackage.status} />
                  {clientPackage.refundReason && (
                    <p className="text-muted-foreground mt-1 text-xs">{clientPackage.refundReason}</p>
                  )}
                </TableCell>
                {canRefund && (
                  <TableCell>
                    {clientPackage.status === 'ACTIVE' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Reembolsar pacote de ${clientPackage.client.name}`}
                        onClick={() => onRefund(clientPackage)}
                      >
                        <Undo2 />
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {list.length === 100 && (
        <p className="text-muted-foreground mt-2 text-xs">Mostrando os 100 mais recentes.</p>
      )}
    </>
  );
}

const packageSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome.').max(100),
  description: z.string().max(500),
  priceCents: z.number({ error: 'Informe o preço.' }).int().min(0),
  validityDays: z.string().regex(/^[1-9]\d{0,3}$/, 'Informe a validade em dias.'),
  commissionOnSessions: z.boolean(),
  active: z.boolean(),
  items: z
    .array(
      z.object({
        serviceId: z.string().min(1, 'Escolha o serviço.'),
        quantity: z.string().regex(/^[1-9]\d?$/, 'De 1 a 99.'),
      }),
    )
    .min(1, 'Inclua ao menos um serviço.')
    .refine((items) => new Set(items.map((item) => item.serviceId)).size === items.length, {
      message: 'Cada serviço entra uma vez só: aumente a quantidade.',
    }),
});

function PackageForm({ servicePackage, onDone }: { servicePackage?: ServicePackage; onDone: () => void }) {
  const services = useServices(true);
  const create = useCreatePackage();
  const update = useUpdatePackage();
  const form = useForm({
    resolver: zodResolver(packageSchema),
    defaultValues: {
      name: servicePackage?.name ?? '',
      description: servicePackage?.description ?? '',
      priceCents: servicePackage?.priceCents ?? (null as unknown as number),
      validityDays: servicePackage?.validityDays.toString() ?? '30',
      commissionOnSessions: servicePackage?.commissionOnSessions ?? true,
      active: servicePackage?.active ?? true,
      items: servicePackage?.items.map((item) => ({
        serviceId: item.serviceId,
        quantity: item.quantity.toString(),
      })) ?? [{ serviceId: '', quantity: '4' }],
    },
  });
  const items = useFieldArray({ control: form.control, name: 'items' });
  const { errors, isSubmitting } = form.formState;
  const watchedItems = useWatch({ control: form.control, name: 'items' });
  const listPrice = watchedItems.reduce((sum, item) => {
    const service = services.data?.find((candidate) => candidate.id === item.serviceId);
    return sum + (service?.priceCents ?? 0) * (Number(item.quantity) || 0);
  }, 0);
  const activeServices = (services.data ?? []).filter(
    (service) => service.active || watchedItems.some((item) => item.serviceId === service.id),
  );

  const onSubmit = form.handleSubmit(async (values) => {
    const body = {
      name: values.name,
      description: values.description || null,
      priceCents: values.priceCents,
      validityDays: Number(values.validityDays),
      commissionOnSessions: values.commissionOnSessions,
      items: values.items.map((item) => ({ serviceId: item.serviceId, quantity: Number(item.quantity) })),
    };
    try {
      if (servicePackage) await update.mutateAsync({ id: servicePackage.id, ...body, active: values.active });
      else await create.mutateAsync(body);
      toast.success('Pacote salvo.');
      onDone();
    } catch (error) {
      form.setError('root', { message: errorMessage(error) });
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle className="font-heading text-2xl uppercase">
          {servicePackage ? 'Editar pacote' : 'Novo pacote'}
        </DialogTitle>
        <DialogDescription>
          {servicePackage
            ? 'As mudanças valem só para vendas futuras; quem já comprou mantém o que comprou.'
            : 'O cliente compra na comanda e usa as sessões nos próximos atendimentos.'}
        </DialogDescription>
      </DialogHeader>
      {errors.root && (
        <Alert variant="destructive">
          <AlertDescription>{errors.root.message}</AlertDescription>
        </Alert>
      )}
      <Field label="Nome" error={errors.name?.message}>
        <Input autoFocus placeholder="Ex.: Combo do mês" {...form.register('name')} />
      </Field>
      <Field label="Descrição (opcional)">
        <Input {...form.register('description')} />
      </Field>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Sessões incluídas</legend>
        {items.fields.map((field, index) => (
          <div key={field.id} className="grid grid-cols-[1fr_5rem_auto] items-start gap-2">
            <Controller
              control={form.control}
              name={`items.${index}.serviceId`}
              render={({ field: select }) => (
                <div className="grid gap-1">
                  <Select value={select.value} onValueChange={select.onChange}>
                    <SelectTrigger aria-label={`Serviço ${index + 1}`} className="w-full">
                      <SelectValue placeholder="Serviço" />
                    </SelectTrigger>
                    <SelectContent>
                      {activeServices.map((service) => (
                        <SelectItem key={service.id} value={service.id}>
                          {service.name} · {formatMoney(service.priceCents)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.items?.[index]?.serviceId && (
                    <p className="text-destructive text-xs">{errors.items[index].serviceId.message}</p>
                  )}
                </div>
              )}
            />
            <div className="grid gap-1">
              <Input
                aria-label={`Quantidade do serviço ${index + 1}`}
                inputMode="numeric"
                {...form.register(`items.${index}.quantity`)}
              />
              {errors.items?.[index]?.quantity && (
                <p className="text-destructive text-xs">{errors.items[index].quantity.message}</p>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remover serviço ${index + 1}`}
              disabled={items.fields.length === 1}
              onClick={() => items.remove(index)}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
        {errors.items?.root?.message && (
          <p className="text-destructive text-xs">{errors.items.root.message}</p>
        )}
        {errors.items?.message && <p className="text-destructive text-xs">{errors.items.message}</p>}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="justify-self-start"
          disabled={items.fields.length >= 10}
          onClick={() => items.append({ serviceId: '', quantity: '1' })}
        >
          <Plus aria-hidden /> Serviço
        </Button>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <Controller
          control={form.control}
          name="priceCents"
          render={({ field }) => (
            <Field
              label="Preço do pacote"
              hint={listPrice > 0 ? `Avulso sairia ${formatMoney(listPrice)}.` : undefined}
              error={errors.priceCents?.message}
            >
              <MoneyInput value={field.value} onChange={field.onChange} />
            </Field>
          )}
        />
        <Field
          label="Validade (dias)"
          hint="Contada a partir da compra."
          error={errors.validityDays?.message}
        >
          <Input inputMode="numeric" {...form.register('validityDays')} />
        </Field>
      </div>
      <Controller
        control={form.control}
        name="commissionOnSessions"
        render={({ field }) => (
          <div className="grid gap-1">
            <div className="flex items-center gap-2">
              <Switch id="package-commission" checked={field.value} onCheckedChange={field.onChange} />
              <Label htmlFor="package-commission">Sessões geram comissão</Label>
            </div>
            <p className="text-muted-foreground text-xs">
              A comissão de quem atendeu é calculada sobre o valor da sessão (preço pago dividido pelas
              sessões). Desligue para não pagar comissão nas sessões deste pacote.
            </p>
          </div>
        )}
      />
      {servicePackage && (
        <Controller
          control={form.control}
          name="active"
          render={({ field }) => (
            <div className="flex items-center gap-2">
              <Switch id="package-active" checked={field.value} onCheckedChange={field.onChange} />
              <Label htmlFor="package-active">Ativo (aparece para venda na comanda)</Label>
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

const refundSchema = z.object({
  amountCents: z.number({ error: 'Informe o valor.' }).int().min(0),
  paymentMethod: z.string().min(1, 'Escolha como o valor foi devolvido.'),
  reason: z.string().trim().min(3, 'Informe o motivo do reembolso.').max(200),
});

function RefundForm({ clientPackage, onDone }: { clientPackage: ClientPackage; onDone: () => void }) {
  const refund = useRefundPackage();
  const form = useForm({
    resolver: zodResolver(refundSchema),
    defaultValues: { amountCents: null as unknown as number, paymentMethod: '', reason: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    if (values.amountCents > clientPackage.pricePaidCents) {
      form.setError('amountCents', {
        message: `O reembolso vai até o valor pago (${formatMoney(clientPackage.pricePaidCents)}).`,
      });
      return;
    }
    try {
      await refund.mutateAsync({
        id: clientPackage.id,
        amountCents: values.amountCents,
        paymentMethod: values.paymentMethod as PaymentMethod,
        reason: values.reason,
      });
      toast.success('Pacote reembolsado. O valor saiu do caixa de hoje.');
      onDone();
    } catch (error) {
      form.setError('root', { message: errorMessage(error) });
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle className="font-heading text-2xl uppercase">Reembolsar pacote</DialogTitle>
        <DialogDescription>
          {clientPackage.client.name} · {clientPackage.name} · pago{' '}
          {formatMoney(clientPackage.pricePaidCents)}. O pacote é encerrado e as sessões restantes (
          {formatBalances(clientPackage.balances)}) deixam de valer.
        </DialogDescription>
      </DialogHeader>
      {errors.root && (
        <Alert variant="destructive">
          <AlertDescription>{errors.root.message}</AlertDescription>
        </Alert>
      )}
      <Controller
        control={form.control}
        name="amountCents"
        render={({ field }) => (
          <Field
            label="Valor do reembolso"
            hint={`Até ${formatMoney(clientPackage.pricePaidCents)}.`}
            error={errors.amountCents?.message}
          >
            <MoneyInput autoFocus value={field.value} onChange={field.onChange} />
          </Field>
        )}
      />
      <Controller
        control={form.control}
        name="paymentMethod"
        render={({ field }) => (
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Devolvido em</legend>
            <div className="grid grid-cols-2 gap-2" role="radiogroup">
              {PAYMENT_METHODS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={field.value === option.value}
                  onClick={() => field.onChange(option.value)}
                  className={cn(
                    'border-border hover:bg-accent flex items-center gap-2 rounded-md border px-3 py-2 text-sm',
                    'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                    field.value === option.value && 'border-primary bg-accent font-medium',
                  )}
                >
                  <option.icon aria-hidden className="size-4" /> {option.label}
                </button>
              ))}
            </div>
            {errors.paymentMethod && (
              <p className="text-destructive text-xs">{errors.paymentMethod.message}</p>
            )}
          </fieldset>
        )}
      />
      <Field label="Motivo" error={errors.reason?.message}>
        <Input placeholder="Ex.: cliente mudou de cidade" {...form.register('reason')} />
      </Field>
      <Button type="submit" variant="destructive" disabled={isSubmitting}>
        Reembolsar
      </Button>
    </form>
  );
}
