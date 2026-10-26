'use client';

import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Field } from '@/components/form/field';
import { MoneyInput } from '@/components/money-input';
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
import { errorMessage } from '@/lib/api/errors';
import { formatMoney, formatPercent } from '@/lib/format';
import { zodResolver } from '@/lib/forms/zod-resolver';
import { can } from '@/lib/permissions';
import {
  useCommissionRules,
  useCreateService,
  useDeleteCommissionRule,
  useServices,
  useStaff,
  useUpdateService,
  useUpsertCommissionRule,
  type CommissionRule,
  type Service,
} from '@/lib/queries';
import { useAuthenticatedSession } from '@/lib/session/use-session';

export function ServicesView() {
  const session = useAuthenticatedSession();
  const canManage = can(session, 'services:manage');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Service | 'new' | null>(null);
  const services = useServices(showInactive);

  return (
    <>
      <PageHeader
        title="Serviços"
        description="Preço e duração definem a agenda e a comanda."
        actions={
          <>
            <div className="flex items-center gap-2">
              <Switch id="show-inactive" checked={showInactive} onCheckedChange={setShowInactive} />
              <Label htmlFor="show-inactive">Mostrar inativos</Label>
            </div>
            {canManage && (
              <Button onClick={() => setEditing('new')}>
                <Plus aria-hidden /> Novo serviço
              </Button>
            )}
          </>
        }
      />

      {services.isLoading ? (
        <LoadingRows />
      ) : services.error ? (
        <ErrorState error={services.error} onRetry={() => services.refetch()} />
      ) : services.data!.length === 0 ? (
        <EmptyState
          title="Nenhum serviço"
          action={canManage && <Button onClick={() => setEditing('new')}>Cadastrar o primeiro</Button>}
        >
          Cadastre corte, barba e o que mais a barbearia oferece.
        </EmptyState>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Serviço</TableHead>
              <TableHead className="text-right">Duração</TableHead>
              <TableHead className="text-right">Preço</TableHead>
              {canManage && (
                <TableHead className="w-12">
                  <span className="sr-only">Ações</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {services.data!.map((service) => (
              <TableRow key={service.id} className={service.active ? undefined : 'opacity-60'}>
                <TableCell>
                  <span className="font-medium">{service.name}</span>
                  {!service.active && (
                    <Badge variant="outline" className="ml-2">
                      Inativo
                    </Badge>
                  )}
                  {service.description && (
                    <p className="text-muted-foreground text-xs">{service.description}</p>
                  )}
                </TableCell>
                <TableCell className="text-right">{service.durationMinutes} min</TableCell>
                <TableCell className="text-right">{formatMoney(service.priceCents)}</TableCell>
                {canManage && (
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Editar ${service.name}`}
                      onClick={() => setEditing(service)}
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

      {canManage && <CommissionRules />}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          {editing !== null && (
            <ServiceForm service={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

const serviceSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome.'),
  description: z.string().max(500),
  priceCents: z.number({ error: 'Informe o preço.' }).int().min(0),
  durationMinutes: z.coerce
    .number<string>()
    .int()
    .min(5, 'Mínimo de 5 minutos.')
    .max(480)
    .refine((minutes) => minutes % 5 === 0, 'Use múltiplos de 5 minutos.'),
  active: z.boolean(),
});

function ServiceForm({ service, onDone }: { service?: Service; onDone: () => void }) {
  const create = useCreateService();
  const update = useUpdateService();
  const form = useForm({
    resolver: zodResolver(serviceSchema),
    defaultValues: {
      name: service?.name ?? '',
      description: service?.description ?? '',
      priceCents: service?.priceCents ?? (null as unknown as number),
      durationMinutes: String(service?.durationMinutes ?? 30),
      active: service?.active ?? true,
    },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    const fields = {
      name: values.name,
      description: values.description || null,
      priceCents: values.priceCents,
      durationMinutes: values.durationMinutes,
    };
    try {
      if (service) {
        await update.mutateAsync({ id: service.id, ...fields, active: values.active });
      } else {
        await create.mutateAsync(fields);
      }
      toast.success('Serviço salvo.');
      onDone();
    } catch (error) {
      form.setError('root', { message: errorMessage(error) });
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle className="font-heading text-2xl uppercase">
          {service ? 'Editar serviço' : 'Novo serviço'}
        </DialogTitle>
        <DialogDescription>Mudar o preço não altera agendamentos e comandas já feitos.</DialogDescription>
      </DialogHeader>
      {errors.root && (
        <Alert variant="destructive">
          <AlertDescription>{errors.root.message}</AlertDescription>
        </Alert>
      )}
      <Field label="Nome" error={errors.name?.message}>
        <Input autoFocus {...form.register('name')} />
      </Field>
      <Field label="Descrição (opcional)" error={errors.description?.message}>
        <Input {...form.register('description')} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Controller
          control={form.control}
          name="priceCents"
          render={({ field }) => (
            <Field label="Preço" error={errors.priceCents?.message}>
              <MoneyInput value={field.value ?? null} onChange={(cents) => field.onChange(cents)} />
            </Field>
          )}
        />
        <Field label="Duração (min)" error={errors.durationMinutes?.message}>
          <Input type="number" min={5} step={5} {...form.register('durationMinutes')} />
        </Field>
      </div>
      {service && (
        <Controller
          control={form.control}
          name="active"
          render={({ field }) => (
            <div className="flex items-center gap-2">
              <Switch id="service-active" checked={field.value} onCheckedChange={field.onChange} />
              <Label htmlFor="service-active">Disponível para agendamento</Label>
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

// ───────────── Regras de comissão ─────────────

const ANY = '__any__';

function CommissionRules() {
  const rules = useCommissionRules();
  const services = useServices(true);
  const staff = useStaff();
  const remove = useDeleteCommissionRule();
  const [editing, setEditing] = useState<CommissionRule | 'new' | null>(null);

  const serviceName = (id: string | null) =>
    id ? (services.data?.find((service) => service.id === id)?.name ?? '—') : 'Qualquer serviço';
  const staffName = (id: string | null) =>
    id ? (staff.data?.find((member) => member.id === id)?.name ?? '—') : 'Qualquer profissional';

  return (
    <section className="mt-12" aria-labelledby="commission-title">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="commission-title" className="text-2xl font-bold">
            Regras de comissão
          </h2>
          <p className="text-muted-foreground text-sm">
            Vale a mais específica: profissional + serviço, depois serviço, depois profissional.
          </p>
        </div>
        <Button variant="outline" onClick={() => setEditing('new')}>
          <Plus aria-hidden /> Nova regra
        </Button>
      </div>

      {rules.isLoading ? (
        <LoadingRows rows={3} />
      ) : rules.error ? (
        <ErrorState error={rules.error} onRetry={() => rules.refetch()} />
      ) : rules.data!.length === 0 ? (
        <EmptyState title="Sem regras">Sem regra, o atendimento não gera comissão.</EmptyState>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Profissional</TableHead>
              <TableHead>Serviço</TableHead>
              <TableHead className="text-right">Comissão</TableHead>
              <TableHead className="w-24">
                <span className="sr-only">Ações</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.data!.map((rule) => (
              <TableRow key={rule.id}>
                <TableCell>{staffName(rule.membershipId)}</TableCell>
                <TableCell>{serviceName(rule.serviceId)}</TableCell>
                <TableCell className="text-right font-medium">
                  {rule.type === 'PERCENT' ? formatPercent(rule.value) : formatMoney(rule.value)}
                </TableCell>
                <TableCell className="flex justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Editar regra"
                    onClick={() => setEditing(rule)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remover regra"
                    disabled={remove.isPending}
                    onClick={() =>
                      remove.mutate(rule.id, { onError: (error) => toast.error(errorMessage(error)) })
                    }
                  >
                    <Trash2 />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          {editing !== null && (
            <RuleForm
              rule={editing === 'new' ? undefined : editing}
              services={services.data ?? []}
              staff={(staff.data ?? []).filter((member) => member.isProfessional)}
              onDone={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

const ruleSchema = z
  .object({
    membershipId: z.string(),
    serviceId: z.string(),
    type: z.enum(['PERCENT', 'FIXED']),
    percent: z.string(),
    fixedCents: z.number().nullable(),
  })
  .refine((rule) => rule.membershipId !== ANY || rule.serviceId !== ANY, {
    path: ['serviceId'],
    message: 'Escolha o profissional, o serviço ou ambos.',
  })
  .refine((rule) => rule.type !== 'PERCENT' || /^\d{1,3}([.,]\d{1,2})?$/.test(rule.percent), {
    path: ['percent'],
    message: 'Informe um percentual entre 0 e 100.',
  })
  .refine((rule) => rule.type !== 'FIXED' || rule.fixedCents !== null, {
    path: ['fixedCents'],
    message: 'Informe o valor.',
  });

function RuleForm({
  rule,
  services,
  staff,
  onDone,
}: {
  rule?: CommissionRule;
  services: Service[];
  staff: { id: string; name: string }[];
  onDone: () => void;
}) {
  const upsert = useUpsertCommissionRule();
  const form = useForm({
    resolver: zodResolver(ruleSchema),
    defaultValues: {
      membershipId: rule?.membershipId ?? ANY,
      serviceId: rule?.serviceId ?? ANY,
      type: rule?.type ?? 'PERCENT',
      percent: rule?.type === 'PERCENT' ? String(rule.value / 100).replace('.', ',') : '',
      fixedCents: rule?.type === 'FIXED' ? rule.value : null,
    },
  });
  const { errors, isSubmitting } = form.formState;
  const type = useWatch({ control: form.control, name: 'type' });

  const onSubmit = form.handleSubmit(async (values) => {
    // Percentual vira basis points: 40% = 4000 (sem float no domínio).
    const value =
      values.type === 'PERCENT'
        ? Math.round(Number(values.percent.replace(',', '.')) * 100)
        : values.fixedCents!;
    if (values.type === 'PERCENT' && value > 10_000) {
      form.setError('percent', { message: 'Máximo de 100%.' });
      return;
    }
    try {
      await upsert.mutateAsync({
        membershipId: values.membershipId === ANY ? null : values.membershipId,
        serviceId: values.serviceId === ANY ? null : values.serviceId,
        type: values.type,
        value,
      });
      toast.success('Regra salva.');
      onDone();
    } catch (error) {
      form.setError('root', { message: errorMessage(error) });
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle className="font-heading text-2xl uppercase">Regra de comissão</DialogTitle>
        <DialogDescription>A comissão é calculada e congelada quando a comanda é fechada.</DialogDescription>
      </DialogHeader>
      {errors.root && (
        <Alert variant="destructive">
          <AlertDescription>{errors.root.message}</AlertDescription>
        </Alert>
      )}
      <Controller
        control={form.control}
        name="membershipId"
        render={({ field }) => (
          <Field label="Profissional">
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Qualquer profissional</SelectItem>
                {staff.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
      />
      <Controller
        control={form.control}
        name="serviceId"
        render={({ field }) => (
          <Field label="Serviço" error={errors.serviceId?.message}>
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Qualquer serviço</SelectItem>
                {services.map((service) => (
                  <SelectItem key={service.id} value={service.id}>
                    {service.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
      />
      <Controller
        control={form.control}
        name="type"
        render={({ field }) => (
          <Field label="Tipo">
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PERCENT">Percentual do valor</SelectItem>
                <SelectItem value="FIXED">Valor fixo</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        )}
      />
      {type === 'PERCENT' ? (
        <Field label="Percentual (%)" error={errors.percent?.message}>
          <Input inputMode="decimal" placeholder="40" {...form.register('percent')} />
        </Field>
      ) : (
        <Controller
          control={form.control}
          name="fixedCents"
          render={({ field }) => (
            <Field label="Valor por atendimento" error={errors.fixedCents?.message}>
              <MoneyInput value={field.value} onChange={field.onChange} />
            </Field>
          )}
        />
      )}
      <Button type="submit" disabled={isSubmitting}>
        Salvar regra
      </Button>
    </form>
  );
}
