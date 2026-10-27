'use client';

import { useSyncExternalStore } from 'react';
import { clientSessionStore, sessionStore, type SessionState, type SessionStore } from './session-store';

const serverSnapshot: SessionState = { status: 'loading' };

const useStore = (store: SessionStore): SessionState =>
  useSyncExternalStore(store.subscribe, store.get, () => serverSnapshot);

/** Sessão do painel. */
export function useSession(): SessionState {
  return useStore(sessionStore);
}

/** Sessão do cliente final (agendamento online), independente da do painel. */
export function useClientSessionState(): SessionState {
  return useStore(clientSessionStore);
}

/** Para telas que só renderizam com sessão (dentro do layout do painel). */
export function useAuthenticatedSession() {
  const session = useSession();
  if (session.status !== 'authenticated') {
    throw new Error('useAuthenticatedSession usado fora de uma área autenticada');
  }
  return session;
}
