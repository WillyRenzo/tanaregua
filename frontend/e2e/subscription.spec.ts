import { expectNoSeriousViolations } from './axe';
import { expect, open, test } from './fixtures';

/**
 * Assinatura pelo checkout do gateway (business-rules §12). Roda com o gateway simulado
 * (`PAYMENT_PROVIDER=fake`, padrão do docker-compose de dev), que aprova o checkout na hora,
 * e precisa dos preços do seed (`npm run db:seed`).
 */
test('o dono assina um plano e ele só muda depois da confirmação do gateway', async ({ page, shop }) => {
  void shop; // o fixture deixou o navegador logado como dono de uma barbearia nova
  await open(page, '/painel/configuracoes#plano');
  await expect(page.getByText('Sua barbearia está no plano Essencial.')).toBeVisible();

  await page.getByRole('tab', { name: 'Anual' }).click();
  const card = page.getByRole('region', { name: 'Profissional' });
  await expect(card.getByText(/por ano/)).toBeVisible();
  await expectNoSeriousViolations(page);

  await card.getByRole('button', { name: 'Assinar o Profissional' }).click();

  // Volta do checkout para Configurações; o plano muda quando o gateway confirma (fila).
  await expect(page).toHaveURL(/\/painel\/configuracoes/);
  await expect(page.getByText('Pagamento confirmado. Sua assinatura está ativa.')).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(/plano Profissional, com cobrança anual de/)).toBeVisible();
  await expect(page.getByText('A troca de plano estará disponível em breve.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Assinar/ })).toHaveCount(0);
});
