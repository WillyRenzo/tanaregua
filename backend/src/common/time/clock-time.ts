import { z } from 'zod';

/** Horário de parede "HH:mm" (00:00–24:00), usado no expediente semanal. */
export const clockTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, 'Use o formato HH:mm.')
  .transform(toMinutes);

export function toMinutes(clock: string): number {
  const [hours, minutes] = clock.split(':').map(Number);
  return hours! * 60 + minutes!;
}

export function toClock(minutes: number): string {
  const hours = Math.floor(minutes / 60)
    .toString()
    .padStart(2, '0');
  return `${hours}:${(minutes % 60).toString().padStart(2, '0')}`;
}
