import { z } from 'zod';
import { availabilityQuerySchema } from '../appointments/appointments.schemas.js';
import { emailSchema, passwordSchema } from '../auth/auth.schemas.js';
import { phoneSchema } from '../clients/clients.schemas.js';

export const publicRegisterSchema = z
  .strictObject({
    name: z.string().trim().min(2).max(100),
    email: emailSchema,
    password: passwordSchema,
    phone: phoneSchema.optional(),
  })
  .meta({
    example: {
      name: 'Paula Lima',
      email: 'paula@exemplo.com',
      password: 'senha-forte-123',
      phone: '(11) 97777-6666',
    },
  });
export type PublicRegisterInput = z.infer<typeof publicRegisterSchema>;

export const publicLoginSchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(1).max(128),
});
export type PublicLoginInput = z.infer<typeof publicLoginSchema>;

export const publicBookingSchema = z
  .strictObject({
    /** Omitido = "qualquer profissional": o sistema escolhe quem estiver livre. */
    professionalId: z.uuid().optional(),
    serviceIds: z.array(z.uuid()).min(1).max(10),
    startsAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
  })
  .meta({
    example: {
      serviceIds: ['0199a1b2-0000-7000-8000-000000000003'],
      startsAt: '2030-03-04T10:00:00-03:00',
    },
  });
export type PublicBookingInput = z.infer<typeof publicBookingSchema>;

export { availabilityQuerySchema as publicAvailabilitySchema };
