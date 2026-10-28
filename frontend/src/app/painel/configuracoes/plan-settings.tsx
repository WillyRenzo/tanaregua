'use client';

import { AlertTriangle } from 'lucide-react';
import { subscriptionStatusLabel } from '@/lib/plans';
import { useAuthenticatedSession } from '@/lib/session/use-session';

/** Plano da barbearia (business-rules §12). A troca de plano chega com a cobrança recorrente. */
export function PlanSettings() {
  const { profile } = useAuthenticatedSession();
  const subscription = profile.subscription;
  const status = subscription ? subscriptionStatusLabel(subscription.status) : null;

  return (
    <section id="plano" aria-labelledby="plano-titulo" className="grid max-w-lg scroll-mt-6 gap-3">
      <h2 id="plano-titulo" className="text-2xl font-bold">
        Plano
      </h2>
      {subscription ? (
        <p>
          Sua barbearia está no plano <strong>{subscription.plan.name}</strong>.
        </p>
      ) : (
        <p>Sua barbearia está sem assinatura. Fale com o suporte do TaNaRegua.</p>
      )}
      {status && (
        <p className="text-destructive flex items-center gap-2 text-sm font-medium">
          <AlertTriangle aria-hidden className="size-4" />
          {status}
        </p>
      )}
    </section>
  );
}
