import { clockTimeSchema, toClock, toMinutes } from './clock-time.js';

describe('clock-time', () => {
  it.each([
    ['00:00', 0],
    ['09:30', 570],
    ['23:59', 1439],
    ['24:00', 1440],
  ])('converte %s em %i minutos e volta', (clock, minutes) => {
    expect(toMinutes(clock)).toBe(minutes);
    expect(toClock(minutes)).toBe(clock);
  });

  it.each(['9:30', '24:01', '12:60', 'abc', ''])('rejeita %j', (value) => {
    expect(clockTimeSchema.safeParse(value).success).toBe(false);
  });
});
