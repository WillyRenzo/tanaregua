import { z } from 'zod';

const booleanFromString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3333),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** Proxies confiáveis à frente da API (load balancer). Sem isso, o rate limit vê o IP do proxy. */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  /** Só para rodar o E2E local (muitos cadastros do mesmo IP). Nunca desligar em produção. */
  RATE_LIMIT_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),

  DATABASE_URL: z.url(),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  CORS_ORIGINS: z
    .string()
    .min(1)
    .transform((value) => value.split(',').map((origin) => origin.trim())),
  APP_PUBLIC_URL: z.url(),

  OTEL_ENABLED: booleanFromString,
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),

  /** Armazenamento de arquivos (logos). Só 'local' por enquanto; S3-compatível vem depois. */
  STORAGE_DRIVER: z.enum(['local']).default('local'),
  /** Diretório do disco local (volume na VPS). */
  STORAGE_LOCAL_DIR: z.string().min(1).default('./storage'),

  MAIL_PROVIDER: z.enum(['log', 'resend']).default('log'),
  MAIL_FROM: z.string().min(1),
  RESEND_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/** Usado pelo ConfigModule: a aplicação não sobe com env inválido. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Variáveis de ambiente inválidas:\n${z.prettifyError(result.error)}`);
  }
  if (result.data.MAIL_PROVIDER === 'resend' && !result.data.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY é obrigatória quando MAIL_PROVIDER=resend');
  }
  if (result.data.NODE_ENV === 'production' && !result.data.RATE_LIMIT_ENABLED) {
    throw new Error('RATE_LIMIT_ENABLED=false não é permitido em produção');
  }
  return result.data;
}
