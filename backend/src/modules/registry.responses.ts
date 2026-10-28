import { z } from 'zod';
import { pageSchema } from '../common/http/openapi.js';

/**
 * Contratos de resposta dos cadastros (auth, barbearia, equipe, clientes, catálogo).
 * Os tipos usados pelos services são derivados daqui.
 */

export const sessionProfileSchema = z
  .object({
    user: z.object({ id: z.uuid(), name: z.string(), email: z.string() }),
    barbershop: z.object({ id: z.uuid(), name: z.string(), slug: z.string(), timezone: z.string() }),
    membership: z.object({
      id: z.uuid(),
      isProfessional: z.boolean(),
      role: z.object({ key: z.string(), name: z.string() }),
    }),
    permissions: z.array(z.string()),
  })
  .meta({ id: 'SessionProfile' });
export type SessionProfile = z.infer<typeof sessionProfileSchema>;

export const sessionResponseSchema = z
  .object({ accessToken: z.string(), expiresIn: z.int(), profile: sessionProfileSchema })
  .meta({ id: 'Session' });
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

/** Identidade visual (business-rules §10). O frontend deriva as cores de contraste. */
export const brandSchema = z
  .object({
    primaryColor: z.string().nullable(),
    secondaryColor: z.string().nullable(),
    /** Muda a cada logo novo: vai na URL da imagem para furar o cache. `null` = sem logo. */
    logoVersion: z.string().nullable(),
  })
  .meta({ id: 'Brand' });
export type Brand = z.infer<typeof brandSchema>;

export const barbershopSettingsSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    slug: z.string(),
    timezone: z.string(),
    cancellationMinNoticeMinutes: z.int(),
    rescheduleMinNoticeMinutes: z.int(),
    bufferMinutes: z.int(),
    brand: brandSchema,
  })
  .meta({ id: 'BarbershopSettings' });
export type BarbershopSettings = z.infer<typeof barbershopSettingsSchema>;

export const staffMemberSchema = z
  .object({
    id: z.uuid(),
    userId: z.uuid(),
    name: z.string(),
    email: z.string(),
    isProfessional: z.boolean(),
    active: z.boolean(),
    role: z.object({ key: z.string(), name: z.string() }),
  })
  .meta({ id: 'StaffMember' });
export type StaffMember = z.infer<typeof staffMemberSchema>;

export const roleSchema = z
  .object({
    id: z.uuid(),
    key: z.string(),
    name: z.string(),
    isSystem: z.boolean(),
    permissions: z.array(z.string()),
  })
  .meta({ id: 'Role' });

export const scheduleIntervalSchema = z
  .object({ weekday: z.int(), start: z.string(), end: z.string() })
  .meta({ id: 'ScheduleInterval' });
export type ScheduleInterval = z.infer<typeof scheduleIntervalSchema>;

export const timeOffSchema = z
  .object({
    id: z.uuid(),
    membershipId: z.uuid(),
    startsAt: z.date(),
    endsAt: z.date(),
    reason: z.string().nullable(),
  })
  .meta({ id: 'TimeOff' });

export const clientViewSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    birthDate: z.string().nullable(),
    notes: z.string().nullable(),
    /** Data em que cada canal foi consentido; null = sem consentimento naquele canal. */
    consents: z.object({ email: z.date().nullable(), whatsapp: z.date().nullable() }),
    hasAccount: z.boolean(),
    anonymized: z.boolean(),
  })
  .meta({ id: 'Client' });
export type ClientView = z.infer<typeof clientViewSchema>;
export const clientPageSchema = pageSchema(clientViewSchema, 'ClientPage');

export const serviceViewSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    description: z.string().nullable(),
    priceCents: z.int(),
    durationMinutes: z.int(),
    active: z.boolean(),
  })
  .meta({ id: 'Service' });
export type ServiceView = z.infer<typeof serviceViewSchema>;

export const commissionRuleSchema = z
  .object({
    id: z.uuid(),
    membershipId: z.uuid().nullable(),
    serviceId: z.uuid().nullable(),
    productId: z.uuid().nullable(),
    type: z.enum(['PERCENT', 'FIXED']),
    value: z.int(),
  })
  .meta({ id: 'CommissionRule' });
