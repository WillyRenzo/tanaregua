'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { StatusBadge } from '@/components/appointment-status';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { addDays, formatDateLong, formatTime, todayIn } from '@/lib/format';
import { can } from '@/lib/permissions';
import { useBarbershop, useDayAgenda, type DayAgenda } from '@/lib/queries';
import { useAuthenticatedSession } from '@/lib/session/use-session';
import { AppointmentSheet, type SheetState } from './appointment-sheet';
import { DayGrid } from './day-grid';

export function AgendaView() {
  const barbershop = useBarbershop();
  if (barbershop.isLoading) return <LoadingRows rows={8} label="Carregando agenda" />;
  if (barbershop.error) return <ErrorState error={barbershop.error} onRetry={() => barbershop.refetch()} />;
  return <AgendaForTimezone timezone={barbershop.data!.timezone} />;
}

function AgendaForTimezone({ timezone }: { timezone: string }) {
  const session = useAuthenticatedSession();
  const today = todayIn(timezone);
  const [date, setDate] = useState(today);
  const [sheet, setSheet] = useState<SheetState>({ mode: 'closed' });
  const agenda = useDayAgenda(date);
  const canWrite = can(session, 'appointments:write:any', 'appointments:write:own');
  const professionals = agenda.data?.professionals.map(({ id, name }) => ({ id, name })) ?? [];

  return (
    <>
      <PageHeader
        title="Agenda"
        description={formatDateLong(date, timezone)}
        actions={
          <>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                aria-label="Dia anterior"
                onClick={() => setDate(addDays(date, -1))}
              >
                <ChevronLeft />
              </Button>
              <Button variant="outline" onClick={() => setDate(today)} disabled={date === today}>
                Hoje
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Próximo dia"
                onClick={() => setDate(addDays(date, 1))}
              >
                <ChevronRight />
              </Button>
            </div>
            <Label htmlFor="agenda-date" className="sr-only">
              Escolher data
            </Label>
            <Input
              id="agenda-date"
              type="date"
              value={date}
              onChange={(event) => event.target.value && setDate(event.target.value)}
              className="w-auto"
            />
            {canWrite && (
              <Button onClick={() => setSheet({ mode: 'create', date })}>
                <Plus aria-hidden /> Novo agendamento
              </Button>
            )}
          </>
        }
      />

      {agenda.isLoading ? (
        <LoadingRows rows={8} label="Carregando agenda" />
      ) : agenda.error ? (
        <ErrorState error={agenda.error} onRetry={() => agenda.refetch()} />
      ) : agenda.data!.professionals.length === 0 ? (
        <EmptyState title="Ninguém atendendo">
          Cadastre a equipe e marque quem atende em Equipe para as colunas aparecerem aqui.
        </EmptyState>
      ) : (
        <>
          <div className="hidden md:block">
            <DayGrid
              agenda={agenda.data!}
              isToday={date === today}
              onSelectAppointment={(appointment) => setSheet({ mode: 'view', appointment })}
              onSelectSlot={
                canWrite
                  ? (professionalId, minute) => setSheet({ mode: 'create', professionalId, date, minute })
                  : undefined
              }
            />
          </div>
          <div className="md:hidden">
            <AgendaList
              agenda={agenda.data!}
              onSelect={(appointment) => setSheet({ mode: 'view', appointment })}
            />
          </div>
        </>
      )}

      <AppointmentSheet
        state={sheet}
        onClose={() => setSheet({ mode: 'closed' })}
        professionals={professionals}
        timezone={timezone}
      />
    </>
  );
}

/** No celular a grade não cabe: lista por profissional, em ordem de horário. */
function AgendaList({
  agenda,
  onSelect,
}: {
  agenda: DayAgenda;
  onSelect: (appointment: DayAgenda['professionals'][number]['appointments'][number]) => void;
}) {
  return (
    <div className="grid gap-6">
      {agenda.professionals.map((professional) => (
        <section key={professional.id} aria-labelledby={`prof-${professional.id}`}>
          <h2 id={`prof-${professional.id}`} className="mb-2 text-xl font-bold">
            {professional.name}
          </h2>
          {professional.appointments.length === 0 ? (
            <p className="text-muted-foreground text-sm">Sem atendimentos.</p>
          ) : (
            <ul className="divide-border border-border divide-y rounded-lg border">
              {professional.appointments.map((appointment) => (
                <li key={appointment.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(appointment)}
                    className="hover:bg-accent flex w-full items-center justify-between gap-3 px-3 py-3 text-left"
                  >
                    <span>
                      <span className="block font-semibold">
                        {formatTime(appointment.startsAt, agenda.timezone)} · {appointment.client.name}
                      </span>
                      <span className="text-muted-foreground text-sm">
                        {appointment.items.map((item) => item.name).join(', ')}
                      </span>
                    </span>
                    <StatusBadge status={appointment.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
