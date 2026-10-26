'use client';

import { useState } from 'react';
import { CalendarOff, Clock, Pencil, Plus, Trash2 } from 'lucide-react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Field } from '@/components/form/field';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { errorMessage } from '@/lib/api/errors';
import { addDays, formatDateTime, localInstant, todayIn } from '@/lib/format';
import { zodResolver } from '@/lib/forms/zod-resolver';
import { can } from '@/lib/permissions';
import {
  useBarbershop,
  useCreateStaff,
  useCreateTimeOff,
  useDeleteTimeOff,
  useReplaceSchedule,
  useRoles,
  useSchedule,
  useStaff,
  useTimeOffs,
  useUpdateStaff,
  type StaffMember,
} from '@/lib/queries';
import { useAuthenticatedSession } from '@/lib/session/use-session';

const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

type Panel =
  { kind: 'new' } | { kind: 'edit'; member: StaffMember } | { kind: 'schedule'; member: StaffMember };

export function StaffView() {
  const session = useAuthenticatedSession();
  const canManage = can(session, 'staff:manage');
  const staff = useStaff();
  const [panel, setPanel] = useState<Panel | null>(null);

  return (
    <>
      <PageHeader
        title="Equipe"
        description="Quem atende aparece como coluna na agenda."
        actions={
          canManage && (
            <Button onClick={() => setPanel({ kind: 'new' })}>
              <Plus aria-hidden /> Novo funcionário
            </Button>
          )
        }
      />

      {staff.isLoading ? (
        <LoadingRows />
      ) : staff.error ? (
        <ErrorState error={staff.error} onRetry={() => staff.refetch()} />
      ) : staff.data!.length === 0 ? (
        <EmptyState title="Equipe vazia" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Papel</TableHead>
              <TableHead>Agenda</TableHead>
              {canManage && (
                <TableHead className="w-28">
                  <span className="sr-only">Ações</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {staff.data!.map((member) => (
              <TableRow key={member.id} className={member.active ? undefined : 'opacity-60'}>
                <TableCell>
                  <span className="font-medium">{member.name}</span>
                  {!member.active && (
                    <Badge variant="outline" className="ml-2">
                      Inativo
                    </Badge>
                  )}
                  <p className="text-muted-foreground text-xs">{member.email}</p>
                </TableCell>
                <TableCell>{member.role.name}</TableCell>
                <TableCell>{member.isProfessional ? 'Atende' : '—'}</TableCell>
                {canManage && (
                  <TableCell className="flex justify-end gap-1">
                    {member.isProfessional && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Expediente e folgas de ${member.name}`}
                        onClick={() => setPanel({ kind: 'schedule', member })}
                      >
                        <Clock />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Editar ${member.name}`}
                      onClick={() => setPanel({ kind: 'edit', member })}
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

      <Dialog
        open={panel?.kind === 'new' || panel?.kind === 'edit'}
        onOpenChange={(open) => !open && setPanel(null)}
      >
        <DialogContent>
          {panel?.kind === 'new' && <NewStaffForm onDone={() => setPanel(null)} />}
          {panel?.kind === 'edit' && (
            <EditStaffForm
              member={panel.member}
              isSelf={panel.member.id === session.profile.membership.id}
              onDone={() => setPanel(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      <Sheet open={panel?.kind === 'schedule'} onOpenChange={(open) => !open && setPanel(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {panel?.kind === 'schedule' && <ScheduleEditor member={panel.member} />}
        </SheetContent>
      </Sheet>
    </>
  );
}

function RoleSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const roles = useRoles();
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Escolha o papel" />
      </SelectTrigger>
      <SelectContent>
        {roles.data?.map((role) => (
          <SelectItem key={role.id} value={role.key}>
            {role.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const newStaffSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome.'),
  email: z.email('Informe um e-mail válido.'),
  password: z.string().min(8, 'Mínimo de 8 caracteres.'),
  roleKey: z.string().min(1, 'Escolha o papel.'),
  isProfessional: z.boolean(),
});

function NewStaffForm({ onDone }: { onDone: () => void }) {
  const create = useCreateStaff();
  const form = useForm({
    resolver: zodResolver(newStaffSchema),
    defaultValues: { name: '', email: '', password: '', roleKey: 'professional', isProfessional: true },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await create.mutateAsync(values);
      toast.success('Funcionário cadastrado. Combine a senha inicial com a pessoa.');
      onDone();
    } catch (error) {
      form.setError('root', { message: errorMessage(error) });
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle className="font-heading text-2xl uppercase">Novo funcionário</DialogTitle>
        <DialogDescription>
          Se o e-mail já tiver conta no TaNaRegua, a pessoa entra com a senha dela.
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
      <Field label="E-mail" error={errors.email?.message}>
        <Input type="email" {...form.register('email')} />
      </Field>
      <Field label="Senha inicial" error={errors.password?.message}>
        <Input type="password" autoComplete="new-password" {...form.register('password')} />
      </Field>
      <Controller
        control={form.control}
        name="roleKey"
        render={({ field }) => (
          <Field label="Papel" error={errors.roleKey?.message}>
            <RoleSelect value={field.value} onChange={field.onChange} />
          </Field>
        )}
      />
      <Controller
        control={form.control}
        name="isProfessional"
        render={({ field }) => (
          <div className="flex items-center gap-2">
            <Switch id="new-is-professional" checked={field.value} onCheckedChange={field.onChange} />
            <Label htmlFor="new-is-professional">Atende clientes (aparece na agenda)</Label>
          </div>
        )}
      />
      <Button type="submit" disabled={isSubmitting}>
        Cadastrar
      </Button>
    </form>
  );
}

function EditStaffForm({
  member,
  isSelf,
  onDone,
}: {
  member: StaffMember;
  isSelf: boolean;
  onDone: () => void;
}) {
  const update = useUpdateStaff();
  const [roleKey, setRoleKey] = useState(member.role.key);
  const [isProfessional, setIsProfessional] = useState(member.isProfessional);
  const [active, setActive] = useState(member.active);

  const save = async () => {
    try {
      await update.mutateAsync({
        id: member.id,
        isProfessional,
        // A API impede alterar o próprio papel/ativo; nem enviamos.
        ...(isSelf ? {} : { roleKey: roleKey === member.role.key ? undefined : roleKey, active }),
      });
      toast.success('Dados atualizados.');
      onDone();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle className="font-heading text-2xl uppercase">{member.name}</DialogTitle>
        <DialogDescription>{member.email}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label>Papel</Label>
        {isSelf ? (
          <p className="text-muted-foreground text-sm">
            {member.role.name} (você não pode alterar o próprio papel)
          </p>
        ) : (
          <RoleSelect value={roleKey} onChange={setRoleKey} />
        )}
      </div>
      <div className="flex items-center gap-2">
        <Switch id="edit-is-professional" checked={isProfessional} onCheckedChange={setIsProfessional} />
        <Label htmlFor="edit-is-professional">Atende clientes (aparece na agenda)</Label>
      </div>
      {!isSelf && (
        <div className="flex items-center gap-2">
          <Switch id="edit-active" checked={active} onCheckedChange={setActive} />
          <Label htmlFor="edit-active">Ativo (pode entrar no painel)</Label>
        </div>
      )}
      <Button onClick={save} disabled={update.isPending}>
        Salvar
      </Button>
    </div>
  );
}

// ───────────── Expediente e folgas ─────────────

interface Interval {
  weekday: number;
  start: string;
  end: string;
}

function ScheduleEditor({ member }: { member: StaffMember }) {
  const schedule = useSchedule(member.id);
  return (
    <div className="flex flex-col gap-6 p-4">
      <SheetHeader className="p-0">
        <SheetTitle className="font-heading text-2xl uppercase">{member.name}</SheetTitle>
        <SheetDescription>
          Expediente semanal e folgas. A agenda online só oferece horários dentro dele.
        </SheetDescription>
      </SheetHeader>
      {schedule.isLoading ? (
        <LoadingRows rows={7} />
      ) : schedule.error ? (
        <ErrorState error={schedule.error} onRetry={() => schedule.refetch()} />
      ) : (
        <WeekEditor memberId={member.id} initial={schedule.data!} />
      )}
      <TimeOffs memberId={member.id} />
    </div>
  );
}

function WeekEditor({ memberId, initial }: { memberId: string; initial: Interval[] }) {
  const save = useReplaceSchedule(memberId);
  const [intervals, setIntervals] = useState<Interval[]>(initial);

  const update = (index: number, patch: Partial<Interval>) =>
    setIntervals((current) =>
      current.map((interval, i) => (i === index ? { ...interval, ...patch } : interval)),
    );
  const remove = (index: number) => setIntervals((current) => current.filter((_, i) => i !== index));
  const add = (weekday: number) =>
    setIntervals((current) => [...current, { weekday, start: '09:00', end: '18:00' }]);
  /** Repete o expediente deste dia de segunda a sábado (domingo fica como está). */
  const copyToOthers = (weekday: number) => {
    const source = intervals.filter((interval) => interval.weekday === weekday);
    const targets = [1, 2, 3, 4, 5, 6].filter((day) => day !== weekday);
    setIntervals([
      ...intervals.filter((interval) => !targets.includes(interval.weekday)),
      ...targets.flatMap((day) => source.map((interval) => ({ ...interval, weekday: day }))),
    ]);
  };

  const submit = async () => {
    try {
      await save.mutateAsync({ intervals });
      toast.success('Expediente salvo.');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <section aria-labelledby="week-title" className="grid gap-3">
      <h2 id="week-title" className="text-xl font-bold">
        Expediente semanal
      </h2>
      {WEEKDAYS.map((label, weekday) => {
        const dayIntervals = intervals
          .map((interval, index) => ({ interval, index }))
          .filter(({ interval }) => interval.weekday === weekday);
        return (
          <fieldset key={label} className="border-border grid gap-2 rounded-md border p-3">
            <legend className="px-1 text-sm font-semibold">{label}</legend>
            {dayIntervals.length === 0 && <p className="text-muted-foreground text-sm">Folga</p>}
            {dayIntervals.map(({ interval, index }) => (
              <div key={index} className="flex items-center gap-2">
                <Label htmlFor={`start-${index}`} className="sr-only">
                  Início ({label})
                </Label>
                <Input
                  id={`start-${index}`}
                  type="time"
                  step={900}
                  value={interval.start}
                  onChange={(event) => update(index, { start: event.target.value })}
                  className="w-32"
                />
                <span aria-hidden>até</span>
                <Label htmlFor={`end-${index}`} className="sr-only">
                  Fim ({label})
                </Label>
                <Input
                  id={`end-${index}`}
                  type="time"
                  step={900}
                  value={interval.end}
                  onChange={(event) => update(index, { end: event.target.value })}
                  className="w-32"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remover intervalo de ${label}`}
                  onClick={() => remove(index)}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => add(weekday)}>
                <Plus aria-hidden /> Intervalo
              </Button>
              {dayIntervals.length > 0 && weekday !== 0 && (
                <Button variant="ghost" size="sm" onClick={() => copyToOthers(weekday)}>
                  Copiar para seg–sáb
                </Button>
              )}
            </div>
          </fieldset>
        );
      })}
      <Button onClick={submit} disabled={save.isPending}>
        Salvar expediente
      </Button>
    </section>
  );
}

function TimeOffs({ memberId }: { memberId: string }) {
  const barbershop = useBarbershop();
  const timezone = barbershop.data?.timezone ?? 'America/Sao_Paulo';
  const today = todayIn(timezone);
  const from = localInstant(today, 0, timezone).toISOString();
  const to = localInstant(addDays(today, 90), 0, timezone).toISOString();
  const timeOffs = useTimeOffs(memberId, from, to);
  const create = useCreateTimeOff(memberId);
  const remove = useDeleteTimeOff(memberId);
  const [form, setForm] = useState({ date: today, start: '12:00', end: '18:00', reason: '' });

  const toMinutes = (time: string) => {
    const [h, m] = time.split(':').map(Number);
    return h! * 60 + m!;
  };

  const submit = async () => {
    try {
      await create.mutateAsync({
        startsAt: localInstant(form.date, toMinutes(form.start), timezone).toISOString(),
        endsAt: localInstant(form.date, toMinutes(form.end), timezone).toISOString(),
        reason: form.reason || undefined,
      });
      toast.success('Bloqueio registrado.');
      setForm((current) => ({ ...current, reason: '' }));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <section aria-labelledby="timeoff-title" className="grid gap-3">
      <h2 id="timeoff-title" className="text-xl font-bold">
        Folgas e bloqueios
      </h2>
      <div className="border-border grid gap-3 rounded-md border p-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="timeoff-date">Dia</Label>
          <Input
            id="timeoff-date"
            type="date"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="timeoff-reason">Motivo (opcional)</Label>
          <Input
            id="timeoff-reason"
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="timeoff-start">Das</Label>
          <Input
            id="timeoff-start"
            type="time"
            step={900}
            value={form.start}
            onChange={(e) => setForm({ ...form, start: e.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="timeoff-end">Até</Label>
          <Input
            id="timeoff-end"
            type="time"
            step={900}
            value={form.end}
            onChange={(e) => setForm({ ...form, end: e.target.value })}
          />
        </div>
        <Button variant="outline" className="sm:col-span-2" onClick={submit} disabled={create.isPending}>
          <CalendarOff aria-hidden /> Bloquear horário
        </Button>
      </div>
      {timeOffs.data && timeOffs.data.length > 0 ? (
        <ul className="divide-border border-border divide-y rounded-md border text-sm">
          {timeOffs.data.map((timeOff) => (
            <li key={timeOff.id} className="flex items-center justify-between px-3 py-2">
              <span>
                {formatDateTime(timeOff.startsAt, timezone)} – {formatDateTime(timeOff.endsAt, timezone)}
                {timeOff.reason && <span className="text-muted-foreground"> · {timeOff.reason}</span>}
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Remover bloqueio"
                onClick={() =>
                  remove.mutate(timeOff.id, { onError: (error) => toast.error(errorMessage(error)) })
                }
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">Nenhum bloqueio nos próximos 90 dias.</p>
      )}
    </section>
  );
}
