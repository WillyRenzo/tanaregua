'use client';

import { useSyncExternalStore } from 'react';
import {
  clientSessionStore,
  platformSessionStore,
  sessionStore,
  type PlatformProfile,
  type SessionState,
  type SessionStore,
} from './session-store';

const serverSnapshot = { status: 'loading' } as const;

const useStore = <Profile>(store: SessionStore<Profile>): SessionState<Profile> =>
  useSyncExternalStore(store.subscribe, store.get, () => serverSnapshot);

/** Sessão do painel. */
export function useSession(): SessionState {
  return useStore(sessionStore);
}

/** Sessão do cliente final (agendamento online), independente da do painel. */
export function useClientSessionState(): SessionState {
  return useStore(clientSessionStore);
}

/** Sessão da administração da plataforma, independente das outras duas. */
export function usePlatformSession(): SessionState<PlatformProfile> {
  return useStore(platformSessionStore);
}

/** Para telas que só renderizam com sessão (dentro do layout do painel). */
export function useAuthenticatedSession() {
  const session = useSession();
  if (session.status !== 'authenticated') {
    throw new Error('useAuthenticatedSession usado fora de uma área autenticada');
  }
  return session;
}
