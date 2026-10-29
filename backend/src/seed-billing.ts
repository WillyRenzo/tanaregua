// Assinatura paga com reajuste agendado na Barbearia Demo, para testar a cobrança à mão:
// `npm run db:seed:billing` (depois do `db:seed`, com a API rodando no gateway simulado).
// Fica fora do seed: a demo começa sem assinatura paga para o dono testar o checkout.
import { DEMO_ACCOUNTS, DEMO_PASSWORD, DEMO_SLUG } from './seed/demo-seed.js';
import { BILLING_DEMO_RAISE_CENTS, seedBillingDemo } from './seed/billing-demo.js';
import { PLATFORM_ADMIN_EMAIL } from './seed/platform-seed.js';

if (process.env['NODE_ENV'] === 'production') {
  console.error('O seed de demonstração não roda em produção.');
  process.exit(1);
}

// Dentro do docker compose, a API é o serviço "backend"; fora dele, defina API_URL.
const apiUrl = process.env['API_URL'] ?? 'http://backend:3333';
const money = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

try {
  const { added, subscription } = await seedBillingDemo({
    apiUrl,
    owner: { email: DEMO_ACCOUNTS.owner.email, password: DEMO_PASSWORD },
    platformAdmin: { email: PLATFORM_ADMIN_EMAIL, password: DEMO_PASSWORD },
    planKey: 'premium',
    interval: 'MONTHLY',
  });
  console.log(
    added.length > 0
      ? `\nNa barbearia "${DEMO_SLUG}", acrescentei: ${added.join(', ')}.`
      : `\nA barbearia "${DEMO_SLUG}" já tem assinatura paga e reajuste agendado: nada foi alterado.`,
  );
  const change = subscription.scheduledChange;
  console.log(
    `Plano ${subscription.plan.name}, ${money(subscription.amountCents ?? 0)}` +
      (change
        ? `; reajuste para ${money(change.amountCents)} em ${change.effectiveAt.toString().slice(0, 10)}.`
        : '.'),
  );
  if (added.includes('reajuste agendado')) {
    console.log(
      `O preço do plano subiu ${money(BILLING_DEMO_RAISE_CENTS)} no catálogo; o e-mail de aviso sai no log da API.`,
    );
  }
  console.log('Veja em http://localhost:3000/painel/configuracoes#plano\n');
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
