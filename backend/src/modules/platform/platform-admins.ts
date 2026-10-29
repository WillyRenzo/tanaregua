import { z } from 'zod';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { emailSchema } from '../auth/auth.schemas.js';
import { hashPassword } from '../auth/password.js';

/**
 * Contas da administração da plataforma. A aplicação não tem INSERT nem UPDATE em
 * `platform_admins`: estas funções recebem um client conectado com o usuário dono das
 * tabelas (DATABASE_MIGRATION_URL) e só rodam pelo comando `platform-admin` e pelo seed.
 */

/** [PROPOSTA] Mais longa que a da equipe: esta conta mexe no preço de todas as barbearias. */
export const platformPasswordSchema = z
  .string()
  .min(12, 'A senha da administração precisa de ao menos 12 caracteres.')
  .max(128);

export const platformAdminInputSchema = z.strictObject({
  email: emailSchema,
  name: z.string().trim().min(2).max(100),
  password: platformPasswordSchema,
});
export type PlatformAdminInput = z.input<typeof platformAdminInputSchema>;

type OwnerClient = Pick<PrismaClient, 'platformAdmin' | 'platformRefreshToken' | '$transaction'>;

export async function createPlatformAdmin(owner: OwnerClient, input: PlatformAdminInput) {
  const { email, name, password } = platformAdminInputSchema.parse(input);
  if (await owner.platformAdmin.findUnique({ where: { email }, select: { id: true } })) {
    throw new Error(`Já existe um administrador com o e-mail ${email}.`);
  }
  return owner.platformAdmin.create({
    data: { email, name, passwordHash: await hashPassword(password) },
    select: { id: true, email: true, name: true },
  });
}

/** Troca a senha e derruba as sessões abertas (quem tinha a senha antiga sai). */
export async function setPlatformAdminPassword(owner: OwnerClient, email: string, password: string) {
  const parsedEmail = emailSchema.parse(email);
  const passwordHash = await hashPassword(platformPasswordSchema.parse(password));
  const admin = await owner.platformAdmin.findUnique({ where: { email: parsedEmail }, select: { id: true } });
  if (!admin) throw new Error(`Nenhum administrador com o e-mail ${parsedEmail}.`);
  await owner.$transaction([
    owner.platformAdmin.update({ where: { id: admin.id }, data: { passwordHash } }),
    owner.platformRefreshToken.updateMany({
      where: { adminId: admin.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
}
