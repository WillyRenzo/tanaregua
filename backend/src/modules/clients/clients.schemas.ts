import { z } from 'zod';
import { cursorQuerySchema } from '../../common/http/pagination.js';

/** Guarda só dígitos; 10–13 dígitos cobre fixo/celular com ou sem DDI. */
export const phoneSchema = z
  .string()
  .transform((value) => value.replace(/\D/g, ''))
  .pipe(z.string().min(10, 'Telefone inválido.').max(13, 'Telefone inválido.'));

const birthDateSchema = z.iso
  .date('Use o formato AAAA-MM-DD.')
  .transform((value) => new Date(`${value}T00:00:00Z`));

export const consentChannelSchema = z.enum(['whatsapp', 'email', 'sms']);

const clientFields = {
  name: z.string().trim().min(2).max(100),
  phone: phoneSchema.nullable().optional(),
  email: z
    .email()
    .max(254)
    .transform((email) => email.toLowerCase())
    .nullable()
    .optional(),
  birthDate: birthDateSchema.nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  /** Consentimento para aniversário/marketing (business-rules §9). `null` revoga. */
  marketingConsent: z.strictObject({ channel: consentChannelSchema }).nullable().optional(),
};

export const createClientSchema = z.strictObject(clientFields);
export type CreateClientInput = z.infer<typeof createClientSchema>;

export const updateClientSchema = z.strictObject({ ...clientFields, name: clientFields.name.optional() });
export type UpdateClientInput = z.infer<typeof updateClientSchema>;

export const listClientsSchema = cursorQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
});
export type ListClientsQuery = z.infer<typeof listClientsSchema>;
