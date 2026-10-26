'use client';

import Link from 'next/link';
import { ArrowRight, CalendarDays } from 'lucide-react';
import { StatusBadge } from '@/components/appointment-status';
import { ErrorState, LoadingRows, PageHeader } from '@/components/states';
import { Button } from '@/components/ui/button';
import { formatDateLong, formatMoney, formatTime, todayIn } from '@/lib/format';
import { can } from '@/lib/permissions';
import { useBarbershop, useCommissions, useDayAgenda, useReportSummary } from '@/lib/queries';
import { useAuthenticatedSession } from '@/lib/session/use-session';
import { useNow } from '@/lib/use-now';

/**
 * Início por papel (F6): o dono vê o dia em números; a recepção e o profissional
 * veem os próximos atendimentos; o profissional também vê a própria comissão do mês.
 */
export function HomeView() {
  const session = useAuthenticatedSession();
  const barbershop = useBarbershop();
  if (barbershop.isLoading) return <LoadingRows />;
  if (barbershop.error) return <ErrorState error={barbershop.error} onRetry={() => barbershop.refetch()} />;

  const timezone = barbershop.data!.timezone;
  const today = todayIn(timezone);
  const firstName = session.profile.user.name.split(' ')[0];

  return (
    <>
      <PageHeader title={`Olá, ${firstName}`} description={formatDateLong(today, timezone)} />
      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        {can(session, 'appointments:read:any', 'appointments:read:own') && (
          <NextAppointments today={today} timezone={timezone} />
        )}
        <aside className="grid content-start gap-4">
          {can(session, 'reports:read') && <TodayFigures today={today} />}
          {!can(session, 'commissions:read:any') && can(session, 'commissions:read:own') && (
            <MyCommission today={today} />
          )}
        </aside>
      </div>
    </>
  );
}

function NextAppointments({ today, timezone }: { today: string; timezone: string }) {
  const agenda = useDayAgenda(today);
  const now = useNow();
  const upcoming =
    agenda.data?.professionals
      .flatMap((professional) => professional.appointments)
      .filter(
        (appointment) => new Date(appointment.endsAt).getTime() > now && appointment.status !== 'NO_SHOW',
      )
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .slice(0, 8) ?? [];

  return (
    <section aria-labelledby="next-title">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="next-title" className="text-xl font-bold">
          Próximos atendimentos
        </h2>
        <Button asChild variant="ghost" size="sm">
          <Link href="/painel/agenda">
            <CalendarDays aria-hidden /> Agenda <ArrowRight aria-hidden />
          </Link>
        </Button>
      </div>
      {agenda.isLoading ? (
        <LoadingRows rows={4} />
      ) : agenda.error ? (
        <ErrorState error={agenda.error} onRetry={() => agenda.refetch()} />
      ) : upcoming.length === 0 ? (
        <p className="text-muted-foreground border-border rounded-lg border border-dashed p-6 text-sm">
          Nenhum atendimento pela frente hoje.
        </p>
      ) : (
        <ol className="divide-border border-border divide-y rounded-lg border">
          {upcoming.map((appointment) => (
            <li key={appointment.id} className="flex items-center gap-4 px-4 py-3">
              <span className="font-heading w-14 text-2xl font-bold">
                {formatTime(appointment.startsAt, timezone)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{appointment.client.name}</span>
                <span className="text-muted-foreground block truncate text-sm">
                  {appointment.items.map((item) => item.name).join(', ')} · {appointment.professional.name}
                </span>
              </span>
              <StatusBadge status={appointment.status} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function TodayFigures({ today }: { today: string }) {
  const report = useReportSummary(today, today);
  return (
    <div className="bg-sidebar text-sidebar-foreground rounded-lg p-5">
      <p className="text-sidebar-foreground/70 text-sm">Faturado hoje</p>
      <p className="mt-1 text-4xl font-semibold">
        {report.data ? formatMoney(report.data.revenue.netCents) : '—'}
      </p>
      <Link
        href="/painel/relatorios"
        className="text-sidebar-primary mt-3 inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
      >
        Ver relatórios <ArrowRight aria-hidden className="size-4" />
      </Link>
    </div>
  );
}

function MyCommission({ today }: { today: string }) {
  const commissions = useCommissions(`${today.slice(0, 8)}01`, today);
  const total = commissions.data?.professionals.reduce((sum, row) => sum + row.totalCents, 0) ?? 0;
  return (
    <div className="bg-card border-border rounded-lg border p-5">
      <p className="text-muted-foreground text-sm">Minha comissão no mês</p>
      <p className="mt-1 text-4xl font-semibold">{commissions.data ? formatMoney(total) : '—'}</p>
      <Link
        href="/painel/comissoes"
        className="text-primary mt-3 inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
      >
        Detalhes <ArrowRight aria-hidden className="size-4" />
      </Link>
    </div>
  );
}
