import { randomUUID } from 'node:crypto';
import { expect, open, test } from './fixtures';

test('cliente agenda online pela página da barbearia', async ({ browser, shop }) => {
  // Navegador "limpo": o cliente não tem a sessão do dono.
  const context = await browser.newContext();
  const page = await context.newPage();

  await open(page, `/${shop.slug}`);
  await expect(page.getByRole('heading', { name: shop.name })).toBeVisible();

  await page.getByRole('checkbox', { name: /Corte Clássico/ }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: /Qualquer profissional/ }).click();

  // Amanhã (o segundo dia da faixa) e o primeiro horário livre.
  await page.getByRole('group', { name: 'Dia' }).getByRole('button').nth(1).click();
  const firstSlot = page
    .getByRole('list', { name: /Horários livres/ })
    .getByRole('button')
    .first();
  await expect(firstSlot).toBeVisible();
  const time = (await firstSlot.textContent())!.trim();
  await firstSlot.click();

  const suffix = randomUUID().slice(0, 8);
  await page.getByLabel('Nome').fill('Diego Online');
  await page.getByLabel('Celular (WhatsApp)').fill('11977776666');
  await page.getByLabel('E-mail').fill(`diego-${suffix}@e2e.test`);
  await page.getByLabel('Crie uma senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Criar conta e continuar' }).click();

  await page.getByRole('button', { name: 'Confirmar agendamento' }).click();
  await expect(page.getByRole('heading', { name: 'Horário marcado!' })).toBeVisible();
  await expect(page.getByText(time)).toBeVisible();

  await page.getByRole('link', { name: 'Ver meus agendamentos' }).click();
  await expect(page.getByRole('heading', { name: 'Meus agendamentos' })).toBeVisible();
  await expect(page.getByText('Corte Clássico · Ana Dona')).toBeVisible();

  await context.close();
});

test('cliente reagenda o próprio horário em "Meus agendamentos"', async ({ browser, shop }) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  // Daqui a 3 dias: dentro do prazo padrão de reagendamento (24 h).
  await open(page, `/${shop.slug}`);
  await page.getByRole('checkbox', { name: /Corte Clássico/ }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: /Qualquer profissional/ }).click();
  await page.getByRole('group', { name: 'Dia' }).getByRole('button').nth(3).click();
  await page
    .getByRole('list', { name: /Horários livres/ })
    .getByRole('button')
    .first()
    .click();

  const suffix = randomUUID().slice(0, 8);
  await page.getByLabel('Nome').fill('Renata Remarca');
  await page.getByLabel('Celular (WhatsApp)').fill('11966665555');
  await page.getByLabel('E-mail').fill(`renata-${suffix}@e2e.test`);
  await page.getByLabel('Crie uma senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Criar conta e continuar' }).click();
  await page.getByRole('button', { name: 'Confirmar agendamento' }).click();
  await expect(page.getByRole('heading', { name: 'Horário marcado!' })).toBeVisible();

  await page.getByRole('link', { name: 'Ver meus agendamentos' }).click();
  await page.getByRole('button', { name: 'Reagendar' }).click();
  const dialog = page.getByRole('dialog', { name: 'Reagendar horário' });
  // Último horário livre do mesmo dia (o primeiro costuma ser o atual).
  const lastSlot = dialog
    .getByRole('list', { name: /Horários livres/ })
    .getByRole('button')
    .last();
  const newTime = (await lastSlot.textContent())!.trim();
  await lastSlot.click();
  await dialog.getByRole('button', { name: 'Confirmar novo horário' }).click();

  await expect(page.getByText(/Horário remarcado/)).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Corte Clássico' }).getByText(newTime),
  ).toBeVisible();

  await context.close();
});
