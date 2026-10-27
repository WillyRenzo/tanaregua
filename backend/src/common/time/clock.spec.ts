import { Clock } from './clock.js';

describe('Clock', () => {
  it('usa a hora real fora de `at`', () => {
    const before = Date.now();
    expect(new Clock().now().getTime()).toBeGreaterThanOrEqual(before);
  });

  it('para o relógio só dentro do fluxo de `at`', async () => {
    const clock = new Clock();
    const instant = new Date('2026-01-15T13:00:00Z');
    const inside = await clock.at(instant, async () => {
      await Promise.resolve();
      return clock.now();
    });
    expect(inside).toEqual(instant);
    expect(clock.now()).not.toEqual(instant);
  });

  it('devolve uma cópia: quem altera a data não mexe no relógio', async () => {
    const clock = new Clock();
    const instant = new Date('2026-01-15T13:00:00Z');
    await clock.at(instant, async () => {
      clock.now().setUTCFullYear(2000);
      expect(clock.now()).toEqual(instant);
    });
  });
});
