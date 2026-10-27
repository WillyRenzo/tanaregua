import { describe, expect, it } from 'vitest';
import {
  addDays,
  formatClock,
  formatDate,
  formatMoney,
  formatPercent,
  formatPhone,
  formatTime,
  localInstant,
  minuteOfDay,
  parseMoney,
} from './format';

const SP = 'America/Sao_Paulo';

describe('format', () => {
  it('formata centavos em reais', () => {
    expect(formatMoney(4590)).toBe('R$ 45,90');
    expect(formatMoney(0)).toBe('R$ 0,00');
  });

  it.each([
    ['45,90', 4590],
    ['45.90', 4590],
    ['R$ 1.234,50', 123450],
    ['50', 5000],
    ['', null],
    ['abc', null],
  ])('converte %j em centavos', (input, cents) => {
    expect(parseMoney(input)).toBe(cents);
  });

  it('formata basis points', () => {
    expect(formatPercent(4000)).toBe('40%');
    expect(formatPercent(1250)).toBe('12,5%');
  });

  it('usa o fuso da barbearia, não o do navegador', () => {
    expect(formatTime('2030-03-04T12:00:00Z', SP)).toBe('09:00');
    expect(formatDate('2030-03-05T02:00:00Z', SP)).toBe('04/03/2030');
    expect(localInstant('2030-03-04', 9 * 60, SP).toISOString()).toBe('2030-03-04T12:00:00.000Z');
    expect(minuteOfDay('2030-03-04T12:30:00Z', SP)).toBe(570);
  });

  it('soma dias em datas de calendário', () => {
    expect(addDays('2030-12-31', 1)).toBe('2031-01-01');
    expect(addDays('2030-03-01', -1)).toBe('2030-02-28');
  });

  it('formata horário e telefone', () => {
    expect(formatClock(570)).toBe('09:30');
    expect(formatPhone('11988887777')).toBe('(11) 98888-7777');
    expect(formatPhone('551132324444')).toBe('(11) 3232-4444');
  });
});
