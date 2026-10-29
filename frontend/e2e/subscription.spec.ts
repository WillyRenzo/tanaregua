import { expectNoSeriousViolations } from './axe';
import { expect, open, test } from './fixtures';

/**
 * Assinatura pelo checkout do gateway (business-rules §12). Roda com o gateway simulado
 * (`PAYMENT_PROVIDER=fake`, padrão do docker-compose de dev), que aprova o checkout na hora,
 * e precisa dos preços do seed (`npm run db:seed`).
 */
test('do teste grátis à assinatura, troca de plano e cancelamento', async ({ page, shop }) => {
  void shop; // o fixture deixou o navegador logado como dono de uma barbearia nova
  await open(page, '/painel/configuracoes#plano');
  // Barbearia nova: teste grátis no plano mais completo, com o aviso no topo do painel.
  await expect(page.getByText('Sua barbearia está no plano Premium.')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /Teste grátis até/ })).toBeVisible();

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
  await expect(page.getByText(/Teste grátis até/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Assinar/ })).toHaveCount(0);

  // Downgrade: fica agendado para o fim do período pago, e dá para desfazer.
  await page
    .getByRole('region', { name: 'Essencial' })
    .getByRole('button', { name: 'Mudar para o Essencial' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Mudar para o plano Essencial?' });
  await expect(dialog).toContainText('Você continua no plano Profissional até');
  await expectNoSeriousViolations(page);
  await dialog.getByRole('button', { name: 'Agendar a mudança' }).click();
  await expect(page.getByText(/a barbearia passa ao plano Essencial/)).toBeVisible();
  await page.getByRole('button', { name: 'Manter o plano Profissional' }).click();
  await expect(page.getByText(/a barbearia passa ao plano Essencial/)).toHaveCount(0);

  // Cancelamento: usa até o fim do período pago, com o aviso no topo.
  await page.getByRole('button', { name: 'Cancelar a assinatura' }).click();
  await page
    .getByRole('dialog', { name: 'Cancelar a assinatura?' })
    .getByRole('button', { name: 'Cancelar a assinatura' })
    .click();
  await expect(
    page.getByRole('status').filter({ hasText: /Assinatura cancelada. O painel funciona até/ }),
  ).toBeVisible();
  // Cancelada, pode assinar de novo quando quiser.
  await expect(page.getByRole('button', { name: 'Assinar e manter este plano' })).toBeVisible();
});
