import { randomUUID } from 'node:crypto';
import { expect, open, test } from './fixtures';

/**
 * Sessão do painel e sessão de cliente no mesmo navegador não se sobrescrevem: entrar
 * como cliente na página pública não pode fazer o F5 do painel cair na página da barbearia.
 */
test('entrar como cliente na página pública não derruba a sessão do painel', async ({ page, shop }) => {
  // O fixture já deixou o navegador logado como dono.
  await open(page, '/painel');
  await expect(page).toHaveURL(/\/painel$/);

  await open(page, `/${shop.slug}/meus-agendamentos`);
  const suffix = randomUUID().slice(0, 8);
  await page.getByLabel('Nome').fill('Cliente Mesmo Navegador');
  await page.getByLabel('Celular (WhatsApp)').fill('11955554444');
  await page.getByLabel('E-mail').fill(`mesmo-${suffix}@e2e.test`);
  await page.getByLabel('Crie uma senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Criar conta e continuar' }).click();
  await expect(page.getByText('Nenhum horário ainda')).toBeVisible();

  // F5 no painel: continua no painel, como o dono.
  await open(page, '/painel');
  await page.reload();
  await expect(page.getByText('Ana Dona').first()).toBeVisible();
  await expect(page).toHaveURL(/\/painel$/);

  // E a sessão de cliente continua valendo na página pública.
  await open(page, `/${shop.slug}/meus-agendamentos`);
  await expect(page.getByText('Nenhum horário ainda')).toBeVisible();
});
