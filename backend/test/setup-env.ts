import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inject } from 'vitest';

// Roda antes de cada arquivo de teste importar o AppModule (o ConfigModule lê o env no import).
Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'warn',
  DATABASE_URL: inject('databaseUrl'),
  JWT_ACCESS_SECRET: 'test-secret-with-at-least-thirty-two-characters',
  PLATFORM_JWT_SECRET: 'test-platform-secret-with-at-least-thirty-two-chars',
  DATABASE_MIGRATION_URL: inject('ownerDatabaseUrl'),
  JWT_ACCESS_TTL_SECONDS: '900',
  REFRESH_TOKEN_TTL_DAYS: '30',
  CORS_ORIGINS: 'http://localhost:3000',
  APP_PUBLIC_URL: 'http://localhost:3000',
  OTEL_ENABLED: 'false',
  MAIL_PROVIDER: 'log',
  MAIL_FROM: 'TaNaRegua <teste@tanaregua.local>',
  // Logos enviados nos testes não vão para backend/storage.
  STORAGE_DRIVER: 'local',
  STORAGE_LOCAL_DIR: join(tmpdir(), 'tanaregua-test-storage'),
});
