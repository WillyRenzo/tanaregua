import { TZDate } from '@date-fns/tz';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Dinheiro trafega em centavos; só vira reais na exibição. */
export function formatMoney(cents: number): string {
  return brl.format(cents / 100);
}

/** "45,90" → 4590. Aceita vírgula ou ponto; retorna null se não for um valor válido. */
export function parseMoney(input: string): number | null {
  const normalized = input
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(',', '.');
  if (normalized === '' || Number.isNaN(Number(normalized))) return null;
  return Math.round(Number(normalized) * 100);
}

/** Basis points → "40%" / "12,5%". */
export function formatPercent(basisPoints: number): string {
  return `${(basisPoints / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
}

/** Datas sempre no fuso da barbearia, nunca no do navegador. */
export function formatTime(iso: string | Date, timezone: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  );
}

export function formatDateLong(date: string, timezone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(localInstant(date, 12 * 60, timezone));
}

export function formatDateTime(iso: string | Date, timezone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** Data local "AAAA-MM-DD" de hoje no fuso da barbearia. */
export function todayIn(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
}

export function addDays(date: string, days: number): string {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

/** Instante de um horário de parede (minutos desde 00:00) no fuso da barbearia. */
export function localInstant(date: string, minuteOfDay: number, timezone: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(new TZDate(year!, month! - 1, day!, 0, minuteOfDay, 0, 0, timezone).getTime());
}

/** Minuto do dia de um instante, no fuso da barbearia. */
export function minuteOfDay(iso: string | Date, timezone: string): number {
  const local = new TZDate(new Date(iso).getTime(), timezone);
  return local.getHours() * 60 + local.getMinutes();
}

export function formatClock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function formatPhone(digits: string | null | undefined): string {
  if (!digits) return '';
  // Remove o DDI do Brasil (55) quando presente: 12 dígitos = fixo, 13 = celular.
  const local = digits.length >= 12 && digits.startsWith('55') ? digits.slice(2) : digits;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return digits;
}
