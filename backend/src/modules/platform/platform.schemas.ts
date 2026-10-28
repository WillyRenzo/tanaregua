import { z } from 'zod';
import { emailSchema } from '../auth/auth.schemas.js';

/** Contratos da administração da plataforma (entrada e saída). */

export const platformLoginSchema = z
  .strictObject({ email: emailSchema, password: z.string().min(1).max(128) })
  .meta({ id: 'PlatformLoginInput', example: { email: 'voce@tanaregua.app', password: '••••••••••••' } });
export type PlatformLoginInput = z.infer<typeof platformLoginSchema>;

export const platformProfileSchema = z
  .object({ admin: z.object({ id: z.uuid(), name: z.string(), email: z.string() }) })
  .meta({ id: 'PlatformProfile' });
export type PlatformProfile = z.infer<typeof platformProfileSchema>;

export const platformSessionSchema = z
  .object({ accessToken: z.string(), expiresIn: z.int(), profile: platformProfileSchema })
  .meta({ id: 'PlatformSession' });
export type PlatformSessionResponse = z.infer<typeof platformSessionSchema>;
