import {
  availableSlots,
  dayBounds,
  localTimeToInstant,
  weekdayOf,
  type AvailabilityInput,
} from './availability.js';

const SP = 'America/Sao_Paulo';
const at = (iso: string) => new Date(iso);
const hhmm = (dates: Date[]) =>
  dates.map((date) =>
    new Intl.DateTimeFormat('pt-BR', { timeZone: SP, hour: '2-digit', minute: '2-digit' }).format(date),
  );

const base = (overrides: Partial<AvailabilityInput> = {}): AvailabilityInput => ({
  date: '2030-03-04',
  timezone: SP,
  durationMinutes: 30,
  bufferMinutes: 0,
  stepMinutes: 15,
  notBefore: at('2030-01-01T00:00:00Z'),
  professionals: [{ id: 'ana', intervals: [{ startMinute: 9 * 60, endMinute: 11 * 60 }] }],
  busy: [],
  ...overrides,
});

describe('availability', () => {
  it('converte horário local para UTC no fuso da barbearia', () => {
    expect(localTimeToInstant('2030-03-04', 9 * 60, SP).toISOString()).toBe('2030-03-04T12:00:00.000Z');
    expect(dayBounds('2030-03-04', SP)).toEqual({
      from: at('2030-03-04T03:00:00Z'),
      to: at('2030-03-05T03:00:00Z'),
    });
  });

  it('respeita horário de verão em fusos que ainda o adotam', () => {
    // Nova York: 9h local é 14h UTC no inverno (EST, UTC-5) e 13h UTC no verão (EDT, UTC-4).
    expect(localTimeToInstant('2030-01-15', 9 * 60, 'America/New_York').toISOString()).toBe(
      '2030-01-15T14:00:00.000Z',
    );
    expect(localTimeToInstant('2030-07-15', 9 * 60, 'America/New_York').toISOString()).toBe(
      '2030-07-15T13:00:00.000Z',
    );
  });

  it('calcula o dia da semana pela data de calendário', () => {
    expect(weekdayOf('2030-03-04')).toBe(1); // segunda
    expect(weekdayOf('2030-03-10')).toBe(0); // domingo
  });

  it('gera a grade de 15 min onde o atendimento inteiro cabe no expediente', () => {
    const [slots] = availableSlots(base());
    expect(hhmm(slots!.starts)).toEqual(['09:00', '09:15', '09:30', '09:45', '10:00', '10:15', '10:30']);
  });

  it('remove horários que colidem com agendamentos (intervalo semiaberto)', () => {
    const [slots] = availableSlots(
      base({
        busy: [{ professionalId: 'ana', start: at('2030-03-04T12:30:00Z'), end: at('2030-03-04T13:00:00Z') }],
      }),
    );
    // 09:30–10:00 está ocupado: 09:00 encosta (termina 09:30) e 10:00 começa logo depois.
    expect(hhmm(slots!.starts)).toEqual(['09:00', '10:00', '10:15', '10:30']);
  });

  it('considera o buffer entre atendimentos', () => {
    const [slots] = availableSlots(
      base({
        bufferMinutes: 15,
        busy: [{ professionalId: 'ana', start: at('2030-03-04T13:00:00Z'), end: at('2030-03-04T13:45:00Z') }],
      }),
    );
    // 09:15 + 30 + 15 de buffer = 10:00 encosta no ocupado; 09:30 invadiria.
    expect(hhmm(slots!.starts)).toEqual(['09:00', '09:15']);
  });

  it('ignora ocupações de outros profissionais e respeita "não antes de"', () => {
    const [slots] = availableSlots(
      base({
        notBefore: at('2030-03-04T13:05:00Z'), // 10:05 local
        busy: [{ professionalId: 'bia', start: at('2030-03-04T12:00:00Z'), end: at('2030-03-04T14:00:00Z') }],
      }),
    );
    expect(hhmm(slots!.starts)).toEqual(['10:15', '10:30']);
  });

  it('alinha intervalos quebrados à grade e junta vários intervalos no dia', () => {
    const [slots] = availableSlots(
      base({
        professionals: [
          {
            id: 'ana',
            intervals: [
              { startMinute: 14 * 60, endMinute: 15 * 60 },
              { startMinute: 9 * 60 + 10, endMinute: 10 * 60 },
            ],
          },
        ],
      }),
    );
    expect(hhmm(slots!.starts)).toEqual(['09:15', '09:30', '14:00', '14:15', '14:30']);
  });

  it('sem expediente no dia, não há horários', () => {
    const [slots] = availableSlots(base({ professionals: [{ id: 'ana', intervals: [] }] }));
    expect(slots!.starts).toEqual([]);
  });
});
