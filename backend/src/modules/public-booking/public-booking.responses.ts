import { z } from 'zod';
import { brandSchema } from '../registry.responses.js';

export const publicBarbershopSchema = z
  .object({
    name: z.string(),
    slug: z.string(),
    timezone: z.string(),
    cancellationMinNoticeMinutes: z.int(),
    rescheduleMinNoticeMinutes: z.int(),
    brand: brandSchema,
    /** Como a reserva é paga online (§5); `null` = só no balcão. */
    onlinePayment: z
      .object({
        mode: z.enum(['OPTIONAL', 'REQUIRED']),
        amount: z.enum(['FULL', 'DEPOSIT']),
        /** Sinal em basis points (3000 = 30%). */
        depositBps: z.int().nullable(),
      })
      .nullable(),
  })
  .meta({ id: 'PublicBarbershop' });

export const publicProfessionalSchema = z
  .object({ id: z.uuid(), name: z.string() })
  .meta({ id: 'PublicProfessional' });

export const publicAvailabilityResultSchema = z
  .object({
    date: z.string(),
    timezone: z.string(),
    durationMinutes: z.int(),
    professionals: z.array(z.object({ id: z.uuid(), name: z.string(), starts: z.array(z.date()) })),
  })
  .meta({ id: 'PublicAvailability' });
