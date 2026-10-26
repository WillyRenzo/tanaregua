import { api, expect, localDate, open, spInstant, test } from './fixtures';

test('fecha a comanda de um atendimento e o valor entra no caixa do dia', async ({ page, shop }) => {
  const appointment = await api<{ id: string }>(page.request, shop, 'post', '/v1/appointments', {
    professionalId: shop.membershipId,
    clientId: shop.clientId,
    serviceIds: [shop.serviceId],
    startsAt: spInstant(localDate(1), '11:00'),
  });
  const order = await api<{ id: string }>(page.request, shop, 'post', '/v1/orders', {
    appointmentId: appointment.id,
  });

  await open(page, `/painel/comandas/${order.id}`);
  await expect(page.getByRole('heading', { name: 'Bruno Cliente' })).toBeVisible();
  await expect(page.getByText('Corte Clássico', { exact: true })).toBeVisible();

  await page.getByRole('radio', { name: 'Pix' }).click();
  await page.getByRole('button', { name: 'Fechar e lançar no caixa' }).click();
  await expect(page.getByText('Comanda fechada. Comissões lançadas.')).toBeVisible();
  await expect(page.getByText('Fechada', { exact: true })).toBeVisible();

  // Imutável: não há mais como editar itens.
  await expect(page.getByRole('button', { name: 'Adicionar' })).toHaveCount(0);

  await open(page, '/painel/caixa');
  await expect(page.getByText('Total líquido')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Bruno Cliente' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'R$ 50,00' })).toBeVisible();
});
