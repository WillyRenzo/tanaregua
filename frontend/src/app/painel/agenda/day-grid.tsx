'use client';

import { useEffect, useState } from 'react';
import { STATUS_META } from '@/components/appointment-status';
import { formatClock, formatTime, minuteOfDay } from '@/lib/format';
import type { Appointment, DayAgenda } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { blockPosition, isOutsideWork, slotMinutes, SLOT_MINUTES, visibleRange } from './agenda-layout';

/** Altura de um slot de 15 min (1h = 6rem): cabe nome do cliente + serviço num corte de 30 min. */
const SLOT_REM = 1.5;

interface DayGridProps {
  agenda: DayAgenda;
  isToday: boolean;
  onSelectAppointment: (appointment: Appointment) => void;
  onSelectSlot?: (professionalId: string, minute: number) => void;
}

/** Grade do dia: colunas = profissionais, linhas = 15 min. A visão "quem atende quem e quando". */
export function DayGrid({ agenda, isToday, onSelectAppointment, onSelectSlot }: DayGridProps) {
  const timezone = agenda.timezone;
  const range = visibleRange(
    agenda.professionals.flatMap((professional) => professional.workIntervals),
    agenda.professionals.flatMap((professional) => professional.appointments),
    timezone,
  );
  const slots = slotMinutes(range);
  const nowMinute = useNowMinute(timezone);
  const showNow = isToday && nowMinute >= range.startMinute && nowMinute < range.endMinute;

  return (
    <div className="border-border overflow-x-auto rounded-lg border">
      <div
        className="grid min-w-full"
        style={{ gridTemplateColumns: `4rem repeat(${agenda.professionals.length}, minmax(11rem, 1fr))` }}
      >
        {/* Cabeçalho */}
        <div className="bg-muted border-border sticky top-0 z-20 border-b" />
        {agenda.professionals.map((professional) => (
          <div
            key={professional.id}
            className="bg-muted border-border font-heading sticky top-0 z-20 truncate border-b border-l px-3 py-2 text-lg font-semibold tracking-wide uppercase"
          >
            {professional.name}
          </div>
        ))}

        {/* Régua de horas */}
        <div className="relative" style={{ height: `${slots.length * SLOT_REM}rem` }} aria-hidden>
          {slots
            .filter((minute) => minute % 60 === 0)
            .map((minute) => (
              <span
                key={minute}
                className="text-muted-foreground absolute right-2 -translate-y-1/2 text-xs"
                style={{ top: `${((minute - range.startMinute) / SLOT_MINUTES) * SLOT_REM}rem` }}
              >
                {formatClock(minute)}
              </span>
            ))}
        </div>

        {agenda.professionals.map((professional) => (
          <div
            key={professional.id}
            role="group"
            aria-label={`Agenda de ${professional.name}`}
            className="border-border relative border-l"
            style={{ height: `${slots.length * SLOT_REM}rem` }}
          >
            {/* Fundo: slots clicáveis (atalho de mouse; pelo teclado use "Novo agendamento"). */}
            {slots.map((minute) => {
              const outside = isOutsideWork(minute, professional.workIntervals);
              return (
                <button
                  key={minute}
                  type="button"
                  tabIndex={-1}
                  aria-hidden
                  disabled={!onSelectSlot}
                  onClick={() => onSelectSlot?.(professional.id, minute)}
                  className={cn(
                    'hover:bg-accent/60 absolute inset-x-0 block disabled:cursor-default',
                    minute % 60 === 0 ? 'border-border border-t' : 'border-border/40 border-t border-dashed',
                    outside && 'bg-muted/70',
                  )}
                  style={{
                    top: `${((minute - range.startMinute) / SLOT_MINUTES) * SLOT_REM}rem`,
                    height: `${SLOT_REM}rem`,
                  }}
                />
              );
            })}

            {professional.timeOffs.map((timeOff) => {
              const position = blockPosition(
                { startsAt: timeOff.startsAt, endsAt: timeOff.endsAt },
                range,
                timezone,
              );
              return (
                <div
                  key={timeOff.id}
                  className="text-muted-foreground pointer-events-none absolute inset-x-1 z-10 flex items-start rounded-sm px-2 py-1 text-xs font-medium"
                  style={{
                    top: `${position.top * SLOT_REM}rem`,
                    height: `${position.height * SLOT_REM}rem`,
                    backgroundImage:
                      'repeating-linear-gradient(135deg, var(--muted) 0 6px, transparent 6px 12px)',
                  }}
                >
                  Bloqueado{timeOff.reason ? ` · ${timeOff.reason}` : ''}
                </div>
              );
            })}

            {professional.appointments.map((appointment) => (
              <AppointmentBlock
                key={appointment.id}
                appointment={appointment}
                timezone={timezone}
                position={blockPosition(appointment, range, timezone)}
                onSelect={() => onSelectAppointment(appointment)}
              />
            ))}

            {showNow && (
              <div
                aria-hidden
                className="bg-destructive pointer-events-none absolute inset-x-0 z-30 h-0.5"
                style={{ top: `${((nowMinute - range.startMinute) / SLOT_MINUTES) * SLOT_REM}rem` }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AppointmentBlock({
  appointment,
  timezone,
  position,
  onSelect,
}: {
  appointment: Appointment;
  timezone: string;
  position: { top: number; height: number };
  onSelect: () => void;
}) {
  const meta = STATUS_META[appointment.status];
  const time = `${formatTime(appointment.startsAt, timezone)}–${formatTime(appointment.endsAt, timezone)}`;
  const services = appointment.items.map((item) => item.name).join(', ');
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`${time}, ${appointment.client.name}, ${services}, ${meta.label}`}
      className={cn(
        'bg-card absolute inset-x-1 z-20 flex flex-col overflow-hidden rounded-sm border-l-4 px-2 py-1 text-left shadow-sm',
        'hover:ring-ring focus-visible:ring-ring transition-shadow hover:ring-2 focus-visible:ring-2 focus-visible:outline-none',
        meta.className,
        appointment.status === 'NO_SHOW' && 'opacity-60',
      )}
      style={{ top: `${position.top * SLOT_REM}rem`, height: `${position.height * SLOT_REM}rem` }}
    >
      <span className="text-foreground flex items-center gap-1 text-xs font-semibold">
        <meta.icon aria-hidden className="size-3 shrink-0" />
        {formatTime(appointment.startsAt, timezone)} ·{' '}
        <span className="truncate">{appointment.client.name}</span>
      </span>
      {position.height >= 2 && <span className="text-muted-foreground truncate text-xs">{services}</span>}
    </button>
  );
}

/** Minuto atual no fuso da barbearia, atualizado a cada minuto. */
function useNowMinute(timezone: string): number {
  const [now, setNow] = useState(() => minuteOfDay(new Date(), timezone));
  useEffect(() => {
    const timer = setInterval(() => setNow(minuteOfDay(new Date(), timezone)), 60_000);
    return () => clearInterval(timer);
  }, [timezone]);
  return now;
}
