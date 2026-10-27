import type { components } from '@/lib/api/schema';

export type SessionProfile = components['schemas']['SessionProfile'];
export type SessionResponse = components['schemas']['Session'];

export type SessionState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; accessToken: string; profile: SessionProfile };

/**
 * Painel (equipe) e agendamento online (cliente) são sessões independentes, como no
 * backend (cookies `tnr_refresh` e `tnr_client_refresh`): entrar como cliente na página
 * pública não troca a sessão do painel no mesmo navegador.
 */
export type SessionAudience = 'panel' | 'client';

export type SessionStore = ReturnType<typeof createSessionStore>;

/**
 * Sessão só em memória (security.md): o access token nunca vai para localStorage.
 * Recarregar a página reconstrói a sessão pelo cookie httpOnly de refresh.
 */
function createSessionStore() {
  let state: SessionState = { status: 'loading' };
  const listeners = new Set<() => void>();

  const store = {
    get: (): SessionState => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next: SessionState): void {
      state = next;
      listeners.forEach((listener) => listener());
    },
    fromResponse(response: SessionResponse): void {
      store.set({ status: 'authenticated', accessToken: response.accessToken, profile: response.profile });
    },
    accessToken(): string | undefined {
      return state.status === 'authenticated' ? state.accessToken : undefined;
    },
  };
  return store;
}

/** Sessão do painel da barbearia. */
export const sessionStore = createSessionStore();
/** Sessão do cliente final na página pública de agendamento. */
export const clientSessionStore = createSessionStore();

export const sessionStores: Record<SessionAudience, SessionStore> = {
  panel: sessionStore,
  client: clientSessionStore,
};
