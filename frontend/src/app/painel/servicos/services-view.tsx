'use client';

import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
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
import { formatMoney } from '@/lib/format';
import { zodResolver } from '@/lib/forms/zod-resolver';
import { can } from '@/lib/permissions';
import { useCreateService, useServices, useUpdateService, type Service } from '@/lib/queries';
import { useAuthenticatedSession } from '@/lib/session/use-session';

export function ServicesView() {
  const session = useAuthenticatedSession();
  const canManage = can(session, 'services:manage');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Service | 'new' | null>(null);
  const services = useServices(showInactive);
  // Regras podem apontar para serviço desativado: os nomes vêm da lista completa.
  const allServices = useServices(true);

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

      {canManage && <CommissionRules target="service" items={allServices.data ?? []} />}

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
