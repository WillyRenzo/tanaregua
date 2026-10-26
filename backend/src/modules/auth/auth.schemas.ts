import { z } from 'zod';

export const emailSchema = z
  .email('E-mail inválido.')
  .max(254)
  .transform((email) => email.trim().toLowerCase());

export const passwordSchema = z.string().min(8, 'A senha precisa de ao menos 8 caracteres.').max(128);

export const slugSchema = z
  .string()
  .min(3)
  .max(50)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use letras minúsculas, números e hífens.');

/**
 * A página pública de cada barbearia fica em /{slug} no frontend: slugs que colidem com
 * rotas do sistema deixariam a página inacessível. Mantenha em sincronia com as rotas
 * de primeiro nível de frontend/src/app.
 */
export const RESERVED_SLUGS = new Set([
  'api',
  'painel',
  'entrar',
  'cadastro',
  'sair',
  'admin',
  'ajuda',
  'termos',
  'privacidade',
  'static',
  'assets',
]);

const newSlugSchema = slugSchema.refine((slug) => !RESERVED_SLUGS.has(slug), 'Este endereço é reservado.');

export const registerBarbershopSchema = z
  .strictObject({
    barbershopName: z.string().trim().min(2).max(100),
    slug: newSlugSchema,
    ownerName: z.string().trim().min(2).max(100),
    email: emailSchema,
    password: passwordSchema,
    /** Em barbearias pequenas o dono costuma atender; ele aparece na agenda. */
    ownerIsProfessional: z.boolean().default(true),
  })
  .meta({
    example: {
      barbershopName: 'Barbearia do Zé',
      slug: 'barbearia-do-ze',
      ownerName: 'José Silva',
      email: 'ze@exemplo.com',
      password: 'senha-forte-123',
      ownerIsProfessional: true,
    },
  });
export type RegisterBarbershopInput = z.infer<typeof registerBarbershopSchema>;

export const loginSchema = z
  .strictObject({
    email: emailSchema,
    password: z.string().min(1).max(128),
    /** Para quem tem vínculo com mais de uma barbearia. */
    barbershopSlug: slugSchema.optional(),
  })
  .meta({ example: { email: 'ze@exemplo.com', password: 'senha-forte-123' } });
export type LoginInput = z.infer<typeof loginSchema>;
