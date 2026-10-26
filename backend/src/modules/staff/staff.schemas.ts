import { z } from 'zod';
import { clockTimeSchema } from '../../common/time/clock-time.js';
import { emailSchema, passwordSchema } from '../auth/auth.schemas.js';

export const createStaffSchema = z
  .strictObject({
    name: z.string().trim().min(2).max(100),
    email: emailSchema,
    /** Senha inicial. Ignorada se o e-mail já tiver conta (a pessoa usa a senha dela). */
    password: passwordSchema,
    roleKey: z.string().min(1).max(50),
    isProfessional: z.boolean(),
  })
  .meta({
    example: {
      name: 'Bia Barbeira',
      email: 'bia@exemplo.com',
      password: 'senha-forte-123',
      roleKey: 'professional',
      isProfessional: true,
    },
  });
export type CreateStaffInput = z.infer<typeof createStaffSchema>;

export const updateStaffSchema = z.strictObject({
  roleKey: z.string().min(1).max(50).optional(),
  isProfessional: z.boolean().optional(),
  active: z.boolean().optional(),
});
export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;

const scheduleIntervalSchema = z
  .strictObject({
    weekday: z.number().int().min(0).max(6),
    start: clockTimeSchema,
    end: clockTimeSchema,
  })
  .refine((interval) => interval.start < interval.end, 'O início precisa ser antes do fim.');

export const replaceScheduleSchema = z
  .strictObject({
    intervals: z
      .array(scheduleIntervalSchema)
      .max(50)
      .refine((intervals) => !hasOverlap(intervals), 'Há intervalos sobrepostos no mesmo dia.'),
  })
  .meta({
    example: {
      intervals: [
        { weekday: 1, start: '09:00', end: '12:00' },
        { weekday: 1, start: '13:00', end: '19:00' },
        { weekday: 6, start: '08:00', end: '14:00' },
      ],
    },
  });
export type ReplaceScheduleInput = z.infer<typeof replaceScheduleSchema>;

function hasOverlap(intervals: { weekday: number; start: number; end: number }[]): boolean {
  const sorted = [...intervals].sort((a, b) => a.weekday - b.weekday || a.start - b.start);
  return sorted.some(
    (interval, index) =>
      index > 0 && sorted[index - 1]!.weekday === interval.weekday && sorted[index - 1]!.end > interval.start,
  );
}

export const createTimeOffSchema = z
  .strictObject({
    startsAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
    endsAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
    reason: z.string().trim().max(200).optional(),
  })
  .refine((timeOff) => timeOff.startsAt < timeOff.endsAt, 'O início precisa ser antes do fim.');
export type CreateTimeOffInput = z.infer<typeof createTimeOffSchema>;

export const timeOffRangeSchema = z.strictObject({
  from: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
  to: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
});
export type TimeOffRange = z.infer<typeof timeOffRangeSchema>;
