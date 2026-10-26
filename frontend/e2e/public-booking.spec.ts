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
