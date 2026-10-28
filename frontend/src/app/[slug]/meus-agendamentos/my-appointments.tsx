'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { StatusBadge } from '@/components/appointment-status';
import { EmptyState, ErrorState, LoadingRows } from '@/components/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { PackageStatusBadge } from '@/components/package-status';
import { formatDate, formatDateLong, formatMoney, formatTime } from '@/lib/format';
import {
  useCancelBooking,
  useMyAppointments,
  useMyPackages,
  useRescheduleBooking,
} from '@/lib/public-queries';
import type { Schemas } from '@/lib/queries';
import { useNow } from '@/lib/use-now';
import { ClientAuthForm } from '../client-auth-form';
import { SlotPicker } from '../slot-picker';
import { useClientSession } from '../use-client-session';

type ClientAppointment = Schemas['ClientAppointment'];

const ACTIVE = ['SCHEDULED', 'CONFIRMED'];

const localDate = (instant: string, timezone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(instant));

export function MyAppointments({
  timezone,
  cancellationMinNoticeMinutes,
  rescheduleMinNoticeMinutes,
}: {
  timezone: string;
  cancellationMinNoticeMinutes: number;
  rescheduleMinNoticeMinutes: number;
}) {
  const { slug } = useParams<{ slug: string }>();
  const { isClientHere, loading } = useClientSession(slug);
  const appointments = useMyAppointments(slug, isClientHere);
  const now = useNow();
  const [rescheduling, setRescheduling] = useState<ClientAppointment | null>(null);

  /** Ainda dá tempo para a ação online? (a API revalida com o prazo da barbearia) */
  const beforeNotice = (appointment: ClientAppointment, noticeMinutes: number) =>
    ACTIVE.includes(appointment.status) &&
    new Date(appointment.startsAt).getTime() - noticeMinutes * 60_000 > now;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
        <Link href={`/${slug}`}>
          <ArrowLeft aria-hidden /> Agendar
        </Link>
      </Button>
      <h1 className="mb-6 text-4xl font-bold">Meus agendamentos</h1>

      {loading ? (
        <LoadingRows rows={3} />
      ) : !isClientHere ? (
        <div className="max-w-sm">
          <p className="text-muted-foreground mb-4 text-sm">Entre para ver e gerenciar seus horários.</p>
          <ClientAuthForm slug={slug} onAuthenticated={() => undefined} />
        </div>
      ) : appointments.isLoading ? (
        <LoadingRows rows={3} />
      ) : appointments.error ? (
        <ErrorState error={appointments.error} onRetry={() => appointments.refetch()} />
      ) : appointments.data!.length === 0 ? (
        <EmptyState
          title="Nenhum horário ainda"
          action={
            <Button asChild>
              <Link href={`/${slug}`}>Agendar agora</Link>
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-3">
          {appointments.data!.map((appointment) => (
            <AppointmentCard
              key={appointment.id}
              appointment={appointment}
              slug={slug}
              timezone={timezone}
              canCancel={beforeNotice(appointment, cancellationMinNoticeMinutes)}
              canReschedule={beforeNotice(appointment, rescheduleMinNoticeMinutes)}
              onReschedule={() => setRescheduling(appointment)}
              isFuture={new Date(appointment.startsAt).getTime() > now}
            />
          ))}
        </ul>
      )}

      {isClientHere && <MyPackages slug={slug} timezone={timezone} />}

      {rescheduling && (
        <RescheduleDialog
          slug={slug}
          timezone={timezone}
          appointment={rescheduling}
          onClose={() => setRescheduling(null)}
        />
      )}
    </main>
  );
}

