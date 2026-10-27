'use client';

import { useEffect } from 'react';
import { refreshSession } from '@/lib/api/client';
import { useClientSessionState } from '@/lib/session/use-session';

/**
 * Sessão de cliente válida PARA ESTA barbearia (o token de outra barbearia ou de
 * funcionário não serve para agendar aqui — a API responderia 404/403). É independente
 * da sessão do painel: a mesma pessoa pode estar logada nos dois no mesmo navegador.
 */
export function useClientSession(slug: string) {
  const session = useClientSessionState();

  useEffect(() => {
    if (session.status === 'loading') void refreshSession('client');
  }, [session.status]);

  const isClientHere =
    session.status === 'authenticated' &&
    session.profile.barbershop.slug === slug &&
    session.profile.permissions.includes('bookings:self');

  return { session, isClientHere, loading: session.status === 'loading' };
}
