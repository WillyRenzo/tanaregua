import { describe, expect, it } from 'vitest';
import { blockPosition, isOutsideWork, slotMinutes, visibleRange } from './agenda-layout';

const SP = 'America/Sao_Paulo';
// 2030-03-04 09:00 em São Paulo = 12:00 UTC
const at = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2030, 2, 4, h! + 3, m!)).toISOString();
};

describe('agenda-layout', () => {
  it('usa 08:00–20:00 quando o dia está vazio', () => {
    expect(visibleRange([], [], SP)).toEqual({ startMinute: 480, endMinute: 1200 });
  });

  it('cobre expediente e atendimentos fora dele, alinhado à hora cheia', () => {
    const range = visibleRange(
      [{ startMinute: 9 * 60 + 30, endMinute: 18 * 60 }],
      [{ startsAt: at('19:00'), endsAt: at('19:40') }],
      SP,
    );
    expect(range).toEqual({ startMinute: 540, endMinute: 1200 });
  });

  it('posiciona blocos em unidades de 15 min', () => {
    const range = { startMinute: 540, endMinute: 1080 };
    expect(blockPosition({ startsAt: at('10:00'), endsAt: at('10:50') }, range, SP)).toEqual({
      top: 4,
      height: 50 / 15,
    });
  });

  it('garante altura mínima de um slot e corta no limite da faixa', () => {
    const range = { startMinute: 540, endMinute: 600 };
    expect(blockPosition({ startsAt: at('09:00'), endsAt: at('09:05') }, range, SP).height).toBe(1);
    expect(blockPosition({ startsAt: at('09:45'), endsAt: at('10:30') }, range, SP)).toEqual({
      top: 3,
      height: 1,
    });
  });

  it('gera slots e identifica horário fora do expediente', () => {
    expect(slotMinutes({ startMinute: 540, endMinute: 600 })).toEqual([540, 555, 570, 585]);
    const work = [{ startMinute: 540, endMinute: 720 }];
    expect(isOutsideWork(540, work)).toBe(false);
    expect(isOutsideWork(720, work)).toBe(true);
  });
});
