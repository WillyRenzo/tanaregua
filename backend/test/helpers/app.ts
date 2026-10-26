import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';

export type TestApp = INestApplication<App>;

export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>({ logger: false });
  configureApp(app);
  await app.init();
  return app;
}

export interface Tenant {
  token: string;
  barbershopId: string;
  membershipId: string;
  userId: string;
  slug: string;
  email: string;
  password: string;
}

/** Cria uma barbearia isolada com dono; cada teste usa dados únicos. */
export async function registerTenant(
  app: TestApp,
  overrides: { ownerIsProfessional?: boolean } = {},
): Promise<Tenant> {
  const suffix = randomUUID().slice(0, 8);
  const body = {
    barbershopName: `Barbearia ${suffix}`,
    slug: `barbearia-${suffix}`,
    ownerName: 'Dono Teste',
    email: `dono-${suffix}@teste.com`,
    password: 'senha-forte-123',
    ...overrides,
  };
  const response = await request(app.getHttpServer())
    .post('/v1/auth/register-barbershop')
    .send(body)
    .expect(201);
  return {
    token: response.body.accessToken,
    barbershopId: response.body.profile.barbershop.id,
    membershipId: response.body.profile.membership.id,
    userId: response.body.profile.user.id,
    slug: body.slug,
    email: body.email,
    password: body.password,
  };
}

/** Atalho para requisições autenticadas. */
export function as(app: TestApp, token: string) {
  const server = app.getHttpServer();
  const auth = { Authorization: `Bearer ${token}` };
  return {
    get: (url: string) => request(server).get(url).set(auth),
    post: (url: string) => request(server).post(url).set(auth),
    patch: (url: string) => request(server).patch(url).set(auth),
    put: (url: string) => request(server).put(url).set(auth),
    delete: (url: string) => request(server).delete(url).set(auth),
  };
}
