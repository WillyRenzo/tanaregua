'use client';

import { useSyncExternalStore } from 'react';
import { sessionStore, type SessionState } from './session-store';

const serverSnapshot: SessionState = { status: 'loading' };

export function useSession(): SessionState {
  return useSyncExternalStore(sessionStore.subscribe, sessionStore.get, () => serverSnapshot);
}

/** Para telas que só renderizam com sessão (dentro do layout do painel). */
export function useAuthenticatedSession() {
  const session = useSession();
  if (session.status !== 'authenticated') {
    throw new Error('useAuthenticatedSession usado fora de uma área autenticada');
  }
  return session;
}
