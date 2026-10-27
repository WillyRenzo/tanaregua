'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { StatusBadge } from '@/components/appointment-status';
import { EmptyState, ErrorState, LoadingRows } from '@/components/states';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/api/errors';
import { formatDateLong, formatMoney, formatTime } from '@/lib/format';
import { useCancelBooking, useMyAppointments } from '@/lib/public-queries';
import type { Schemas } from '@/lib/queries';
import { useNow } from '@/lib/use-now';
import { ClientAuthForm } from '../client-auth-form';
import { useClientSession } from '../use-client-session';

export function MyAppointments({
  timezone,
  cancellationMinNoticeMinutes,
}: {
  timezone: string;
  cancellationMinNoticeMinutes: number;
}) {
  const { slug } = useParams<{ slug: string }>();
  const { isClientHere, loading } = useClientSession(slug);
  const appointments = useMyAppointments(slug, isClientHere);
  const now = useNow();

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
              canCancel={
                ['SCHEDULED', 'CONFIRMED'].includes(appointment.status) &&
                new Date(appointment.startsAt).getTime() - cancellationMinNoticeMinutes * 60_000 > now
              }
              isFuture={new Date(appointment.startsAt).getTime() > now}
            />
          ))}
        </ul>
      )}
    </main>
  );
}

function AppointmentCard({
  appointment,
  slug,
  timezone,
  canCancel,
  isFuture,
}: {
  appointment: Schemas['ClientAppointment'];
  slug: string;
  timezone: string;
  canCancel: boolean;
  isFuture: boolean;
}) {
  const cancel = useCancelBooking(slug);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(
    new Date(appointment.startsAt),
  );

  const handleCancel = () =>
    cancel.mutate(appointment.id, {
      onSuccess: () => toast.success('Horário cancelado.'),
      onError: (error) => toast.error(errorMessage(error)),
    });

  return (
    <li className="border-border rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-heading text-2xl font-bold uppercase">
            {formatTime(appointment.startsAt, timezone)}
            <span className="text-muted-foreground ml-2 font-sans text-sm font-normal normal-case">
              {formatDateLong(date, timezone)}
            </span>
          </p>
          <p className="text-sm">
            {appointment.items.map((item) => item.name).join(', ')} · {appointment.professional.name}
          </p>
          <p className="text-muted-foreground text-sm">{formatMoney(appointment.totalCents)}</p>
        </div>
        <StatusBadge status={appointment.status} />
      </div>
      {canCancel ? (
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive mt-2 -ml-2"
          onClick={handleCancel}
          disabled={cancel.isPending}
        >
          Cancelar horário
        </Button>
      ) : (
        isFuture &&
        ['SCHEDULED', 'CONFIRMED'].includes(appointment.status) && (
          <p className="text-muted-foreground mt-2 text-xs">Para cancelar agora, fale com a barbearia.</p>
        )
      )}
    </li>
  );
}
