import { z } from 'zod';

export const appointmentStatusSchema = z.enum([
  'SCHEDULED',
  'CONFIRMED',
  'IN_SERVICE',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
]);

/**
 * Agendamento como o cliente final vê (agendamento online). Não tem nada interno da equipe:
 * justificativa de falta e contagem de faltas ficam só em `appointmentViewSchema`.
 */
export const clientAppointmentViewSchema = z
  .object({
    id: z.uuid(),
    status: appointmentStatusSchema,
    source: z.enum(['PANEL', 'ONLINE']),
    startsAt: z.date(),
    endsAt: z.date(),
    notes: z.string().nullable(),
    cancellationReason: z.string().nullable(),
    professional: z.object({ id: z.uuid(), name: z.string() }),
    client: z.object({ id: z.uuid(), name: z.string(), phone: z.string().nullable() }),
    items: z.array(
      z.object({
        serviceId: z.uuid(),
        name: z.string(),
        priceCents: z.int(),
        durationMinutes: z.int(),
      }),
    ),
    totalCents: z.int(),
  })
  .meta({ id: 'ClientAppointment' });
export type ClientAppointmentView = z.infer<typeof clientAppointmentViewSchema>;

/** Agendamento como a equipe vê no painel (business-rules §2: faltas sem justificativa). */
export const appointmentViewSchema = clientAppointmentViewSchema
  .extend({
    noShowJustification: z.string().nullable(),
    client: z.object({
      id: z.uuid(),
      name: z.string(),
      phone: z.string().nullable(),
      /** Faltas do cliente nesta barbearia sem justificativa registrada. */
      unjustifiedNoShows: z.int(),
    }),
  })
  .meta({ id: 'Appointment' });
export type AppointmentView = z.infer<typeof appointmentViewSchema>;

export const unjustifiedNoShowSchema = z
  .object({
    appointmentId: z.uuid(),
    startsAt: z.date(),
    professional: z.object({ id: z.uuid(), name: z.string() }),
    services: z.array(z.string()),
  })
  .meta({ id: 'UnjustifiedNoShow' });
export type UnjustifiedNoShow = z.infer<typeof unjustifiedNoShowSchema>;

const minuteIntervalSchema = z.object({ startMinute: z.int(), endMinute: z.int() });

export const dayAgendaSchema = z
  .object({
    date: z.string(),
    timezone: z.string(),
    professionals: z.array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        workIntervals: z.array(minuteIntervalSchema),
        timeOffs: z.array(
          z.object({
            id: z.uuid(),
            membershipId: z.uuid(),
            startsAt: z.date(),
            endsAt: z.date(),
            reason: z.string().nullable(),
          }),
        ),
        appointments: z.array(appointmentViewSchema),
      }),
    ),
  })
  .meta({ id: 'DayAgenda' });
export type DayAgenda = z.infer<typeof dayAgendaSchema>;

export const availabilitySchema = z
  .object({
    date: z.string(),
    timezone: z.string(),
    durationMinutes: z.int(),
    professionals: z.array(
      z.object({ professionalId: z.uuid(), name: z.string(), starts: z.array(z.date()) }),
    ),
  })
  .meta({ id: 'Availability' });
export type Availability = z.infer<typeof availabilitySchema>;
