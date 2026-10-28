'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Lock } from 'lucide-react';
import { can } from '@/lib/permissions';
import { hasFeature, planIncluding, type Feature } from '@/lib/plans';
import { usePlans } from '@/lib/queries';
import { useAuthenticatedSession } from '@/lib/session/use-session';

/**
 * Mostra o recurso se o plano da barbearia inclui; senão, o convite de upgrade
 * ("disponível no plano X"). Só UX: a API recusa com `plan-upgrade-required` de qualquer forma.
 */
export function FeatureGate({ feature, children }: { feature: Feature; children: ReactNode }) {
  const session = useAuthenticatedSession();
  if (hasFeature(session, feature)) return children;
  return <UpgradeNotice feature={feature} canManage={can(session, 'barbershop:manage')} />;
}

function UpgradeNotice({ feature, canManage }: { feature: Feature; canManage: boolean }) {
  const plans = usePlans();
  const plan = plans.data ? planIncluding(feature, plans.data) : undefined;
  return (
    <div className="border-border flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
      <Lock aria-hidden className="text-muted-foreground size-6" />
      <p className="font-heading text-xl font-semibold tracking-wide uppercase">
        {plan ? `Disponível no plano ${plan.name}` : 'Fora do plano atual'}
      </p>
      <p className="text-muted-foreground max-w-sm text-sm">
        {canManage ? (
          <>
            Este recurso não faz parte do plano da sua barbearia.{' '}
            <Link href="/painel/configuracoes#plano" className="text-primary underline underline-offset-4">
              Ver o plano atual
            </Link>
          </>
        ) : (
          'Este recurso não faz parte do plano da barbearia. Fale com o dono para trocar de plano.'
        )}
      </p>
    </div>
  );
}
