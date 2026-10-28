import type { components } from '@/lib/api/schema';

export type SessionProfile = components['schemas']['SessionProfile'];
export type SessionResponse = components['schemas']['Session'];
export type PlatformProfile = components['schemas']['PlatformProfile'];
export type PlatformSessionResponse = components['schemas']['PlatformSession'];

export type SessionState<Profile = SessionProfile> =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; accessToken: string; profile: Profile };

/**
 * Painel (equipe), agendamento online (cliente) e administração da plataforma são sessões
 * independentes, como no backend (cookies `tnr_refresh`, `tnr_client_refresh` e
 * `tnr_platform_refresh`): entrar numa não troca nem derruba as outras no mesmo navegador.
 */
export type SessionAudience = 'panel' | 'client' | 'platform';

export type SessionStore<Profile = SessionProfile> = ReturnType<typeof createSessionStore<Profile>>;

/**
 * Sessão só em memória (security.md): o access token nunca vai para localStorage.
 * Recarregar a página reconstrói a sessão pelo cookie httpOnly de refresh.
 */
function createSessionStore<Profile>() {
  let state: SessionState<Profile> = { status: 'loading' };
  const listeners = new Set<() => void>();

  const store = {
    get: (): SessionState<Profile> => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next: SessionState<Profile>): void {
      state = next;
      listeners.forEach((listener) => listener());
    },
    fromResponse(response: { accessToken: string; profile: Profile }): void {
      store.set({ status: 'authenticated', accessToken: response.accessToken, profile: response.profile });
    },
    accessToken(): string | undefined {
      return state.status === 'authenticated' ? state.accessToken : undefined;
    },
  };
  return store;
}

/** Sessão do painel da barbearia. */
export const sessionStore = createSessionStore<SessionProfile>();
/** Sessão do cliente final na página pública de agendamento. */
export const clientSessionStore = createSessionStore<SessionProfile>();
/** Sessão de quem administra a plataforma (/admin). */
export const platformSessionStore = createSessionStore<PlatformProfile>();

/** Visão sem o tipo do perfil, para o cliente da API, que só lida com tokens. */
export const sessionStores: Record<SessionAudience, SessionStore<unknown>> = {
  panel: sessionStore,
  client: clientSessionStore,
  platform: platformSessionStore,
};
