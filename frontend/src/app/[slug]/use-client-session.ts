'use client';

import { useEffect } from 'react';
import { refreshSession } from '@/lib/api/client';
import { useSession } from '@/lib/session/use-session';

/**
 * Sessão de cliente válida PARA ESTA barbearia (o token de outra barbearia ou de
 * funcionário não serve para agendar aqui — a API responderia 404/403).
 */
export function useClientSession(slug: string) {
  const session = useSession();

  useEffect(() => {
    if (session.status === 'loading') void refreshSession();
  }, [session.status]);

  const isClientHere =
    session.status === 'authenticated' &&
    session.profile.barbershop.slug === slug &&
    session.profile.permissions.includes('bookings:self');

  return { session, isClientHere, loading: session.status === 'loading' };
}
