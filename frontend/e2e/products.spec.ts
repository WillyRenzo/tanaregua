import { expectNoSeriousViolations } from './axe';
import { api, expect, open, test } from './fixtures';

test('cadastra produto, dá entrada, vende no balcão e o estoque baixa', async ({ page, shop }) => {
  await open(page, '/painel/produtos');
  await page.getByRole('button', { name: 'Novo produto' }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Nome').fill('Pomada E2E');
  await form.getByLabel('Preço de venda').fill('45,00');
  await form.getByLabel('Estoque mínimo (opcional)').fill('2');
  await form.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Produto salvo.')).toBeVisible();

  // Começa em zero, abaixo do mínimo: aparece para repor.
  const row = page.getByRole('row').filter({ hasText: 'Pomada E2E' });
  await expect(row.getByText('Repor')).toBeVisible();

  await row.getByRole('button', { name: 'Entrada de Pomada E2E' }).click();
  await page.getByRole('dialog').getByLabel('Quantidade').fill('3');
  await page.getByRole('dialog').getByRole('button', { name: 'Registrar entrada' }).click();
  await expect(page.getByText('Entrada registrada.')).toBeVisible();
  await expect(row.getByRole('cell', { name: /^3/ })).toBeVisible();

  // Comanda avulsa: venda de balcão (sem profissional).
  const order = await api<{ id: string }>(page.request, shop, 'post', '/v1/orders', { items: [] });
  await open(page, `/painel/comandas/${order.id}`);
  await page.getByRole('radio', { name: 'Produto' }).click();
  await page.getByLabel('Produto', { exact: true }).click();
  await page.getByRole('option', { name: /Pomada E2E · R\$ 45,00 · 3 em estoque/ }).click();
  await page.getByRole('button', { name: 'Adicionar' }).click();
  await expect(page.getByText('Balcão · R$ 45,00')).toBeVisible();

  await page.getByRole('radio', { name: 'Pix' }).click();
  await page.getByRole('button', { name: 'Fechar e lançar no caixa' }).click();
  await expect(page.getByText('Comanda fechada. Comissões lançadas.')).toBeVisible();

  await open(page, '/painel/produtos');
  await expect(
    page.getByRole('row').filter({ hasText: 'Pomada E2E' }).getByRole('cell', { name: /^2/ }),
  ).toBeVisible();
  // Página recarregada, sem aviso (toast) animando por cima: o axe mede só a tela.
  await expectNoSeriousViolations(page);
});
