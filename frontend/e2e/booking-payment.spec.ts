import { randomUUID } from 'node:crypto';
import { expectNoSeriousViolations } from './axe';
import { api, expect, open, test } from './fixtures';

/**
 * Pagamento online da reserva (business-rules §5), com o gateway simulado
 * (`PAYMENT_PROVIDER=fake`): o checkout simulado aprova na hora e devolve o cliente.
 */
test('no modo exigido, o cliente paga o sinal no checkout e vê a reserva paga', async ({
  browser,
  page,
  shop,
}) => {
  // A barbearia conecta a conta antes de a página pública entrar no cache.
  await api(page.request, shop, 'put', '/v1/online-payments/account', {
    accessToken: 'APP_USR-token-de-producao-de-teste',
    webhookSecret: 'segredo-de-notificacoes-de-teste',
  });
  await api(page.request, shop, 'put', '/v1/online-payments/settings', {
    mode: 'REQUIRED',
    amount: 'DEPOSIT',
    depositBps: 4000,
  });

  const context = await browser.newContext();
  const client = await context.newPage();
  await open(client, `/${shop.slug}`);
  await expect(client.getByText('Para reservar, o sinal é pago online')).toBeVisible();

  await client.getByRole('checkbox', { name: /Corte Clássico/ }).click();
  await client.getByRole('button', { name: 'Continuar' }).click();
  await client.getByRole('button', { name: /Qualquer profissional/ }).click();
  await client.getByRole('group', { name: 'Dia' }).getByRole('button').nth(2).click();
  await client
    .getByRole('list', { name: /Horários livres/ })
    .getByRole('button')
    .first()
    .click();

  const suffix = randomUUID().slice(0, 8);
  await client.getByLabel('Nome').fill('Pedro Paga');
  await client.getByLabel('Celular (WhatsApp)').fill('11955554444');
  await client.getByLabel('E-mail').fill(`pedro-${suffix}@e2e.test`);
  await client.getByLabel('Crie uma senha').fill('senha-forte-123');
  await client.getByRole('button', { name: 'Criar conta e continuar' }).click();

  await expect(client.getByText(/Para garantir o horário, pague .* em até 15 minutos/)).toBeVisible();
  await expectNoSeriousViolations(client);
  await client.getByRole('button', { name: 'Reservar e pagar' }).click();

  // O checkout simulado aprova e devolve para "Meus agendamentos", que espera a confirmação.
  await expect(client).toHaveURL(new RegExp(`/${shop.slug}/meus-agendamentos\\?pagamento=`));
  await expect(client.getByText('Pagamento confirmado. Até lá!')).toBeVisible({ timeout: 30_000 });
  await expect(client.getByText(/Pago online · R\$/)).toBeVisible();
  await expectNoSeriousViolations(client);

  await context.close();
});
