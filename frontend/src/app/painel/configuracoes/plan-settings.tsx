'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, CalendarClock, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { ErrorState, LoadingRows } from '@/components/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { errorMessage } from '@/lib/api/errors';
import { formatDate, formatMoney, formatPercent } from '@/lib/format';
import { can } from '@/lib/permissions';
import {
  FEATURE_LABELS,
  INTERVAL_LABELS,
  priceFor,
  yearlyDiscount,
  type BillingInterval,
  type Plan,
} from '@/lib/plans';
import {
  useCancelSubscription,
  useChangePlan,
  usePlans,
  useStartCheckout,
  useSubscription,
  type SubscriptionDetail,
} from '@/lib/queries';
import { refreshPanelProfile } from '@/lib/session/auth';
import { useAuthenticatedSession, useSession } from '@/lib/session/use-session';

/** O retorno do checkout traz `?assinatura=retorno`; a confirmação vem do gateway, pela API. */
const RETURN_PARAM = 'assinatura';
/** Depois disso, para de consultar e explica que a confirmação pode demorar. */
const CONFIRMATION_WAIT_MS = 2 * 60_000;

/**
 * Plano da barbearia (business-rules §12). Quem assina e paga (`subscription:manage`) escolhe
 * plano e ciclo e vai ao checkout do gateway; os outros só veem em qual plano a barbearia está.
 */
export function PlanSettings({ timezone }: { timezone: string }) {
  const session = useSession();
  return (
    <section id="plano" aria-labelledby="plano-titulo" className="grid max-w-3xl scroll-mt-6 gap-4">
      <h2 id="plano-titulo" className="text-2xl font-bold">
        Plano
      </h2>
      {can(session, 'subscription:manage') ? <SubscriptionManager timezone={timezone} /> : <PlanSummary />}
    </section>
  );
}

function PlanSummary() {
  const { profile } = useAuthenticatedSession();
  const subscription = profile.subscription;
  if (!subscription) return <p>Sua barbearia está sem assinatura. Fale com o suporte do TaNaRegua.</p>;
  return (
    <>
      <p>
        Sua barbearia está no plano <strong>{subscription.plan.name}</strong>.
      </p>
    </>
  );
}

const cameFromCheckout = () =>
  typeof window !== 'undefined' && new URL(window.location.href).searchParams.get(RETURN_PARAM) === 'retorno';

/**
 * Lê e limpa o parâmetro de retorno do checkout, sem `useSearchParams`. Só renderiza no
 * navegador, depois que a sessão do painel existe: o estado inicial pode ler a URL.
 */
function useCheckoutReturn(): [boolean, () => void] {
  const [returning, setReturning] = useState(cameFromCheckout);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get(RETURN_PARAM) !== 'retorno') return;
    url.searchParams.delete(RETURN_PARAM);
    window.history.replaceState(null, '', url);
    const timer = window.setTimeout(() => setReturning(false), CONFIRMATION_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return [returning, useCallback(() => setReturning(false), [])];
}

function SubscriptionManager({ timezone }: { timezone: string }) {
  const [returning, stopWaiting] = useCheckoutReturn();
  const subscription = useSubscription({ awaitingConfirmation: returning });
  const confirmed = subscription.data?.amountCents != null && !subscription.data.canSubscribe;

  useEffect(() => {
    if (!returning || !confirmed) return;
    stopWaiting();
    toast.success('Pagamento confirmado. Sua assinatura está ativa.');
    // Os recursos do plano novo aparecem no menu sem precisar entrar de novo.
    void refreshPanelProfile();
  }, [returning, confirmed, stopWaiting]);

  if (subscription.isPending) return <LoadingRows rows={2} label="Carregando a assinatura" />;
  if (subscription.isError) {
    return <ErrorState error={subscription.error} onRetry={() => void subscription.refetch()} />;
  }
  const detail = subscription.data;

  return (
    <>
      <CurrentPlan detail={detail} timezone={timezone} />
      {returning && !confirmed && (
        <Alert role="status">
          <Loader2 aria-hidden className="animate-spin" />
          <AlertDescription>
            Estamos esperando o serviço de pagamento confirmar. Isso costuma levar alguns segundos.
          </AlertDescription>
        </Alert>
      )}
      {!detail.onlineBilling && (
        <p className="text-muted-foreground text-sm">
          A assinatura online ainda não está disponível. Para mudar de plano, fale com o suporte do TaNaRegua.
        </p>
      )}
      {detail.canChangePlan && <PlanChanger detail={detail} timezone={timezone} />}
      {detail.canSubscribe && <PlanPicker detail={detail} />}
      {detail.canChangePlan && <CancelSubscription detail={detail} timezone={timezone} />}
    </>
  );
}

