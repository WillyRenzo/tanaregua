import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    ownerDatabaseUrl: string;
  }
}

let container: StartedPostgreSqlContainer | undefined;

/**
 * Sobe um Postgres efêmero (AFA 19: nada de banco compartilhado entre testes),
 * cria os usuários como em produção e aplica as migrations reais — assim RLS e
 * exclusion constraints são testados de verdade.
 */
export async function setup(project: TestProject): Promise<void> {
  container = await new PostgreSqlContainer('postgres:18-alpine')
    .withDatabase('tanaregua')
    .withUsername('tanaregua')
    .withPassword('tanaregua')
    .start();

  const rolesSql = readFileSync(new URL('../prisma/bootstrap/roles.sql', import.meta.url), 'utf8');
  const result = await container.exec([
    'psql',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    'tanaregua',
    '-d',
    'tanaregua',
    '-c',
    rolesSql,
  ]);
  if (result.exitCode !== 0) throw new Error(`Falha ao criar roles: ${result.output}`);

  const host = container.getHost();
  const port = container.getPort();
  const ownerDatabaseUrl = `postgresql://tanaregua:tanaregua@${host}:${port}/tanaregua`;
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_MIGRATION_URL: ownerDatabaseUrl,
    },
  });

  project.provide('databaseUrl', `postgresql://tanaregua_app:tanaregua_app@${host}:${port}/tanaregua`);
  // Dono das tabelas: só para o que a aplicação não pode fazer (criar administrador da plataforma).
  project.provide('ownerDatabaseUrl', ownerDatabaseUrl);
}

export async function teardown(): Promise<void> {
  await container?.stop();
}
