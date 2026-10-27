'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import { StatusBadge } from '@/components/appointment-status';
import { ClientPicker } from '@/components/client-picker';
import { Field } from '@/components/form/field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { api, unwrap } from '@/lib/api/client';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  formatClock,
  formatDateLong,
  formatMoney,
  formatPhone,
  formatTime,
  localInstant,
  minuteOfDay,
} from '@/lib/format';
import { zodResolver } from '@/lib/forms/zod-resolver';
import { can } from '@/lib/permissions';
import {
  useAvailability,
  useChangeAppointmentStatus,
  useCreateAppointment,
  useJustifyNoShow,
  useOpenOrder,
  useServices,
  useUpdateAppointment,
  type Appointment,
} from '@/lib/queries';
import { useAuthenticatedSession } from '@/lib/session/use-session';
import { cn } from '@/lib/utils';

export type SheetState =
  | { mode: 'closed' }
  | { mode: 'create'; professionalId?: string; date: string; minute?: number }
  | { mode: 'view'; appointment: Appointment };

interface Professional {
  id: string;
  name: string;
}

export function AppointmentSheet({
  state,
  onClose,
  professionals,
  timezone,
}: {
  state: SheetState;
  onClose: () => void;
  professionals: Professional[];
  timezone: string;
}) {
  return (
    <Sheet open={state.mode !== 'closed'} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {state.mode === 'create' && (
          <CreateAppointment
            state={state}
            onDone={onClose}
            professionals={professionals}
            timezone={timezone}
          />
        )}
        {state.mode === 'view' && (
          <AppointmentDetails
            appointment={state.appointment}
            onDone={onClose}
            professionals={professionals}
            timezone={timezone}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

// ───────────── Criar ─────────────

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Informe o horário.');

const createSchema = z.object({
  professionalId: z.string().min(1, 'Escolha o profissional.'),
  client: z.object({ id: z.string(), name: z.string() }).nullable().refine(Boolean, 'Escolha o cliente.'),
  serviceIds: z.array(z.string()).min(1, 'Escolha ao menos um serviço.'),
  date: z.string().min(1, 'Informe a data.'),
  time: timeSchema,
  notes: z.string().max(500),
});

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours! * 60 + minutes!;
}

function CreateAppointment({
  state,
  onDone,
  professionals,
  timezone,
}: {
  state: Extract<SheetState, { mode: 'create' }>;
  onDone: () => void;
  professionals: Professional[];
  timezone: string;
}) {
  const session = useAuthenticatedSession();
  const services = useServices();
  const create = useCreateAppointment();
  // Quem só pode agendar na própria agenda já vem com o próprio nome escolhido.
  const ownOnly = !can(session, 'appointments:write:any');
  const form = useForm({
    resolver: zodResolver(createSchema),
    defaultValues: {
      // Barbearia de um profissional só (comum no público-alvo): já vem escolhido.
      professionalId: ownOnly
        ? session.profile.membership.id
        : (state.professionalId ?? (professionals.length === 1 ? professionals[0]!.id : '')),
      client: null,
      serviceIds: [] as string[],
      date: state.date,
      time: state.minute !== undefined ? formatClock(state.minute) : '',
      notes: '',
    },
  });
  const { errors, isSubmitting } = form.formState;

  // A lista de profissionais pode chegar depois de o formulário abrir (agenda ainda
  // carregando): com um profissional só, ele continua vindo escolhido.
  const onlyProfessional = professionals.length === 1 ? professionals[0]!.id : undefined;
  useEffect(() => {
    if (onlyProfessional && !form.getValues('professionalId')) {
      form.setValue('professionalId', onlyProfessional, { shouldValidate: form.formState.isSubmitted });
    }
  }, [onlyProfessional, form]);

  const [professionalId, serviceIds, date] = useWatch({
    control: form.control,
    name: ['professionalId', 'serviceIds', 'date'],
  });
  const availability = useAvailability(date, serviceIds, professionalId || undefined);
  const freeStarts =
    availability.data?.professionals.find((p) => p.professionalId === professionalId)?.starts ?? [];

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await create.mutateAsync({
        professionalId: values.professionalId,
        clientId: values.client!.id,
        serviceIds: values.serviceIds,
        startsAt: localInstant(values.date, toMinutes(values.time), timezone).toISOString(),
        notes: values.notes || undefined,
      });
      toast.success('Agendamento criado.');
      onDone();
    } catch (error) {
      form.setError('root', { message: errorMessage(error) });
    }
  });

  const selectableProfessionals = ownOnly
    ? professionals.filter((professional) => professional.id === session.profile.membership.id)
    : professionals;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5 p-4">
      <SheetHeader className="p-0">
        <SheetTitle className="font-heading text-2xl uppercase">Novo agendamento</SheetTitle>
        <SheetDescription>Encaixes fora do expediente são permitidos; conflitos, não.</SheetDescription>
      </SheetHeader>

      {errors.root && (
        <Alert variant="destructive">
          <AlertDescription>{errors.root.message}</AlertDescription>
        </Alert>
      )}

      <Controller
        control={form.control}
        name="professionalId"
        render={({ field }) => (
          <Field label="Profissional" error={errors.professionalId?.message}>
            <Select value={field.value} onValueChange={field.onChange} disabled={ownOnly}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Escolha" />
              </SelectTrigger>
              <SelectContent>
                {selectableProfessionals.map((professional) => (
                  <SelectItem key={professional.id} value={professional.id}>
                    {professional.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
      />

      <Controller
        control={form.control}
        name="client"
        render={({ field }) => (
          <ClientPicker value={field.value} onChange={field.onChange} error={errors.client?.message} />
        )}
      />

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Serviços</legend>
        <Controller
          control={form.control}
          name="serviceIds"
          render={({ field }) => (
            <div className="grid gap-1">
              {services.data?.map((service) => {
                const checked = field.value.includes(service.id);
                return (
                  <label
                    key={service.id}
                    className={cn(
                      'border-border flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm',
                      checked && 'border-primary bg-accent',
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(next) =>
                        field.onChange(
                          next ? [...field.value, service.id] : field.value.filter((id) => id !== service.id),
                        )
                      }
                    />
                    <span className="flex-1">{service.name}</span>
                    <span className="text-muted-foreground text-xs">{service.durationMinutes} min</span>
                    <span className="font-medium">{formatMoney(service.priceCents)}</span>
                  </label>
                );
              })}
            </div>
          )}
        />
        {errors.serviceIds && (
          <p role="alert" className="text-destructive text-xs font-medium">
            {errors.serviceIds.message}
          </p>
        )}
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Data" error={errors.date?.message}>
          <Input type="date" {...form.register('date')} />
        </Field>
        <Field label="Horário" error={errors.time?.message}>
          <Input type="time" step={900} {...form.register('time')} />
        </Field>
      </div>

      {serviceIds.length > 0 && professionalId && (
        <div className="grid gap-2">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Horários livres</p>
          {availability.isLoading ? (
            <p className="text-muted-foreground text-sm">Calculando…</p>
          ) : freeStarts.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhum horário livre no expediente deste dia.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {freeStarts.map((start) => {
                const label = formatTime(start, timezone);
                return (
                  <Button
                    key={start}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => form.setValue('time', label, { shouldValidate: true })}
                  >
                    {label}
                  </Button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <Field label="Observações" error={errors.notes?.message}>
        <Textarea rows={2} {...form.register('notes')} />
      </Field>

      <Button type="submit" size="lg" disabled={isSubmitting}>
        {isSubmitting ? 'Agendando…' : 'Agendar'}
      </Button>
    </form>
  );
}

// ───────────── Ver / operar ─────────────

function AppointmentDetails({
  appointment,
  onDone,
  professionals,
  timezone,
}: {
  appointment: Appointment;
  onDone: () => void;
  professionals: Professional[];
  timezone: string;
}) {
  const router = useRouter();
  const session = useAuthenticatedSession();
  const changeStatus = useChangeAppointmentStatus();
  const openOrder = useOpenOrder();
  const justifyNoShow = useJustifyNoShow();
  const [panel, setPanel] = useState<'none' | 'cancel' | 'reschedule' | 'no-show' | 'justify'>('none');
  const [reason, setReason] = useState('');

  const canWrite =
    can(session, 'appointments:write:any') ||
    (can(session, 'appointments:write:own') && appointment.professional.id === session.profile.membership.id);
  const canOrder = can(session, 'orders:manage');
  const pending = ['SCHEDULED', 'CONFIRMED'].includes(appointment.status);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(
    new Date(appointment.startsAt),
  );

  const setStatus = async (status: 'CONFIRMED' | 'IN_SERVICE' | 'NO_SHOW' | 'CANCELLED') => {
    try {
      await changeStatus.mutateAsync({ id: appointment.id, status, reason: reason || undefined });
      toast.success('Agendamento atualizado.');
      onDone();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const saveJustification = async (justification: string | null) => {
    try {
      await justifyNoShow.mutateAsync({ id: appointment.id, justification });
      toast.success(justification ? 'Justificativa registrada.' : 'Justificativa removida.');
      onDone();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const goToOrder = async () => {
    try {
      const order = await openOrder.mutateAsync({ appointmentId: appointment.id });
      router.push(`/painel/comandas/${order.id}`);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'order-already-exists') {
        const page = await unwrap(
          api.GET('/v1/orders', { params: { query: { appointmentId: appointment.id, limit: 1 } } }),
        );
        if (page.items[0]) return router.push(`/painel/comandas/${page.items[0].id}`);
      }
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="flex flex-col gap-5 p-4">
      <SheetHeader className="p-0">
        <SheetTitle className="font-heading text-2xl uppercase">{appointment.client.name}</SheetTitle>
        <SheetDescription>
          {formatDateLong(date, timezone)} · {formatTime(appointment.startsAt, timezone)}–
          {formatTime(appointment.endsAt, timezone)}
        </SheetDescription>
        <StatusBadge status={appointment.status} className="mt-1 w-fit" />
      </SheetHeader>

      {appointment.client.unjustifiedNoShows > 0 && (
        <Alert>
          <TriangleAlert aria-hidden />
          <AlertDescription>
            {appointment.client.unjustifiedNoShows === 1
              ? 'Este cliente tem 1 falta sem justificativa.'
              : `Este cliente tem ${appointment.client.unjustifiedNoShows} faltas sem justificativa.`}
          </AlertDescription>
        </Alert>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Profissional</dt>
        <dd>{appointment.professional.name}</dd>
        {appointment.client.phone && (
          <>
            <dt className="text-muted-foreground">Telefone</dt>
            <dd>
              <a
                className="text-primary underline-offset-4 hover:underline"
                href={`tel:+${appointment.client.phone}`}
              >
                {formatPhone(appointment.client.phone)}
              </a>
            </dd>
          </>
        )}
        <dt className="text-muted-foreground">Origem</dt>
        <dd>{appointment.source === 'ONLINE' ? 'Agendamento online' : 'Painel'}</dd>
        {appointment.notes && (
          <>
            <dt className="text-muted-foreground">Observações</dt>
            <dd>{appointment.notes}</dd>
          </>
        )}
        {appointment.cancellationReason && (
          <>
            <dt className="text-muted-foreground">Motivo</dt>
            <dd>{appointment.cancellationReason}</dd>
          </>
        )}
        {appointment.status === 'NO_SHOW' && (
          <>
            <dt className="text-muted-foreground">Justificativa</dt>
            <dd>{appointment.noShowJustification ?? 'Sem justificativa'}</dd>
          </>
        )}
      </dl>

      <div className="border-border rounded-md border">
        <ul className="divide-border divide-y text-sm">
          {appointment.items.map((item) => (
            <li key={item.serviceId} className="flex justify-between px-3 py-2">
              <span>
                {item.name}{' '}
                <span className="text-muted-foreground text-xs">· {item.durationMinutes} min</span>
              </span>
              <span>{formatMoney(item.priceCents)}</span>
            </li>
          ))}
        </ul>
        <div className="border-border flex justify-between border-t px-3 py-2 text-sm font-semibold">
          <span>Total</span>
          <span>{formatMoney(appointment.totalCents)}</span>
        </div>
      </div>

      {canWrite && (
        <div className="flex flex-wrap gap-2">
          {appointment.status === 'SCHEDULED' && (
            <Button
              variant="outline"
              onClick={() => setStatus('CONFIRMED')}
              disabled={changeStatus.isPending}
            >
              Confirmar
            </Button>
          )}
          {pending && (
            <Button
              variant="outline"
              onClick={() => setStatus('IN_SERVICE')}
              disabled={changeStatus.isPending}
            >
              Iniciar atendimento
            </Button>
          )}
          {pending && (
            <Button variant="outline" onClick={() => setPanel('reschedule')}>
              Reagendar
            </Button>
          )}
          {pending && (
            <Button variant="outline" onClick={() => setPanel('no-show')}>
              Não compareceu
            </Button>
          )}
          {appointment.status === 'NO_SHOW' && (
            <Button
              variant="outline"
              onClick={() => {
                setReason(appointment.noShowJustification ?? '');
                setPanel('justify');
              }}
            >
              {appointment.noShowJustification ? 'Editar justificativa' : 'Justificar falta'}
            </Button>
          )}
          {pending && (
            <Button variant="ghost" className="text-destructive" onClick={() => setPanel('cancel')}>
              Cancelar
            </Button>
          )}
        </div>
      )}

      {canOrder && ['SCHEDULED', 'CONFIRMED', 'IN_SERVICE', 'COMPLETED'].includes(appointment.status) && (
        <Button onClick={goToOrder} disabled={openOrder.isPending}>
          {appointment.status === 'COMPLETED' ? 'Ver comanda' : 'Abrir comanda'}
        </Button>
      )}

      {panel === 'cancel' && (
        <div className="grid gap-2">
          <Separator />
          <Label htmlFor="cancel-reason">Motivo do cancelamento (opcional)</Label>
          <Textarea
            id="cancel-reason"
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <Button
            variant="destructive"
            onClick={() => setStatus('CANCELLED')}
            disabled={changeStatus.isPending}
          >
            Confirmar cancelamento
          </Button>
        </div>
      )}

      {panel === 'no-show' && (
        <div className="grid gap-2">
          <Separator />
          <Label htmlFor="no-show-reason">Justificativa da falta (opcional)</Label>
          <Textarea
            id="no-show-reason"
            rows={2}
            maxLength={200}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <p className="text-muted-foreground text-xs">
            Sem justificativa, a falta aparece para a equipe no cadastro do cliente. O cliente não vê.
          </p>
          <Button onClick={() => setStatus('NO_SHOW')} disabled={changeStatus.isPending}>
            Confirmar falta
          </Button>
        </div>
      )}

      {panel === 'justify' && (
        <div className="grid gap-2">
          <Separator />
          <Label htmlFor="no-show-justification">Justificativa da falta</Label>
          <Textarea
            id="no-show-justification"
            rows={2}
            maxLength={200}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => saveJustification(reason.trim())}
              disabled={justifyNoShow.isPending || !reason.trim()}
            >
              Salvar justificativa
            </Button>
            {appointment.noShowJustification && (
              <Button
                variant="ghost"
                onClick={() => saveJustification(null)}
                disabled={justifyNoShow.isPending}
              >
                Remover justificativa
              </Button>
            )}
          </div>
        </div>
      )}

      {panel === 'reschedule' && (
        <Reschedule
          appointment={appointment}
          professionals={professionals}
          timezone={timezone}
          ownOnly={!can(session, 'appointments:write:any')}
          onDone={onDone}
        />
      )}
    </div>
  );
}

const rescheduleSchema = z.object({
  professionalId: z.string().min(1),
  date: z.string().min(1),
  time: timeSchema,
});

function Reschedule({
  appointment,
  professionals,
  timezone,
  ownOnly,
  onDone,
}: {
  appointment: Appointment;
  professionals: Professional[];
  timezone: string;
  ownOnly: boolean;
  onDone: () => void;
}) {
  const update = useUpdateAppointment();
  const form = useForm({
    resolver: zodResolver(rescheduleSchema),
    defaultValues: {
      professionalId: appointment.professional.id,
      date: new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(appointment.startsAt)),
      time: formatClock(minuteOfDay(appointment.startsAt, timezone)),
    },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await update.mutateAsync({
        id: appointment.id,
        professionalId: values.professionalId,
        startsAt: localInstant(values.date, toMinutes(values.time), timezone).toISOString(),
      });
      toast.success('Agendamento remarcado.');
      onDone();
    } catch (error) {
      form.setError('root', { message: errorMessage(error) });
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-3">
      <Separator />
      <p className="font-heading text-lg font-semibold uppercase">Reagendar</p>
      {errors.root && (
        <Alert variant="destructive">
          <AlertDescription>{errors.root.message}</AlertDescription>
        </Alert>
      )}
      {!ownOnly && (
        <Controller
          control={form.control}
          name="professionalId"
          render={({ field }) => (
            <Field label="Profissional">
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {professionals.map((professional) => (
                    <SelectItem key={professional.id} value={professional.id}>
                      {professional.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        />
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Data" error={errors.date?.message}>
          <Input type="date" {...form.register('date')} />
        </Field>
        <Field label="Horário" error={errors.time?.message}>
          <Input type="time" step={900} {...form.register('time')} />
        </Field>
      </div>
      <Button type="submit" disabled={isSubmitting}>
        Salvar novo horário
      </Button>
    </form>
  );
}
