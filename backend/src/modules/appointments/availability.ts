import { TZDate } from '@date-fns/tz';

export interface MinuteInterval {
  startMinute: number;
  endMinute: number;
}

export interface BusyInterval {
  professionalId: string;
  start: Date;
  /** Exclusivo. Para agendamentos é o blocked_until (fim + buffer). */
  end: Date;
}

export interface AvailabilityInput {
  /** Dia local da barbearia, AAAA-MM-DD. */
  date: string;
  timezone: string;
  durationMinutes: number;
  bufferMinutes: number;
  /** Granularidade da grade (15 min). */
  stepMinutes: number;
  /** Nenhum horário começa antes disso (ex.: agora). */
  notBefore: Date;
  professionals: { id: string; intervals: MinuteInterval[] }[];
  busy: BusyInterval[];
}

export interface ProfessionalSlots {
  professionalId: string;
  starts: Date[];
}

/** Instante UTC de um horário de parede no fuso da barbearia (seguro com horário de verão). */
export function localTimeToInstant(date: string, minuteOfDay: number, timezone: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const local = new TZDate(year!, month! - 1, day!, 0, minuteOfDay, 0, 0, timezone);
  return new Date(local.getTime());
}

/** Data (AAAA-MM-DD) e minuto do dia de um instante, no fuso da barbearia. */
export function instantToLocal(instant: Date, timezone: string): { date: string; minuteOfDay: number } {
  const local = new TZDate(instant.getTime(), timezone);
  const date = [
    local.getFullYear(),
    String(local.getMonth() + 1).padStart(2, '0'),
    String(local.getDate()).padStart(2, '0'),
  ].join('-');
  return { date, minuteOfDay: local.getHours() * 60 + local.getMinutes() };
}

/** Horário "HH:mm" de um instante no fuso da barbearia, para mensagens ao usuário. */
export function formatLocalTime(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(instant);
}

/** Dia da semana (0 = domingo) de uma data de calendário, independente de fuso. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export function nextDate(date: string): string {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

/** Início e fim (exclusivo) do dia local, em UTC. */
export function dayBounds(date: string, timezone: string): { from: Date; to: Date } {
  return {
    from: localTimeToInstant(date, 0, timezone),
    to: localTimeToInstant(nextDate(date), 0, timezone),
  };
}

const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) => aStart < bEnd && bStart < aEnd;

/**
 * Horários livres = expediente − folgas − agendamentos ativos (business-rules §2).
 * O atendimento precisa caber no expediente; o buffer pode passar do fim do expediente,
 * mas não pode invadir outro compromisso.
 */
export function availableSlots(input: AvailabilityInput): ProfessionalSlots[] {
  return input.professionals.map((professional) => {
    const busy = input.busy.filter((item) => item.professionalId === professional.id);
    const starts: Date[] = [];

    for (const interval of professional.intervals) {
      const firstMinute = Math.ceil(interval.startMinute / input.stepMinutes) * input.stepMinutes;
      for (
        let minute = firstMinute;
        minute + input.durationMinutes <= interval.endMinute;
        minute += input.stepMinutes
      ) {
        const start = localTimeToInstant(input.date, minute, input.timezone);
        if (start < input.notBefore) continue;
        const blockedUntil = new Date(
          start.getTime() + (input.durationMinutes + input.bufferMinutes) * 60_000,
        );
        if (!busy.some((item) => overlaps(start, blockedUntil, item.start, item.end))) {
          starts.push(start);
        }
      }
    }

    starts.sort((a, b) => a.getTime() - b.getTime());
    return { professionalId: professional.id, starts };
  });
}
