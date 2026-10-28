import { isBirthdayOn, localClock } from './birthdays.js';

describe('aniversários', () => {
  it('compara dia e mês, ignorando o ano de nascimento', () => {
    expect(isBirthdayOn('1990-10-28', '2026-10-28')).toBe(true);
    expect(isBirthdayOn('1990-10-27', '2026-10-28')).toBe(false);
    expect(isBirthdayOn('1990-11-28', '2026-10-28')).toBe(false);
  });

  it('29/02 é comemorado em 28/02 nos anos não bissextos, e só em 29/02 nos bissextos', () => {
    expect(isBirthdayOn('2000-02-29', '2027-02-28')).toBe(true);
    expect(isBirthdayOn('2000-02-29', '2028-02-28')).toBe(false);
    expect(isBirthdayOn('2000-02-29', '2028-02-29')).toBe(true);
    expect(isBirthdayOn('1990-02-28', '2027-02-28')).toBe(true);
  });

  it('usa a data e a hora no fuso da barbearia, não em UTC', () => {
    // 01:30 UTC de 29/10 ainda é 22:30 de 28/10 em São Paulo.
    expect(localClock(new Date('2026-10-29T01:30:00Z'), 'America/Sao_Paulo')).toEqual({
      date: '2026-10-28',
      year: 2026,
      hour: 22,
    });
  });
});
