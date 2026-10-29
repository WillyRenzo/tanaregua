import type { SubscriptionDetail } from '../modules/subscriptions/subscriptions.responses.js';

/** Quanto o reajuste agendado soma ao preço atual do ciclo (centavos). */
export const BILLING_DEMO_RAISE_CENTS = 1000;

export interface BillingDemoOptions {
  /** API em execução: o gateway simulado guarda as assinaturas na memória desse processo. */
  apiUrl: string;
  owner: { email: string; password: string };
  platformAdmin: { email: string; password: string };
  planKey: string;
  interval: 'MONTHLY' | 'YEARLY';
  /** Chamado a cada espera pela confirmação (nos testes, processa o outbox na hora). */
  settle?: () => Promise<unknown>;
  timeoutMs?: number;
}

export interface BillingDemoResult {
  /** O que esta execução fez; vazio = a assinatura e o reajuste já existiam. */
  added: string[];
  subscription: SubscriptionDetail;
}

/**
 * Assinatura paga com reajuste agendado, para testar a cobrança à mão. Fica fora do seed:
 * a demo começa sem assinatura paga para o dono poder experimentar o checkout simulado.
 *
 * Tudo passa pela API em execução, como no navegador: checkout, aprovação no gateway
 * simulado (que vive na memória da API) e reajuste pela administração da plataforma. Rodar
 * de novo não repete o que já existe. O reajuste muda o preço do plano no catálogo local.
 */
export async function seedBillingDemo(options: BillingDemoOptions): Promise<BillingDemoResult> {
  const api = (path: string, init: RequestInit & { token?: string } = {}) => {
    const { token, ...rest } = init;
    return fetch(`${options.apiUrl}${path}`, {
      ...rest,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
  };
  const json = async <T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> => {
    const response = await api(path, init);
    if (!response.ok) {
      throw new Error(
        `${init.method ?? 'GET'} ${path} respondeu ${response.status}: ${await response.text()}`,
      );
    }
    return (await response.json()) as T;
  };
  const login = async (path: string, { email, password }: { email: string; password: string }) =>
    (await json<{ accessToken: string }>(path, { method: 'POST', body: JSON.stringify({ email, password }) }))
      .accessToken;

  const added: string[] = [];
  const ownerToken = await login('/v1/auth/login', options.owner);
  const current = () => json<SubscriptionDetail>('/v1/subscription', { token: ownerToken });
  let subscription = await current();
  if (!subscription.onlineBilling) {
    throw new Error('A API está sem gateway de pagamento: suba-a com PAYMENT_PROVIDER=fake.');
  }

  if (subscription.canSubscribe) {
    const { checkoutUrl } = await json<{ checkoutUrl: string }>('/v1/subscription/checkout', {
      method: 'POST',
      token: ownerToken,
      body: JSON.stringify({ planKey: options.planKey, interval: options.interval }),
    });
    // O link é relativo ao painel (rewrite /api do Next); direto na API, sem o prefixo.
    const approval = await api(checkoutUrl.replace(/^\/api/, ''), { redirect: 'manual' });
    if (approval.status !== 303) {
      throw new Error(`O checkout simulado respondeu ${approval.status}: a API foi reiniciada no meio?`);
    }
    subscription = await waitFor(current, (detail) => !detail.canSubscribe, options);
    added.push(`assinatura paga do plano ${subscription.plan.name}`);
  }

  if (!subscription.scheduledChange && subscription.interval && subscription.amountCents) {
    const adminToken = await login('/v1/platform/auth/login', options.platformAdmin);
    const plans = await json<
      { key: string; prices: { monthlyCents: number | null; yearlyCents: number | null } }[]
    >('/v1/platform/plans', { token: adminToken });
    const plan = plans.find((candidate) => candidate.key === subscription.plan.key);
    if (!plan) throw new Error(`Plano ${subscription.plan.key} não encontrado na administração.`);
    const raised = subscription.amountCents + BILLING_DEMO_RAISE_CENTS;
    await json(`/v1/platform/plans/${plan.key}/prices`, {
      method: 'PUT',
      token: adminToken,
      body: JSON.stringify(
        subscription.interval === 'MONTHLY'
          ? { ...plan.prices, monthlyCents: raised }
          : { ...plan.prices, yearlyCents: raised },
      ),
    });
    subscription = await waitFor(current, (detail) => detail.scheduledChange !== null, options);
    added.push('reajuste agendado');
  }

  return { added, subscription };
}

/** A confirmação chega pelo outbox da API (a cada poucos segundos): espera por ela. */
async function waitFor(
  read: () => Promise<SubscriptionDetail>,
  done: (detail: SubscriptionDetail) => boolean,
  options: Pick<BillingDemoOptions, 'settle' | 'timeoutMs'>,
): Promise<SubscriptionDetail> {
  const deadline = Date.now() + (options.timeoutMs ?? 60_000);
  for (;;) {
    await options.settle?.();
    const detail = await read();
    if (done(detail)) return detail;
    if (Date.now() > deadline) {
      throw new Error('A API não confirmou a tempo. O outbox está rodando (NODE_ENV diferente de test)?');
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}
