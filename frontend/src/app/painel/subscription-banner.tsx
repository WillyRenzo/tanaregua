'use client';

import Link from 'next/link';
import { AlertTriangle, Info } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { can } from '@/lib/permissions';
import { accessNotice } from '@/lib/plans';
import { useAuthenticatedSession } from '@/lib/session/use-session';

/**
 * Situação da assinatura no topo do painel (business-rules §12): teste grátis, cancelada,
 * carência ou só leitura. Quem assina vê o atalho para os planos; a equipe, a quem recorrer.
 * É só aviso: quem barra as escritas no modo só leitura é a API (402).
 */
export function SubscriptionBanner() {
  const session = useAuthenticatedSession();
  const { subscription, barbershop } = session.profile;
  const notice = subscription ? accessNotice(subscription.access, barbershop.timezone) : null;
  if (!notice) return null;

  const warning = notice.tone === 'warning';
  const Icon = warning ? AlertTriangle : Info;
  return (
    <Alert variant={warning ? 'destructive' : 'default'} role={warning ? 'alert' : 'status'} className="mb-6">
      <Icon aria-hidden />
      <AlertDescription>
        <span>
          {notice.text}{' '}
          {can(session, 'subscription:manage') ? (
            <Link
              href="/painel/configuracoes#plano"
              className="text-primary font-medium underline underline-offset-4"
            >
              Ver planos
            </Link>
          ) : (
            'Fale com o dono da barbearia.'
          )}
        </span>
      </AlertDescription>
    </Alert>
  );
}