function CurrentPlan({ detail, timezone }: { detail: SubscriptionDetail; timezone: string }) {
  const charging = detail.interval !== null && detail.amountCents !== null && detail.status !== 'CANCELED';
  const paidUntil = detail.access.state === 'active' && detail.access.until;
  return (
    <div className="grid gap-2">
      <p>
        Sua barbearia está no plano <strong>{detail.plan.name}</strong>
        {charging && (
          <>
            , com cobrança {INTERVAL_LABELS[detail.interval!].name} de{' '}
            <strong>{formatMoney(detail.amountCents!)}</strong>
          </>
        )}
        .{paidUntil && <> Período pago até {formatDate(paidUntil, timezone)}.</>}
      </p>
      {detail.scheduledPlan && <ScheduledDowngrade detail={detail} timezone={timezone} />}
      {detail.scheduledChange && (
        <Alert>
          <CalendarClock aria-hidden />
          <AlertDescription>
            Reajuste: a partir da primeira cobrança depois de{' '}
            {formatDate(detail.scheduledChange.effectiveAt, timezone)}, o valor passa a{' '}
            <strong>{formatMoney(detail.scheduledChange.amountCents)}</strong>.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function ScheduledDowngrade({ detail, timezone }: { detail: SubscriptionDetail; timezone: string }) {
  const changePlan = useChangePlan();
  const scheduled = detail.scheduledPlan!;
  const keep = async () => {
    try {
      await changePlan.mutateAsync({ planKey: detail.plan.key });
      toast.success(`Você continua no plano ${detail.plan.name}.`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };
  return (
    <Alert>
      <CalendarClock aria-hidden />
      <AlertDescription>
        <span>
          Em {formatDate(scheduled.effectiveAt, timezone)}, no fim do período pago, a barbearia passa ao plano{' '}
          <strong>{scheduled.plan.name}</strong>.{' '}
          <Button
            variant="link"
            className="h-auto p-0"
            onClick={() => void keep()}
            disabled={changePlan.isPending}
          >
            Manter o plano {detail.plan.name}
          </Button>
        </span>
      </AlertDescription>
    </Alert>
  );
}

/** Troca de plano com assinatura paga, no ciclo dela (business-rules §12). */
function PlanChanger({ detail, timezone }: { detail: SubscriptionDetail; timezone: string }) {
  const plans = usePlans();
  const interval = detail.interval!;
  if (plans.isPending) return <LoadingRows rows={3} label="Carregando os planos" />;
  if (plans.isError) return <ErrorState error={plans.error} onRetry={() => void plans.refetch()} />;

  const currentIndex = plans.data.findIndex((plan) => plan.key === detail.plan.key);
  const options = plans.data
    .map((plan, index) => ({ plan, upgrade: index > currentIndex }))
    .filter(
      ({ plan }) =>
        plan.key !== detail.plan.key &&
        plan.key !== detail.scheduledPlan?.plan.key &&
        priceFor(plan, interval) !== null,
    );
  if (options.length === 0) return null;

  return (
    <div className="grid gap-4">
      <h3 className="text-lg font-semibold">Trocar de plano</h3>
      <p className="text-muted-foreground text-sm">
        Upgrade libera os recursos na hora; downgrade vale no fim do período pago. O novo valor entra na
        próxima cobrança, sem cobrança proporcional. Para mudar de ciclo, cancele e assine de novo.
      </p>
      <div className="grid gap-4 md:grid-cols-3">
        {options.map(({ plan, upgrade }) => (
          <ChangePlanCard key={plan.key} plan={plan} detail={detail} upgrade={upgrade} timezone={timezone} />
        ))}
      </div>
    </div>
  );
}

function ChangePlanCard({
  plan,
  detail,
  upgrade,
  timezone,
}: {
  plan: Plan;
  detail: SubscriptionDetail;
  upgrade: boolean;
  timezone: string;
}) {
  const changePlan = useChangePlan();
  const [confirming, setConfirming] = useState(false);
  const interval = detail.interval!;
  const price = priceFor(plan, interval)!;
  const titleId = `trocar-${plan.key}`;
  const priceText = `${formatMoney(price)} por ${INTERVAL_LABELS[interval].per}`;
  const until = detail.access.until ? formatDate(detail.access.until, timezone) : 'o fim do período pago';
  const Icon = upgrade ? ArrowUpRight : ArrowDownRight;

  const confirm = async () => {
    try {
      await changePlan.mutateAsync({ planKey: plan.key });
      setConfirming(false);
      toast.success(
        upgrade
          ? `Pronto: sua barbearia está no plano ${plan.name}.`
          : `Mudança para o ${plan.name} agendada.`,
      );
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <Card role="region" aria-labelledby={titleId}>
      <CardHeader>
        <CardTitle id={titleId} className="text-xl">
          {plan.name}
        </CardTitle>
        <CardDescription>
          <span className="text-foreground text-2xl font-bold">{formatMoney(price)}</span> por{' '}
          {INTERVAL_LABELS[interval].per}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-1 text-sm">
          {plan.features.length === 0 && (
            <li className="flex items-center gap-2">
              <Check aria-hidden className="text-primary size-4" /> Agenda, comandas, caixa e relatórios
            </li>
          )}
          {plan.features.map((feature) => (
            <li key={feature} className="flex items-center gap-2">
              <Check aria-hidden className="text-primary size-4" /> {FEATURE_LABELS[feature]}
            </li>
          ))}
        </ul>
      </CardContent>
      <CardFooter>
        <Button variant="outline" onClick={() => setConfirming(true)} className="w-full">
          <Icon aria-hidden />
          Mudar para o {plan.name}
        </Button>
      </CardFooter>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mudar para o plano {plan.name}?</DialogTitle>
            <DialogDescription>
              {upgrade
                ? `Os recursos do ${plan.name} ficam disponíveis agora. A partir da próxima cobrança, o valor passa a ${priceText}, sem cobrança proporcional.`
                : `Você continua no plano ${detail.plan.name} até ${until}. Depois, a barbearia passa ao ${plan.name}, e a cobrança fica ${priceText}. Nenhum dado é apagado.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Voltar
            </Button>
            <Button onClick={() => void confirm()} disabled={changePlan.isPending}>
              {upgrade ? 'Mudar agora' : 'Agendar a mudança'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function CancelSubscription({ detail, timezone }: { detail: SubscriptionDetail; timezone: string }) {
  const cancel = useCancelSubscription();
  const [confirming, setConfirming] = useState(false);
  const until = detail.access.until ? formatDate(detail.access.until, timezone) : 'o fim do período pago';

  const confirm = async () => {
    try {
      await cancel.mutateAsync();
      setConfirming(false);
      toast.success(`Assinatura cancelada. O painel funciona até ${until}.`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="border-t pt-4">
      <Button variant="ghost" className="text-destructive" onClick={() => setConfirming(true)}>
        Cancelar a assinatura
      </Button>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar a assinatura?</DialogTitle>
            <DialogDescription>
              A cobrança recorrente para agora. O painel funciona normalmente até {until}; depois, fica só
              para consulta, e a página de agendamento continua no ar. Nenhum dado é apagado, e você pode
              assinar de novo quando quiser.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Manter a assinatura
            </Button>
            <Button variant="destructive" onClick={() => void confirm()} disabled={cancel.isPending}>
              Cancelar a assinatura
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PlanPicker({ detail }: { detail: SubscriptionDetail }) {
  const plans = usePlans();
  const [interval, setCycle] = useState<BillingInterval>(detail.pendingCheckout?.interval ?? 'MONTHLY');
  const pending = detail.pendingCheckout;

  return (
    <div className="grid gap-4">
      {pending && (
        <Alert>
          <AlertDescription>
            <span>
              Você começou a assinar o plano <strong>{pending.plan.name}</strong> (
              {INTERVAL_LABELS[pending.interval].name}, {formatMoney(pending.amountCents)}) e o pagamento
              ainda não foi confirmado.{' '}
              <a href={pending.checkoutUrl} className="text-primary font-medium underline underline-offset-4">
                Continuar o pagamento
              </a>
            </span>
          </AlertDescription>
        </Alert>
      )}
      <h3 className="text-lg font-semibold">Assinar um plano</h3>
      {plans.isPending ? (
        <LoadingRows rows={3} label="Carregando os planos" />
      ) : plans.isError ? (
        <ErrorState error={plans.error} onRetry={() => void plans.refetch()} />
      ) : (
        <Tabs value={interval} onValueChange={(value) => setCycle(value as BillingInterval)}>
          <TabsList aria-label="Ciclo de cobrança">
            <TabsTrigger value="MONTHLY">Mensal</TabsTrigger>
            <TabsTrigger value="YEARLY">Anual</TabsTrigger>
          </TabsList>
          {(['MONTHLY', 'YEARLY'] as const).map((value) => (
            <TabsContent key={value} value={value}>
              <PlanCards plans={plans.data} interval={value} currentKey={detail.plan.key} />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}

function PlanCards({
  plans,
  interval,
  currentKey,
}: {
  plans: Plan[];
  interval: BillingInterval;
  currentKey: string;
}) {
  const forSale = plans.filter((plan) => priceFor(plan, interval) !== null);
  if (forSale.length === 0) {
    return <p className="text-muted-foreground text-sm">Nenhum plano à venda neste ciclo.</p>;
  }
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {forSale.map((plan) => (
        <PlanCard key={plan.key} plan={plan} interval={interval} current={plan.key === currentKey} />
      ))}
    </div>
  );
}

function PlanCard({ plan, interval, current }: { plan: Plan; interval: BillingInterval; current: boolean }) {
  const startCheckout = useStartCheckout();
  const price = priceFor(plan, interval)!;
  const discount =
    interval === 'YEARLY' ? yearlyDiscount(plan.prices.monthlyCents, plan.prices.yearlyCents) : null;
  const titleId = `assinar-${plan.key}-${interval}`;

  const subscribe = async () => {
    try {
      const { checkoutUrl } = await startCheckout.mutateAsync({ planKey: plan.key, interval });
      window.location.assign(checkoutUrl);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <Card role="region" aria-labelledby={titleId}>
      <CardHeader>
        <CardTitle id={titleId} className="text-xl">
          {plan.name}
        </CardTitle>
        <CardDescription>
          <span className="text-foreground text-2xl font-bold">{formatMoney(price)}</span> por{' '}
          {INTERVAL_LABELS[interval].per}
          {discount !== null && discount > 0 && (
            <span className="block">{formatPercent(discount)} mais barato que 12 mensalidades</span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-1 text-sm">
          <li className="flex items-center gap-2">
            <Check aria-hidden className="text-primary size-4" /> Agenda, comandas, caixa e relatórios
          </li>
          {plan.features.map((feature) => (
            <li key={feature} className="flex items-center gap-2">
              <Check aria-hidden className="text-primary size-4" /> {FEATURE_LABELS[feature]}
            </li>
          ))}
        </ul>
      </CardContent>
      <CardFooter>
        <Button onClick={() => void subscribe()} disabled={startCheckout.isPending} className="w-full">
          {current ? 'Assinar e manter este plano' : `Assinar o ${plan.name}`}
        </Button>
      </CardFooter>
    </Card>
  );
}
