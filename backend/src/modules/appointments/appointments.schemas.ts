import { z } from 'zod';

const instantSchema = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
export const localDateSchema = z.iso.date('Use o formato AAAA-MM-DD.');

const serviceIdsSchema = z
  .array(z.uuid())
  .min(1, 'Escolha ao menos um serviço.')
  .max(10)
  .refine((ids) => new Set(ids).size === ids.length, 'Serviço repetido.');

export const createAppointmentSchema = z
  .strictObject({
    professionalId: z.uuid(),
    clientId: z.uuid(),
    serviceIds: serviceIdsSchema,
    startsAt: instantSchema,
    notes: z.string().trim().max(500).optional(),
  })
  .meta({
    example: {
      professionalId: '0199a1b2-0000-7000-8000-000000000001',
      clientId: '0199a1b2-0000-7000-8000-000000000002',
      serviceIds: ['0199a1b2-0000-7000-8000-000000000003'],
      startsAt: '2030-03-04T10:00:00-03:00',
      notes: 'Prefere máquina 2 nas laterais',
    },
  });
export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;

export const updateAppointmentSchema = z
  .strictObject({
    professionalId: z.uuid().optional(),
    serviceIds: serviceIdsSchema.optional(),
    startsAt: instantSchema.optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, 'Nada para alterar.');
export type UpdateAppointmentInput = z.infer<typeof updateAppointmentSchema>;

/** COMPLETED não entra aqui: só o fechamento da comanda conclui um atendimento. */
export const changeStatusSchema = z.strictObject({
  status: z.enum(['CONFIRMED', 'IN_SERVICE', 'CANCELLED', 'NO_SHOW']),
  /** Motivo do cancelamento ou, em NO_SHOW, justificativa da falta (opcional, só a equipe vê). */
  reason: z.string().trim().max(200).optional(),
});
export type ChangeStatusInput = z.infer<typeof changeStatusSchema>;

export const dayQuerySchema = z.strictObject({ date: localDateSchema });
export type DayQuery = z.infer<typeof dayQuerySchema>;

const MAX_RANGE_MS = 31 * 24 * 60 * 60 * 1000;

export const rangeQuerySchema = z
  .strictObject({
    from: instantSchema,
    to: instantSchema,
    professionalId: z.uuid().optional(),
  })
  .refine((range) => range.from < range.to, 'O início precisa ser antes do fim.')
  .refine((range) => range.to.getTime() - range.from.getTime() <= MAX_RANGE_MS, 'Período máximo de 31 dias.');
export type RangeQuery = z.infer<typeof rangeQuerySchema>;

export const availabilityQuerySchema = z.strictObject({
  date: localDateSchema,
  /** Lista separada por vírgula (query string). */
  serviceIds: z
    .string()
    .transform((value) => value.split(',').filter(Boolean))
    .pipe(serviceIdsSchema),
  professionalId: z.uuid().optional(),
});
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

/** Justificativa de uma falta já marcada; `null` remove (volta a contar como sem justificativa). */
export const noShowJustificationSchema = z
  .strictObject({ justification: z.string().trim().min(1).max(200).nullable() })
  .meta({ example: { justification: 'Avisou depois que estava doente' } });
export type NoShowJustificationInput = z.infer<typeof noShowJustificationSchema>;

export const noShowsQuerySchema = z.strictObject({ clientId: z.uuid() });
export type NoShowsQuery = z.infer<typeof noShowsQuerySchema>;

/** Reagendamento pelo cliente: só o horário (e, opcionalmente, o profissional) muda. */
export const clientRescheduleSchema = z
  .strictObject({
    startsAt: instantSchema,
    /** Omitido = mantém o mesmo profissional. */
    professionalId: z.uuid().optional(),
  })
  .meta({ example: { startsAt: '2030-03-05T15:00:00-03:00' } });
export type ClientRescheduleInput = z.infer<typeof clientRescheduleSchema>;
