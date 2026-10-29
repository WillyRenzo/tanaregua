import { api, unwrap } from '@/lib/api/client';
import type { components } from '@/lib/api/schema';
import { clientSessionStore, platformSessionStore, sessionStore } from './session-store';

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
  clientSessionStore.fromResponse(session);
  return session;
}

export async function clientRegister(
  slug: string,
  body: { name: string; email: string; password: string; phone?: string },
) {
  const session = await unwrap(
    api.POST('/v1/public/{slug}/auth/register', { params: { path: { slug } }, body }),
  );
  clientSessionStore.fromResponse(session);
  return session;
}

export type SessionPayload = Body<'Session'>;

/** Administração da plataforma: login e cookie próprios, sem relação com o painel. */
export async function platformLogin(body: { email: string; password: string }) {
  const session = await unwrap(api.POST('/v1/platform/auth/login', { body }));
  platformSessionStore.fromResponse(session);
  return session;
}

export async function platformLogout(): Promise<void> {
  await api.POST('/v1/platform/auth/logout');
  platformSessionStore.set({ status: 'anonymous' });
}

/**
 * Relê o perfil do painel sem trocar o token (ex.: o plano mudou depois da confirmação do
 * pagamento). Os recursos do plano vêm no perfil, não no token.
 */
export async function refreshPanelProfile(): Promise<void> {
  const profile = await unwrap(api.GET('/v1/auth/me'));
  const current = sessionStore.get();
  if (current.status === 'authenticated') sessionStore.set({ ...current, profile });
}
