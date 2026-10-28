'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { StatusBadge } from '@/components/appointment-status';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatDateLong, formatTime, todayIn } from '@/lib/format';
import { can } from '@/lib/permissions';
import { useAppointmentsRange, useBarbershop, useDayAgenda, type DayAgenda } from '@/lib/queries';
import { useAuthenticatedSession } from '@/lib/session/use-session';
import { containsDate, periodLabel, periodRange, shiftPeriod, type AgendaMode } from './agenda-periods';
import { AppointmentSheet, type SheetState } from './appointment-sheet';
import { DayGrid } from './day-grid';
import { MonthView, WeekView } from './period-views';

export function AgendaView() {
  const barbershop = useBarbershop();
  if (barbershop.isLoading) return <LoadingRows rows={8} label="Carregando agenda" />;
  if (barbershop.error) return <ErrorState error={barbershop.error} onRetry={() => barbershop.refetch()} />;
  return <AgendaForTimezone timezone={barbershop.data!.timezone} />;
}

const NAVIGATION: Record<AgendaMode, { previous: string; next: string }> = {
  day: { previous: 'Dia anterior', next: 'Próximo dia' },
  week: { previous: 'Semana anterior', next: 'Próxima semana' },
  month: { previous: 'Mês anterior', next: 'Próximo mês' },
};

const ALL = 'all';

function AgendaForTimezone({ timezone }: { timezone: string }) {
  const session = useAuthenticatedSession();
  const today = todayIn(timezone);
  const [view, setView] = useState<AgendaMode>('day');
  const [date, setDate] = useState(today);
  const [professionalFilter, setProfessionalFilter] = useState(ALL);
  const [sheet, setSheet] = useState<SheetState>({ mode: 'closed' });
  // A agenda do dia também fornece a lista de profissionais (filtro e ficha).
  const agenda = useDayAgenda(date);
  const canWrite = can(session, 'appointments:write:any', 'appointments:write:own');
  // Quem só vê a própria agenda não precisa (nem pode) filtrar por outro profissional.
  const canFilter = can(session, 'appointments:read:any');
  const professionals = agenda.data?.professionals.map(({ id, name }) => ({ id, name })) ?? [];
  const professionalId = canFilter && professionalFilter !== ALL ? professionalFilter : undefined;
  const range = useAppointmentsRange(
    { ...periodRange(view, date, timezone), professionalId },
    view !== 'day',
  );
  const navigation = NAVIGATION[view];
  const showDay = (day: string) => {
    setDate(day);
    setView('day');
  };
  const dayAgenda = agenda.data && {
    ...agenda.data,
    professionals: agenda.data.professionals.filter(
      (professional) => !professionalId || professional.id === professionalId,
    ),
  };

  return (
    <>
      <PageHeader
        title="Agenda"
        description={view === 'day' ? formatDateLong(date, timezone) : periodLabel(view, date)}
        actions={
          <>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                aria-label={navigation.previous}
                onClick={() => setDate(shiftPeriod(view, date, -1))}
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="outline"
                onClick={() => setDate(today)}
                disabled={view === 'day' ? date === today : containsDate(view, date, today)}
              >
                Hoje
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label={navigation.next}
                onClick={() => setDate(shiftPeriod(view, date, 1))}
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

      <Tabs value={view} onValueChange={(value) => setView(value as AgendaMode)}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <TabsList aria-label="Visualização">
            <TabsTrigger value="day">Dia</TabsTrigger>
            <TabsTrigger value="week">Semana</TabsTrigger>
            <TabsTrigger value="month">Mês</TabsTrigger>
          </TabsList>
          {canFilter && professionals.length > 1 && (
            <div className="grid w-full gap-1.5 sm:w-56">
              <Label htmlFor="agenda-professional">Profissional</Label>
              <Select value={professionalFilter} onValueChange={setProfessionalFilter}>
                <SelectTrigger id="agenda-professional" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Todos os profissionais</SelectItem>
                  {professionals.map((professional) => (
                    <SelectItem key={professional.id} value={professional.id}>
                      {professional.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <TabsContent value="day" className="pt-4">
          {agenda.isLoading ? (
            <LoadingRows rows={8} label="Carregando agenda" />
          ) : agenda.error ? (
            <ErrorState error={agenda.error} onRetry={() => agenda.refetch()} />
          ) : dayAgenda!.professionals.length === 0 ? (
            <EmptyState title="Ninguém atendendo">
              Cadastre a equipe e marque quem atende em Equipe para as colunas aparecerem aqui.
            </EmptyState>
          ) : (
            <>
              <div className="hidden md:block">
                <DayGrid
                  agenda={dayAgenda!}
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
                  agenda={dayAgenda!}
                  onSelect={(appointment) => setSheet({ mode: 'view', appointment })}
                />
              </div>
            </>
          )}
        </TabsContent>

        {(['week', 'month'] as const).map((period) => {
          const PeriodView = period === 'week' ? WeekView : MonthView;
          return (
            <TabsContent key={period} value={period} className="pt-4">
              {range.isLoading ? (
                <LoadingRows rows={8} label="Carregando agenda" />
              ) : range.error ? (
                <ErrorState error={range.error} onRetry={() => range.refetch()} />
              ) : (
                <PeriodView
                  date={date}
                  today={today}
                  timezone={timezone}
                  appointments={range.data ?? []}
                  showProfessional={!professionalId}
                  onSelectAppointment={(appointment) => setSheet({ mode: 'view', appointment })}
                  onSelectDay={showDay}
                />
              )}
            </TabsContent>
          );
        })}
      </Tabs>

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
