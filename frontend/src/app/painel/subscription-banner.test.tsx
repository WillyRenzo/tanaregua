import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { SubscriptionAccess } from '@/lib/plans';
import { sessionStore, type SessionProfile } from '@/lib/session/session-store';
import { SubscriptionBanner } from './subscription-banner';

function signIn(access: SubscriptionAccess, permissions: SessionProfile['permissions']) {
  sessionStore.set({
    status: 'authenticated',
    accessToken: 'token',
    profile: {
      user: { id: 'u', name: 'Dono', email: 'dono@teste.com' },
      barbershop: { id: 'b', name: 'Barbearia', slug: 'barbearia', timezone: 'America/Sao_Paulo' },
      membership: { id: 'm', isProfessional: false, role: { key: 'owner', name: 'Dono' } },
      permissions,
      subscription: { plan: { key: 'premium', name: 'Premium' }, status: 'TRIALING', features: [], access },
    },
  });
}

describe('SubscriptionBanner', () => {
  // Desmonta antes de sair da sessão: o aviso só existe dentro do painel autenticado.
  afterEach(() => {
    cleanup();
    sessionStore.set({ status: 'anonymous' });
  });

  it('em dia, não mostra nada', () => {
    signIn({ state: 'active', until: null }, ['subscription:manage']);
    const { container } = render(<SubscriptionBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('no teste grátis, quem assina vê até quando e o atalho para os planos', () => {
    signIn({ state: 'trial', until: '2026-11-13T15:00:00.000Z' }, ['subscription:manage']);
    render(<SubscriptionBanner />);
    expect(screen.getByRole('status')).toHaveTextContent('Teste grátis até 13/11/2026');
    expect(screen.getByRole('link', { name: 'Ver planos' })).toHaveAttribute(
      'href',
      '/painel/configuracoes#plano',
    );
  });

  it('só leitura é um alerta; a equipe é orientada a falar com o dono', () => {
    signIn({ state: 'read-only', until: null }, ['orders:manage']);
    render(<SubscriptionBanner />);
    expect(screen.getByRole('alert')).toHaveTextContent('só para consulta');
    expect(screen.getByRole('alert')).toHaveTextContent('Fale com o dono da barbearia.');
    expect(screen.queryByRole('link')).toBeNull();
  });
});