/** Saldo dos pacotes do cliente nesta barbearia (só consulta: o uso é registrado no balcão). */
function MyPackages({ slug, timezone }: { slug: string; timezone: string }) {
  const packages = useMyPackages(slug, true);
  if (!packages.data || packages.data.length === 0) return null;

  return (
    <section aria-labelledby="my-packages" className="mt-10">
      <h2 id="my-packages" className="mb-1 text-2xl font-bold">
        Meus pacotes
      </h2>
      <p className="text-muted-foreground mb-4 text-sm">
        As sessões são descontadas no atendimento, na barbearia.
      </p>
      <ul className="grid gap-3">
        {packages.data.map((myPackage) => (
          <li key={myPackage.id} className="bg-card border-border rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{myPackage.name}</span>
              <PackageStatusBadge status={myPackage.status} />
            </div>
            <ul className="mt-2 grid gap-1 text-sm">
              {myPackage.balances.map((balance) => (
                <li key={balance.serviceId} className="flex justify-between gap-4">
                  <span>{balance.name}</span>
                  <span>
                    <strong>{balance.remaining}</strong> de {balance.initialQuantity} restantes
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground mt-2 text-xs">
              {myPackage.status === 'EXPIRED' ? 'Venceu em ' : 'Válido até '}
              {formatDate(myPackage.expiresAt, timezone)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AppointmentCard({
  appointment,
  slug,
  timezone,
  canCancel,
  canReschedule,
  onReschedule,
  isFuture,
}: {
  appointment: ClientAppointment;
  slug: string;
  timezone: string;
  canCancel: boolean;
  canReschedule: boolean;
  onReschedule: () => void;
  isFuture: boolean;
}) {
  const cancel = useCancelBooking(slug);

  const handleCancel = () =>
    cancel.mutate(appointment.id, {
      onSuccess: () => toast.success('Horário cancelado.'),
      onError: (error) => toast.error(errorMessage(error)),
    });

  const blockedActions = [!canReschedule && 'reagendar', !canCancel && 'cancelar'].filter(Boolean);

  return (
    <li className="border-border rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-heading text-2xl font-bold uppercase">
            {formatTime(appointment.startsAt, timezone)}
            <span className="text-muted-foreground ml-2 font-sans text-sm font-normal normal-case">
              {formatDateLong(localDate(appointment.startsAt, timezone), timezone)}
            </span>
          </p>
          <p className="text-sm">
            {appointment.items.map((item) => item.name).join(', ')} · {appointment.professional.name}
          </p>
          <p className="text-muted-foreground text-sm">{formatMoney(appointment.totalCents)}</p>
        </div>
        <StatusBadge status={appointment.status} />
      </div>
      {(canReschedule || canCancel) && (
        <div className="mt-2 -ml-2 flex flex-wrap gap-1">
          {canReschedule && (
            <Button variant="ghost" size="sm" onClick={onReschedule}>
              Reagendar
            </Button>
          )}
          {canCancel && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={handleCancel}
              disabled={cancel.isPending}
            >
              Cancelar horário
            </Button>
          )}
        </div>
      )}
      {isFuture && ACTIVE.includes(appointment.status) && blockedActions.length > 0 && (
        <p className="text-muted-foreground mt-2 text-xs">
          Para {blockedActions.join(' ou ')} agora, fale com a barbearia.
        </p>
      )}
    </li>
  );
}

function RescheduleDialog({
  slug,
  timezone,
  appointment,
  onClose,
}: {
  slug: string;
  timezone: string;
  appointment: ClientAppointment;
  onClose: () => void;
}) {
  const reschedule = useRescheduleBooking(slug);
  const [date, setDate] = useState(() => localDate(appointment.startsAt, timezone));
  const [startsAt, setStartsAt] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const confirm = () =>
    reschedule.mutate(
      { id: appointment.id, startsAt: startsAt! },
      {
        onSuccess: () => {
          toast.success('Horário remarcado. Enviamos a confirmação para o seu e-mail.');
          onClose();
        },
        onError: (error) => {
          if (error instanceof ApiError && error.code === 'slot-unavailable') {
            setNotice('Alguém acabou de reservar esse horário. Escolha outro, por favor.');
            setStartsAt(null);
            return;
          }
          setNotice(errorMessage(error));
        },
      },
    );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Reagendar horário</DialogTitle>
          <DialogDescription>
            {appointment.items.map((item) => item.name).join(', ')} com {appointment.professional.name}. Hoje
            marcado para {formatDateLong(localDate(appointment.startsAt, timezone), timezone)} às{' '}
            {formatTime(appointment.startsAt, timezone)}.
          </DialogDescription>
        </DialogHeader>

        {notice && (
          <Alert variant="destructive">
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}

        {startsAt ? (
          <p className="text-lg">
            Novo horário: {formatDateLong(date, timezone)} às{' '}
            <strong>{formatTime(startsAt, timezone)}</strong>
          </p>
        ) : (
          <SlotPicker
            slug={slug}
            timezone={timezone}
            serviceIds={appointment.items.map((item) => item.serviceId)}
            professionalId={appointment.professional.id}
            date={date}
            onDateChange={setDate}
            onSelect={(start) => {
              setNotice(null);
              setStartsAt(start);
            }}
            title={null}
          />
        )}

        <DialogFooter>
          {startsAt && (
            <Button variant="ghost" onClick={() => setStartsAt(null)}>
              Escolher outro
            </Button>
          )}
          <Button onClick={confirm} disabled={!startsAt || reschedule.isPending}>
            {reschedule.isPending ? 'Remarcando…' : 'Confirmar novo horário'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
