import { minuteOfDay } from '@/lib/format';

export const SLOT_MINUTES = 15;
const DEFAULT_START = 8 * 60;
const DEFAULT_END = 20 * 60;

export interface MinuteRange {
  startMinute: number;
  endMinute: number;
}

/**
 * Faixa visível do dia: do primeiro expediente/atendimento ao último, alinhada à hora
 * cheia. Sem nada no dia, mostra 08:00–20:00.
 */
export function visibleRange(
  workIntervals: MinuteRange[],
  appointments: { startsAt: string; endsAt: string }[],
  timezone: string,
): MinuteRange {
  const starts = [
    ...workIntervals.map((interval) => interval.startMinute),
    ...appointments.map((appointment) => minuteOfDay(appointment.startsAt, timezone)),
  ];
  const ends = [
    ...workIntervals.map((interval) => interval.endMinute),
    ...appointments.map((appointment) => endMinuteOf(appointment, timezone)),
  ];
  if (starts.length === 0) return { startMinute: DEFAULT_START, endMinute: DEFAULT_END };
  return {
    startMinute: Math.floor(Math.min(...starts) / 60) * 60,
    endMinute: Math.min(24 * 60, Math.ceil(Math.max(...ends) / 60) * 60),
  };
}

/** Fim em minutos; atendimento que passa da meia-noite é cortado no fim do dia. */
function endMinuteOf(appointment: { startsAt: string; endsAt: string }, timezone: string): number {
  const start = minuteOfDay(appointment.startsAt, timezone);
  const end = minuteOfDay(appointment.endsAt, timezone);
  return end <= start ? 24 * 60 : end;
}

/** Posição de um bloco na grade, em unidades de slot (15 min). */
export function blockPosition(
  item: { startsAt: string; endsAt: string },
  range: MinuteRange,
  timezone: string,
): { top: number; height: number } {
  const start = Math.max(minuteOfDay(item.startsAt, timezone), range.startMinute);
  const end = Math.min(endMinuteOf(item, timezone), range.endMinute);
  return {
    top: (start - range.startMinute) / SLOT_MINUTES,
    height: Math.max(end - start, SLOT_MINUTES) / SLOT_MINUTES,
  };
}

/** Linhas da grade (início de cada slot), para rótulos de hora e cliques em horário livre. */
export function slotMinutes(range: MinuteRange): number[] {
  const slots: number[] = [];
  for (let minute = range.startMinute; minute < range.endMinute; minute += SLOT_MINUTES) slots.push(minute);
  return slots;
}

/** Horário fora do expediente (sombreado na grade, mas encaixe ainda é permitido). */
export function isOutsideWork(minute: number, workIntervals: MinuteRange[]): boolean {
  return !workIntervals.some((interval) => minute >= interval.startMinute && minute < interval.endMinute);
}
