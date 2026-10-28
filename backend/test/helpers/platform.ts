import { randomInt, randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { createPlatformAdmin } from '../../src/modules/platform/platform-admins.js';
import type { TestApp } from './app.js';

/**
 * Conexão com o usuário dono das tabelas: só para o que a aplicação não pode fazer, como
 * criar um administrador da plataforma (o comando `platform-admin` faz o mesmo em produção).
 */
export function ownerClient(): PrismaClient {
  const url = process.env['DATABASE_MIGRATION_URL'];
  if (!url) throw new Error('DATABASE_MIGRATION_URL ausente no ambiente de teste');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

export interface TestPlatformAdmin {
  id: string;
  email: string;
  password: string;
}

export async function createTestPlatformAdmin(owner: PrismaClient): Promise<TestPlatformAdmin> {
  const email = `admin-${randomUUID().slice(0, 8)}@tanaregua.test`;
  const password = 'senha-da-plataforma-123';
  const admin = await createPlatformAdmin(owner, { email, name: 'Admin Teste', password });
  return { id: admin.id, email, password };
}

/** Entra na administração; devolve o access token e o cookie de refresh da plataforma. */
export async function platformLogin(app: TestApp, admin: TestPlatformAdmin) {
  const response = await request(app.getHttpServer())
    .post('/v1/platform/auth/login')
    .send({ email: admin.email, password: admin.password })
    .expect(200);
  const cookie = ([] as string[])
    .concat(response.headers['set-cookie'] ?? [])
    .find((value) => value.startsWith('tnr_platform_refresh='));
  if (!cookie) throw new Error('Login da plataforma sem cookie de refresh');
  return { token: response.body.accessToken as string, cookie: cookie.split(';')[0]!, body: response.body };
}

/**
 * Plano só deste teste (os planos reais são compartilhados entre os arquivos de teste, que
 * rodam em paralelo): mudar preço aqui não afeta o seed nem as outras suítes.
 */
export async function createTestPlan(owner: PrismaClient): Promise<string> {
  const key = `test-${randomUUID().slice(0, 8)}`;
  await owner.plan.create({
    data: { key, name: `Plano ${key}`, features: ['payroll'], position: 1000 + randomInt(1_000_000) },
  });
  return key;
}
