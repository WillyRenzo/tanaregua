import { api, unwrap } from '@/lib/api/client';
import type { components } from '@/lib/api/schema';
import { sessionStore } from './session-store';

type Body<T extends keyof components['schemas']> = components['schemas'][T];

export async function login(body: { email: string; password: string; barbershopSlug?: string }) {
  const session = await unwrap(api.POST('/v1/auth/login', { body }));
  sessionStore.fromResponse(session);
  return session;
}

export async function registerBarbershop(body: {
  barbershopName: string;
  slug: string;
  ownerName: string;
  email: string;
  password: string;
  ownerIsProfessional?: boolean;
}) {
  const session = await unwrap(api.POST('/v1/auth/register-barbershop', { body }));
  sessionStore.fromResponse(session);
  return session;
}

export async function logout(): Promise<void> {
  await api.POST('/v1/auth/logout');
  sessionStore.set({ status: 'anonymous' });
}

/** Login/cadastro do cliente final na página pública da barbearia. */
export async function clientLogin(slug: string, body: { email: string; password: string }) {
  const session = await unwrap(
    api.POST('/v1/public/{slug}/auth/login', { params: { path: { slug } }, body }),
  );
  sessionStore.fromResponse(session);
  return session;
}

export async function clientRegister(
  slug: string,
  body: { name: string; email: string; password: string; phone?: string },
) {
  const session = await unwrap(
    api.POST('/v1/public/{slug}/auth/register', { params: { path: { slug } }, body }),
  );
  sessionStore.fromResponse(session);
  return session;
}

export type SessionPayload = Body<'Session'>;
