import { randomUUID } from 'node:crypto';
import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';

const SP = 'America/Sao_Paulo';

export interface Shop {
  slug: string;
  name: string;
  token: string;
  membershipId: string;
  serviceId: string;
  clientId: string;
}

/** Data local (SP) daqui a N dias. */
export function localDate(days: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SP }).format(new Date(Date.now() + days * 86_400_000));
}

/** Instante ISO de um horário de São Paulo (UTC-3, sem horário de verão). */
export function spInstant(date: string, clock: string): string {
  return new Date(`${date}T${clock}:00-03:00`).toISOString();
}

async function call<T>(
  request: APIRequestContext,
  method: 'post' | 'put',
  url: string,
  token: string,
  data: unknown,
) {
  const response = await request[method](`/api${url}`, {
    data,
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok(), `${method.toUpperCase()} ${url}: ${await response.text()}`).toBeTruthy();
  return (await response.json()) as T;
}

/**
 * Barbearia pronta para uso: dono que atende, expediente 09–18 todos os dias, um
 * serviço e um cliente. Criada pela API (rápido); a UI é exercitada no teste.
 * O cadastro passa pelo `page.request`, então o cookie de sessão fica no navegador.
 */
export const test = base.extend<{ shop: Shop }>({
  shop: async ({ page }, provide) => {
    const suffix = randomUUID().slice(0, 8);
    const name = `Barbearia E2E ${suffix}`;
    const register = await page.request.post('/api/v1/auth/register-barbershop', {
      data: {
        barbershopName: name,
        slug: `e2e-${suffix}`,
        ownerName: 'Ana Dona',
        email: `ana-${suffix}@e2e.test`,
        password: 'senha-forte-123',
      },
    });
    expect(register.ok(), await register.text()).toBeTruthy();
    const session = (await register.json()) as {
      accessToken: string;
      profile: { membership: { id: string } };
    };
    const token = session.accessToken;
    const membershipId = session.profile.membership.id;

    const everyDay = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: '09:00', end: '18:00' }));
    await call(page.request, 'put', `/v1/staff/${membershipId}/schedule`, token, { intervals: everyDay });
    const service = await call<{ id: string }>(page.request, 'post', '/v1/services', token, {
      name: 'Corte Clássico',
      priceCents: 5000,
      durationMinutes: 30,
    });
    const client = await call<{ id: string }>(page.request, 'post', '/v1/clients', token, {
      name: 'Bruno Cliente',
      phone: '11988887777',
    });

    await provide({
      slug: `e2e-${suffix}`,
      name,
      token,
      membershipId,
      serviceId: service.id,
      clientId: client.id,
    });
  },
});

export { expect };

export async function api<T>(
  request: APIRequestContext,
  shop: Shop,
  method: 'post' | 'put',
  url: string,
  data: unknown,
) {
  return call<T>(request, method, url, shop.token, data);
}

/** Navega e espera o React hidratar (antes disso, cliques e digitação não têm efeito). */
export async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.locator('html[data-hydrated="true"]').waitFor({ state: 'attached' });
}
