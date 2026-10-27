'use client';

import { LoadingRows } from '@/components/states';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/api/errors';
import { addDays, formatDateLong, formatTime, todayIn } from '@/lib/format';
import { usePublicAvailability } from '@/lib/public-queries';
import { cn } from '@/lib/utils';

/** Dia (próximos 14) + horários livres da grade online. Usado na reserva e no reagendamento. */
export function SlotPicker({
  slug,
  timezone,
  serviceIds,
  professionalId,
  date,
  onDateChange,
  onSelect,
  title = 'Quando?',
}: {
  slug: string;
  timezone: string;
  serviceIds: string[];
  professionalId?: string;
  date: string;
  onDateChange: (date: string) => void;
  onSelect: (start: string) => void;
  /** `null` esconde o título (ex.: dentro de um diálogo que já tem o seu). */
  title?: string | null;
}) {
  const today = todayIn(timezone);
  const days = Array.from({ length: 14 }, (_, index) => addDays(today, index));
  const availability = usePublicAvailability(slug, date, serviceIds, professionalId);
  // "Qualquer profissional": junta os horários de todos (a API escolhe quem estiver livre).
  const starts = [
    ...new Set(availability.data?.professionals.flatMap((professional) => professional.starts) ?? []),
  ].sort();
  const weekday = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'short' });

  return (
    <section>
      {title && <h2 className="mb-4 text-3xl font-bold">{title}</h2>}
      <div className="-mx-4 mb-6 flex gap-2 overflow-x-auto px-4 pb-2" role="group" aria-label="Dia">
        {days.map((day) => {
          const active = day === date;
          return (
            <button
              key={day}
              type="button"
              aria-pressed={active}
              onClick={() => onDateChange(day)}
              className={cn(
                'border-border hover:border-primary flex min-w-16 flex-col items-center rounded-lg border px-3 py-2',
                'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                active && 'bg-primary border-primary text-primary-foreground',
              )}
            >
              <span className="text-xs uppercase">
                {day === today ? 'Hoje' : weekday.format(new Date(`${day}T12:00:00Z`))}
              </span>
              <span className="font-heading text-2xl font-bold">{day.slice(8, 10)}</span>
            </button>
          );
        })}
      </div>

      {availability.isLoading ? (
        <LoadingRows rows={3} label="Buscando horários" />
      ) : availability.error ? (
        <p role="alert" className="text-destructive text-sm">
          {errorMessage(availability.error)}
        </p>
      ) : starts.length === 0 ? (
        <p className="text-muted-foreground border-border rounded-lg border border-dashed p-6 text-center text-sm">
          Nenhum horário livre neste dia. Tente outro dia{professionalId ? ' ou outro profissional' : ''}.
        </p>
      ) : (
        <ul
          className="grid grid-cols-3 gap-2 sm:grid-cols-5"
          aria-label={`Horários livres em ${formatDateLong(date, timezone)}`}
        >
          {starts.map((start) => (
            <li key={start}>
              <Button variant="outline" className="w-full" onClick={() => onSelect(start)}>
                {formatTime(start, timezone)}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
