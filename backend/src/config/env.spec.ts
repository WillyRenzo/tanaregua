import { validateEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgresql://app:app@db:5432/app',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
  CORS_ORIGINS: 'http://localhost:3000',
  APP_PUBLIC_URL: 'http://localhost:3000',
  MAIL_FROM: 'TaNaRegua <nao-responda@teste.local>',
};

const production = {
  ...base,
  NODE_ENV: 'production',
  SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  TRUST_PROXY_HOPS: '1',
  INTERNAL_API_TOKEN: 'i'.repeat(48),
  PLATFORM_JWT_SECRET: 'p'.repeat(48),
};

describe('validateEnv', () => {
  it('aceita o mínimo em desenvolvimento, sem proxy nem token interno', () => {
    const env = validateEnv(base);
    expect(env.TRUST_PROXY_HOPS).toBe(0);
    expect(env.INTERNAL_API_TOKEN).toBeUndefined();
  });

  it('aceita a configuração completa de produção', () => {
    expect(validateEnv(production).NODE_ENV).toBe('production');
  });

  it('em produção, recusa subir sem proxy confiável (o rate limit veria só o IP do proxy)', () => {
    expect(() => validateEnv({ ...production, TRUST_PROXY_HOPS: '0' })).toThrow(/TRUST_PROXY_HOPS/);
  });

  it('em produção, recusa subir sem o token das chamadas internas', () => {
    expect(() => validateEnv({ ...production, INTERNAL_API_TOKEN: '' })).toThrow(/INTERNAL_API_TOKEN/);
  });

  it('em produção, recusa subir sem o segredo da administração da plataforma', () => {
    expect(() => validateEnv({ ...production, PLATFORM_JWT_SECRET: '' })).toThrow(/PLATFORM_JWT_SECRET/);
  });

  it('recusa o mesmo segredo para a barbearia e para a plataforma (um token valeria nas duas)', () => {
    expect(() => validateEnv({ ...base, PLATFORM_JWT_SECRET: base.JWT_ACCESS_SECRET })).toThrow(
      /PLATFORM_JWT_SECRET/,
    );
  });

  it('recusa token interno curto', () => {
    expect(() => validateEnv({ ...base, INTERNAL_API_TOKEN: 'curto' })).toThrow(/INTERNAL_API_TOKEN/);
  });

  it('em produção, mantém as travas anteriores', () => {
    expect(() => validateEnv({ ...production, SECRETS_ENCRYPTION_KEY: '' })).toThrow(
      /SECRETS_ENCRYPTION_KEY/,
    );
    expect(() => validateEnv({ ...production, RATE_LIMIT_ENABLED: 'false' })).toThrow(/RATE_LIMIT_ENABLED/);
  });
});
