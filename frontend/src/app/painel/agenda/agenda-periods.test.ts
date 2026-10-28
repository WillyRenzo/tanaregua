import { describe, expect, it } from 'vitest';
import {
  containsDate,
  groupByDate,
  monthWeeks,
  periodLabel,
  periodRange,
  shiftPeriod,
  weekDays,
} from './agenda-periods';

const SP = 'America/Sao_Paulo';

describe('agenda-periods', () => {
  it('semana de domingo a sábado', () => {
    // 2026-10-28 é uma quarta-feira.
    expect(weekDays('2026-10-28')).toEqual([
      '2026-10-25',
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
    ]);
    expect(weekDays('2026-10-25')[0]).toBe('2026-10-25');
  });

  it('mês em semanas completas, incluindo dias dos meses vizinhos', () => {
    const weeks = monthWeeks('2026-10-15');
    expect(weeks[0]![0]).toBe('2026-09-27');
    // 31/10/2026 é sábado: a última semana termina nele.
    expect(weeks.at(-1)!.at(-1)).toBe('2026-10-31');
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    // Novembro termina numa segunda: a última semana vai até o sábado de dezembro.
    expect(monthWeeks('2026-11-02').at(-1)!.at(-1)).toBe('2026-12-05');
  });

  it('período em instantes UTC da meia-noite local, dentro do limite de 31 dias da API', () => {
    expect(periodRange('day', '2026-10-28', SP)).toEqual({
      from: '2026-10-28T03:00:00.000Z',
      to: '2026-10-29T03:00:00.000Z',
    });
    expect(periodRange('week', '2026-10-28', SP)).toEqual({
      from: '2026-10-25T03:00:00.000Z',
      to: '2026-11-01T03:00:00.000Z',
    });
    const month = periodRange('month', '2026-12-10', SP);
    expect(month).toEqual({ from: '2026-12-01T03:00:00.000Z', to: '2027-01-01T03:00:00.000Z' });
    expect(Date.parse(month.to) - Date.parse(month.from)).toBeLessThanOrEqual(31 * 86_400_000);
  });

  it('navega por dia, semana e mês (virada de ano inclusive)', () => {
    expect(shiftPeriod('day', '2026-10-31', 1)).toBe('2026-11-01');
    expect(shiftPeriod('week', '2026-10-28', -1)).toBe('2026-10-21');
    expect(shiftPeriod('month', '2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftPeriod('month', '2026-01-15', -1)).toBe('2025-12-01');
  });

  it('sabe se o período mostrado contém uma data', () => {
    expect(containsDate('week', '2026-10-28', '2026-10-25')).toBe(true);
    expect(containsDate('week', '2026-10-28', '2026-11-01')).toBe(false);
    expect(containsDate('month', '2026-10-01', '2026-10-31')).toBe(true);
  });

  it('rótulos em português', () => {
    expect(periodLabel('month', '2026-10-15')).toBe('outubro de 2026');
    expect(periodLabel('week', '2026-10-14')).toBe('11 a 17 de outubro de 2026');
    expect(periodLabel('week', '2026-10-01')).toBe('27 de setembro a 3 de outubro de 2026');
    expect(periodLabel('week', '2026-12-31')).toBe('27 de dezembro de 2026 a 2 de janeiro de 2027');
  });

  it('agrupa pelo dia local da barbearia, não pelo dia UTC', () => {
    const groups = groupByDate(
      [{ startsAt: '2026-10-29T01:30:00Z' }, { startsAt: '2026-10-29T12:00:00Z' }],
      SP,
    );
    expect([...groups.keys()]).toEqual(['2026-10-28', '2026-10-29']);
  });
});
