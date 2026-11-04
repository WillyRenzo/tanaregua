import { expectNoSeriousViolations } from './axe';
import { expect, open, test } from './fixtures';

/**
 * Conta de pagamento da barbearia (business-rules §5). Roda com o gateway simulado
 * (`PAYMENT_PROVIDER=fake`, padrão do docker-compose de dev), que aceita qualquer conta.
 */
test('o dono conecta a conta de pagamento e configura o sinal da reserva', async ({ page, shop }) => {
  void shop; // barbearia nova: em teste grátis no plano mais completo, que tem o recurso
  await open(page, '/painel/configuracoes#pagamento');
  const section = page.getByRole('region', { name: 'Pagamento online' });

  await section.getByLabel('Access token de produção').fill('APP_USR-token-de-producao-de-teste');
  await section.getByLabel('Assinatura secreta das notificações').fill('segredo-de-notificacoes-de-teste');
  await section.getByRole('button', { name: 'Conectar' }).click();
  await expect(section.getByText('Conectada: Conta de teste')).toBeVisible();

  await section.getByRole('combobox', { name: 'Pagamento na reserva online' }).click();
  await page.getByRole('option', { name: /Exigido/ }).click();
  await section.getByRole('combobox', { name: 'Valor cobrado online' }).click();
  await page.getByRole('option', { name: /Um sinal/ }).click();
  await section.getByLabel('Sinal (%)').fill('40');
  await expectNoSeriousViolations(page);
  await section.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Pagamento online atualizado.')).toBeVisible();

  // A configuração fica salva: ao voltar à página, o sinal continua lá.
  await page.reload();
  await expect(section.getByLabel('Sinal (%)')).toHaveValue('40');
  await expect(section.getByRole('combobox', { name: 'Pagamento na reserva online' })).toContainText(
    'Exigido',
  );
});
