import { expectNoSeriousViolations } from './axe';
import { api, expect, open, test } from './fixtures';

test('cria pacote, vende na comanda, usa uma sessão e reembolsa', async ({ page, shop }) => {
  await open(page, '/painel/pacotes');
  await page.getByRole('button', { name: 'Novo pacote' }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Nome').fill('Combo E2E');
  await form.getByLabel('Serviço 1', { exact: true }).click();
  await page.getByRole('option', { name: /Corte Clássico/ }).click();
  await form.getByLabel('Quantidade do serviço 1').fill('4');
  await expect(form.getByText('Avulso sairia R$ 200,00.')).toBeVisible();
  await form.getByLabel('Preço do pacote').fill('180,00');
  await form.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Pacote salvo.')).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Combo E2E' })).toContainText('4× Corte Clássico');

  // Venda: item "Pacote" numa comanda com cliente.
  const sale = await api<{ id: string }>(page.request, shop, 'post', '/v1/orders', {
    clientId: shop.clientId,
    items: [],
  });
  await open(page, `/painel/comandas/${sale.id}`);
  await page.getByRole('radio', { name: 'Pacote' }).click();
  await page.getByLabel('Pacote', { exact: true }).click();
  await page.getByRole('option', { name: /Combo E2E · R\$ 180,00/ }).click();
  await page.getByRole('button', { name: 'Adicionar' }).click();
  await expect(page.getByText('Venda de pacote · R$ 180,00')).toBeVisible();
  await page.getByRole('radio', { name: 'Pix' }).click();
  await page.getByRole('button', { name: 'Fechar e lançar no caixa' }).click();
  await expect(page.getByText('Comanda fechada. Comissões lançadas.')).toBeVisible();

  // Uso: o corte do próximo atendimento sai pelo pacote (R$ 0).
  const usage = await api<{ id: string }>(page.request, shop, 'post', '/v1/orders', {
    clientId: shop.clientId,
    items: [{ serviceId: shop.serviceId, professionalId: shop.membershipId, quantity: 1, discountCents: 0 }],
  });
  await open(page, `/painel/comandas/${usage.id}`);
  await page.getByLabel('Usar pacote em Corte Clássico').click();
  await page.getByRole('option', { name: 'Combo E2E · 4 de 4' }).click();
  await expect(page.getByText('Sessão do pacote aplicada.')).toBeVisible();
  await expect(page.getByText('A receber')).toBeVisible();
  await expect(page.getByText('Sessão de Combo E2E')).toBeVisible();
  await page.getByRole('radio', { name: 'Dinheiro' }).click();
  await page.getByRole('button', { name: 'Fechar e lançar no caixa' }).click();
  await expect(page.getByText('Comanda fechada. Comissões lançadas.')).toBeVisible();

  // Saldo e reembolso em Pacotes → Vendidos.
  await open(page, '/painel/pacotes');
  await page.getByRole('tab', { name: 'Vendidos' }).click();
  const row = page.getByRole('row').filter({ hasText: 'Bruno Cliente' });
  await expect(row).toContainText('Corte Clássico 3/4');
  await expectNoSeriousViolations(page);

  await row.getByRole('button', { name: 'Reembolsar pacote de Bruno Cliente' }).click();
  const refund = page.getByRole('dialog');
  await refund.getByLabel('Valor do reembolso').fill('135,00');
  await refund.getByRole('radio', { name: 'Dinheiro' }).click();
  await refund.getByLabel('Motivo').fill('Cliente mudou de cidade');
  await refund.getByRole('button', { name: 'Reembolsar' }).click();
  await expect(page.getByText('Pacote reembolsado. O valor saiu do caixa de hoje.')).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Bruno Cliente' })).toHaveCount(0);
});
