import request from 'supertest';
import { as, type Tenant, type TestApp } from './app.js';

export interface ProbeRequest {
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  url: string;
  body?: object;
}

/**
 * Regra de isolamento (business-rules §1): recurso de outra barbearia responde 404,
 * nunca 403 (não revela que existe) e nunca 2xx. Use em todo recurso novo.
 */
export async function expectTenantIsolation(
  app: TestApp,
  intruder: Tenant,
  probes: ProbeRequest[],
): Promise<void> {
  for (const probe of probes) {
    const response = await as(app, intruder.token)
      [probe.method](probe.url)
      .send(probe.body ?? {});
    expect(response.status, `${probe.method.toUpperCase()} ${probe.url}`).toBe(404);
  }
}

export async function login(app: TestApp, email: string, password: string): Promise<string> {
  const response = await request(app.getHttpServer())
    .post('/v1/auth/login')
    .send({ email, password })
    .expect(200);
  return response.body.accessToken;
}
