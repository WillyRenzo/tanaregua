import { expect, localDate, open, test } from './fixtures';

test('recepção agenda pelo painel e o sistema impede conflito de horário', async ({ page, shop }) => {
  void shop;
  const tomorrow = localDate(1);
  await open(page, '/painel/agenda');
  await expect(page.getByRole('heading', { name: 'Agenda' })).toBeVisible();

  const book = async (time: string) => {
    await page.getByRole('button', { name: 'Novo agendamento' }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel('Cliente').fill('Bruno');
    await sheet.getByRole('button', { name: /Bruno Cliente/ }).click();
    await sheet.getByRole('checkbox').first().click();
    await sheet.getByLabel('Data').fill(tomorrow);
    await sheet.getByLabel('Horário').fill(time);
    await sheet.getByRole('button', { name: 'Agendar', exact: true }).click();
    return sheet;
  };

  await book('10:00');
  await expect(page.getByText('Agendamento criado.')).toBeVisible();

  // 10:15 cai dentro do corte das 10:00 (30 min): a API recusa com mensagem clara.
  const sheet = await book('10:15');
  await expect(sheet.getByRole('alert')).toContainText('já tem um atendimento às 10:00');
  await page.keyboard.press('Escape');

  // O atendimento aparece na grade do dia seguinte.
  await page.getByRole('button', { name: 'Próximo dia' }).click();
  await expect(
    page.getByRole('button', { name: /10:00–10:30, Bruno Cliente, Corte Clássico, Agendado/ }),
  ).toBeVisible();
});
