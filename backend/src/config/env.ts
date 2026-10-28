import { z } from 'zod';

const booleanFromString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3333),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /**
   * Proxies confiáveis à frente da API que preenchem o X-Forwarded-For. Sem isso, o rate
   * limit vê o IP do proxy e todos os visitantes dividem o mesmo limite. Em produção é 1:
   * o Caddy grava o IP do visitante e o Next repassa o cabeçalho sem acrescentar o seu.
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  /**
   * Segredo que o servidor do Next envia nas chamadas SSR (cabeçalho x-internal-token).
   * Essas chamadas saem todas do mesmo IP e não podem cair no rate limit dos visitantes.
   * Obrigatório em produção; gere com `openssl rand -base64 48`.
   */
  INTERNAL_API_TOKEN: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(32).optional(),
  ),
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

  /** WhatsApp (Cloud API da Meta): "log" simula o envio (dev/testes); "meta" envia de verdade. */
  WHATSAPP_PROVIDER: z.enum(['log', 'meta']).default('log'),
  /** Versão da Graph API usada pelo adapter da Meta (troca sem mudar código). */
  META_GRAPH_API_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/, 'Use o formato vNN.N.')
    .default('v23.0'),
  /**
   * Chave (base64 de 32 bytes) que cifra segredos de terceiros no banco, como o token do
   * WhatsApp de cada barbearia. Gere com `openssl rand -base64 32`. Obrigatória em produção.
   */
  SECRETS_ENCRYPTION_KEY: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z
      .base64()
      .refine((value) => Buffer.from(value, 'base64').length === 32, 'Precisa ter 32 bytes em base64.')
      .optional(),
  ),
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
  if (result.data.NODE_ENV === 'production' && !result.data.SECRETS_ENCRYPTION_KEY) {
    throw new Error('SECRETS_ENCRYPTION_KEY é obrigatória em produção');
  }
  if (result.data.NODE_ENV === 'production' && !result.data.RATE_LIMIT_ENABLED) {
    throw new Error('RATE_LIMIT_ENABLED=false não é permitido em produção');
  }
  // Em produção a API sempre fica atrás de um proxy (Caddy, e o Next no caminho do /api).
  if (result.data.NODE_ENV === 'production' && result.data.TRUST_PROXY_HOPS === 0) {
    throw new Error('TRUST_PROXY_HOPS precisa ser pelo menos 1 em produção (a API fica atrás do proxy)');
  }
  if (result.data.NODE_ENV === 'production' && !result.data.INTERNAL_API_TOKEN) {
    throw new Error('INTERNAL_API_TOKEN é obrigatória em produção');
  }
  return result.data;
}
