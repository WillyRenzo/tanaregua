import { instantToLocal } from '../appointments/availability.js';

/** Hora local a partir da qual a mensagem de aniversário do dia sai. */
export const BIRTHDAY_SEND_HOUR = 9;

/** Data (AAAA-MM-DD), ano e hora no fuso da barbearia. */
export function localClock(instant: Date, timezone: string): { date: string; year: number; hour: number } {
  const { date, minuteOfDay } = instantToLocal(instant, timezone);
  return { date, year: Number(date.slice(0, 4)), hour: Math.floor(minuteOfDay / 60) };
}

const isLeapYear = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/**
 * O aniversário (AAAA-MM-DD) cai nesta data local? Quem nasceu em 29/02 comemora em 28/02
 * nos anos não bissextos.
 */
export function isBirthdayOn(birthDate: string, localDate: string): boolean {
  const birthday = birthDate.slice(5);
  const today = localDate.slice(5);
  if (birthday === today) return true;
  return birthday === '02-29' && today === '02-28' && !isLeapYear(Number(localDate.slice(0, 4)));
}
