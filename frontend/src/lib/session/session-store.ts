import type { components } from '@/lib/api/schema';

export type SessionProfile = components['schemas']['SessionProfile'];
export type SessionResponse = components['schemas']['Session'];

export type SessionState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; accessToken: string; profile: SessionProfile };

/**
 * Sessão só em memória (security.md): o access token nunca vai para localStorage.
 * Recarregar a página reconstrói a sessão pelo cookie httpOnly de refresh.
 */
let state: SessionState = { status: 'loading' };
const listeners = new Set<() => void>();

export const sessionStore = {
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
    sessionStore.set({
      status: 'authenticated',
      accessToken: response.accessToken,
      profile: response.profile,
    });
  },
  accessToken(): string | undefined {
    return state.status === 'authenticated' ? state.accessToken : undefined;
  },
};
