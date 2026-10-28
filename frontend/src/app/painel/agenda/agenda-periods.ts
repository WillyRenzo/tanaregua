import { addDays, localInstant } from '@/lib/format';

/**
 * Períodos da agenda (dia, semana, mês) em datas locais "AAAA-MM-DD" do fuso da barbearia.
 * A semana começa no domingo, como no calendário brasileiro.
 */
export type AgendaMode = 'day' | 'week' | 'month';

/** 0 = domingo … 6 = sábado. Meio-dia UTC: a data de calendário não depende do fuso. */
export const weekday = (date: string): number => new Date(`${date}T12:00:00Z`).getUTCDay();

export const weekStart = (date: string): string => addDays(date, -weekday(date));

export const monthStart = (date: string): string => `${date.slice(0, 8)}01`;

/** Primeiro dia do mês seguinte (o fim do mês é exclusivo). */
export function nextMonthStart(date: string): string {
  const [year, month] = date.split('-').map(Number) as [number, number];
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
}

export const weekDays = (date: string): string[] =>
  Array.from({ length: 7 }, (_, index) => addDays(weekStart(date), index));

/** Semanas completas (domingo a sábado) que cobrem o mês da data. */
export function monthWeeks(date: string): string[][] {
  const end = nextMonthStart(date);
  const weeks: string[][] = [];
  for (let start = weekStart(monthStart(date)); start < end; start = addDays(start, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, index) => addDays(start, index)));
  }
  return weeks;
}

/** Dias [início, fim) do período: o mês inteiro cabe no limite de 31 dias da API. */
export function periodDays(view: AgendaMode, date: string): { first: string; end: string } {
  if (view === 'week') return { first: weekStart(date), end: addDays(weekStart(date), 7) };
  if (view === 'month') return { first: monthStart(date), end: nextMonthStart(date) };
  return { first: date, end: addDays(date, 1) };
}

/** Instantes UTC do período, da meia-noite local do primeiro dia à do dia seguinte ao último. */
export function periodRange(view: AgendaMode, date: string, timezone: string): { from: string; to: string } {
  const { first, end } = periodDays(view, date);
  return {
    from: localInstant(first, 0, timezone).toISOString(),
    to: localInstant(end, 0, timezone).toISOString(),
  };
}

/** Anda um período para frente (+1) ou para trás (-1). No mês, cai no dia 1. */
export function shiftPeriod(view: AgendaMode, date: string, step: 1 | -1): string {
  if (view === 'day') return addDays(date, step);
  if (view === 'week') return addDays(date, 7 * step);
  return step === 1 ? nextMonthStart(date) : monthStart(addDays(monthStart(date), -1));
}

/** O período mostrado contém hoje? (habilita ou não o botão "Hoje") */
export function containsDate(view: AgendaMode, date: string, target: string): boolean {
  const { first, end } = periodDays(view, date);
  return target >= first && target < end;
}

const longDate = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', ...options }).format(new Date(`${date}T12:00:00Z`));

/** "12 a 18 de outubro de 2026", "28 de setembro a 4 de outubro de 2026", "outubro de 2026". */
export function periodLabel(view: 'week' | 'month', date: string): string {
  if (view === 'month') return longDate(date, { month: 'long', year: 'numeric' });
  const first = weekStart(date);
  const last = addDays(first, 6);
  const sameMonth = first.slice(0, 7) === last.slice(0, 7);
  const sameYear = first.slice(0, 4) === last.slice(0, 4);
  const start = sameMonth
    ? longDate(first, { day: 'numeric' })
    : longDate(first, sameYear ? { day: 'numeric', month: 'long' } : { dateStyle: 'long' });
  return `${start} a ${longDate(last, { dateStyle: 'long' })}`;
}

/** Data local "AAAA-MM-DD" de um instante, no fuso da barbearia. */
export const localDateOf = (iso: string, timezone: string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(iso));

/** Agrupa por dia local, mantendo a ordem de chegada (a API já ordena por horário). */
export function groupByDate<T extends { startsAt: string }>(items: T[], timezone: string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = localDateOf(item.startsAt, timezone);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}
