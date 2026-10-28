'use client';

import { STATUS_META } from '@/components/appointment-status';
import { formatTime } from '@/lib/format';
import type { Appointment } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { groupByDate, monthWeeks, weekDays } from './agenda-periods';

interface PeriodViewProps {
  date: string;
  today: string;
  timezone: string;
  appointments: Appointment[];
  /** Com "todos os profissionais" o card mostra quem atende. */
  showProfessional: boolean;
  onSelectAppointment: (appointment: Appointment) => void;
  onSelectDay: (date: string) => void;
}

const dayLabel = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', ...options }).format(new Date(`${date}T12:00:00Z`));

const WEEKDAY_NAMES = weekDays('2026-01-04').map((date) => ({
  short: dayLabel(date, { weekday: 'short' }).replace('.', ''),
  long: dayLabel(date, { weekday: 'long' }),
}));

const isActive = (appointment: Appointment) => appointment.status !== 'CANCELLED';

/** Semana: uma coluna por dia (domingo a sábado), atendimentos em ordem de horário. */
export function WeekView({
  date,
  today,
  timezone,
  appointments,
  showProfessional,
  onSelectAppointment,
  onSelectDay,
}: PeriodViewProps) {
  const byDate = groupByDate(appointments, timezone);

  return (
    <div className="grid gap-3 md:grid-cols-7 md:gap-2">
      {weekDays(date).map((day) => {
        const dayAppointments = byDate.get(day) ?? [];
        const count = dayAppointments.filter(isActive).length;
        return (
          <section
            key={day}
            aria-labelledby={`week-${day}`}
            className={cn(
              'border-border flex min-w-0 flex-col rounded-lg border',
              day === today && 'border-primary',
            )}
          >
            <h2 id={`week-${day}`}>
              <button
                type="button"
                onClick={() => onSelectDay(day)}
                className={cn(
                  'hover:bg-accent focus-visible:ring-ring flex w-full items-baseline justify-between gap-2 rounded-t-lg px-3 py-2 text-left focus-visible:ring-2 focus-visible:outline-none',
                  day === today ? 'bg-accent' : 'bg-muted',
                )}
              >
                <span className="font-heading text-lg font-semibold uppercase">
                  {dayLabel(day, { weekday: 'short' }).replace('.', '')}{' '}
                  {dayLabel(day, { day: '2-digit', month: '2-digit' })}
                  <span className="sr-only">: ver o dia</span>
                </span>
                <span className="text-muted-foreground text-xs">
                  {count === 0 ? 'livre' : count === 1 ? '1 atend.' : `${count} atend.`}
                </span>
              </button>
            </h2>
            {dayAppointments.length === 0 ? (
              <p className="text-muted-foreground px-3 py-3 text-sm">Sem atendimentos.</p>
            ) : (
              <ul className="grid gap-1.5 p-1.5">
                {dayAppointments.map((appointment) => (
                  <li key={appointment.id}>
                    <AppointmentCard
                      appointment={appointment}
                      timezone={timezone}
                      showProfessional={showProfessional}
                      onSelect={onSelectAppointment}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function AppointmentCard({
  appointment,
  timezone,
  showProfessional,
  onSelect,
}: {
  appointment: Appointment;
  timezone: string;
  showProfessional: boolean;
  onSelect: (appointment: Appointment) => void;
}) {
  const meta = STATUS_META[appointment.status];
  return (
    <button
      type="button"
      onClick={() => onSelect(appointment)}
      className="bg-card border-border hover:bg-accent focus-visible:ring-ring grid w-full gap-0.5 rounded-md border px-2 py-1.5 text-left text-sm focus-visible:ring-2 focus-visible:outline-none"
    >
      <span className="truncate font-semibold">
        {formatTime(appointment.startsAt, timezone)} · {appointment.client.name}
      </span>
      <span className="text-muted-foreground truncate text-xs">
        {appointment.items.map((item) => item.name).join(', ')}
      </span>
      {showProfessional && <span className="truncate text-xs">{appointment.professional.name}</span>}
      <span className={cn('inline-flex items-center gap-1 text-xs font-medium', meta.className)}>
        <meta.icon aria-hidden className="size-3.5 shrink-0" /> {meta.label}
      </span>
    </button>
  );
}

/** Quantos atendimentos aparecem por dia no mês antes do "+N". */
const MONTH_PREVIEW = 3;

/** Mês: calendário de domingo a sábado; cada dia mostra os primeiros horários e o total. */
export function MonthView({
  date,
  today,
  timezone,
  appointments,
  showProfessional,
  onSelectAppointment,
  onSelectDay,
}: PeriodViewProps) {
  const byDate = groupByDate(appointments.filter(isActive), timezone);
  const month = date.slice(0, 7);

  return (
    <div className="border-border overflow-hidden rounded-lg border">
      <table className="w-full table-fixed border-collapse">
        <caption className="sr-only">Atendimentos do mês (cancelados não aparecem)</caption>
        <thead>
          <tr>
            {WEEKDAY_NAMES.map((name) => (
              <th
                key={name.long}
                scope="col"
                abbr={name.long}
                className="bg-muted font-heading border-border border-b px-1 py-2 text-sm font-semibold uppercase"
              >
                {name.short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthWeeks(date).map((week) => (
            <tr key={week[0]}>
              {week.map((day) => {
                const dayAppointments = byDate.get(day) ?? [];
                const outside = day.slice(0, 7) !== month;
                const hidden = dayAppointments.length - MONTH_PREVIEW;
                return (
                  <td
                    key={day}
                    className={cn(
                      'border-border h-24 border-t border-l align-top first:border-l-0 sm:h-32',
                      outside && 'bg-muted/50',
                    )}
                  >
                    <div className="flex h-full flex-col gap-1 p-1">
                      <button
                        type="button"
                        onClick={() => onSelectDay(day)}
                        aria-label={`${dayLabel(day, { dateStyle: 'full' })}: ${
                          outside
                            ? 'ver o dia'
                            : dayAppointments.length === 1
                              ? '1 atendimento'
                              : `${dayAppointments.length} atendimentos`
                        }`}
                        className={cn(
                          'hover:bg-accent focus-visible:ring-ring flex items-center justify-between gap-1 rounded px-1 text-left focus-visible:ring-2 focus-visible:outline-none',
                          outside && 'text-muted-foreground',
                        )}
                      >
                        <span
                          className={cn(
                            'grid size-7 place-items-center rounded-full text-sm',
                            day === today && 'bg-primary text-primary-foreground font-bold',
                          )}
                        >
                          {Number(day.slice(8))}
                        </span>
                        {!outside && dayAppointments.length > 0 && (
                          <span className="text-muted-foreground text-xs sm:hidden">
                            {dayAppointments.length}
                          </span>
                        )}
                      </button>
                      {!outside && (
                        <ul className="hidden min-w-0 gap-0.5 sm:grid">
                          {dayAppointments.slice(0, MONTH_PREVIEW).map((appointment) => {
                            const meta = STATUS_META[appointment.status];
                            return (
                              <li key={appointment.id} className="min-w-0">
                                <button
                                  type="button"
                                  onClick={() => onSelectAppointment(appointment)}
                                  title={`${meta.label}${showProfessional ? ` · ${appointment.professional.name}` : ''}`}
                                  className="hover:bg-accent focus-visible:ring-ring flex w-full items-center gap-1 truncate rounded px-1 text-left text-xs focus-visible:ring-2 focus-visible:outline-none"
                                >
                                  <meta.icon aria-hidden className={cn('size-3 shrink-0', meta.className)} />
                                  <span className="sr-only">{meta.label}: </span>
                                  <span className="truncate">
                                    {formatTime(appointment.startsAt, timezone)} {appointment.client.name}
                                  </span>
                                </button>
                              </li>
                            );
                          })}
                          {hidden > 0 && (
                            <li>
                              <button
                                type="button"
                                onClick={() => onSelectDay(day)}
                                className="text-muted-foreground hover:bg-accent focus-visible:ring-ring w-full rounded px-1 text-left text-xs focus-visible:ring-2 focus-visible:outline-none"
                              >
                                + {hidden} {hidden === 1 ? 'outro' : 'outros'}
                              </button>
                            </li>
                          )}
                        </ul>
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
