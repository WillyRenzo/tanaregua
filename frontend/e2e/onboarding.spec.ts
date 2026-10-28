import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { open } from './fixtures';

test('dono cadastra a barbearia e cai no painel', async ({ page }) => {
  const suffix = randomUUID().slice(0, 8);
  await open(page, '/cadastro');

  await page.getByLabel('Nome da barbearia').fill(`Navalha ${suffix}`);
  // O endereço é sugerido a partir do nome.
  await expect(page.getByLabel('Endereço da página de agendamento')).toHaveValue(`navalha-${suffix}`);
  await page.getByLabel('Seu nome').fill('Carla Dona');
  await page.getByLabel('E-mail').fill(`carla-${suffix}@e2e.test`);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Criar barbearia' }).click();

  await expect(page).toHaveURL(/\/painel$/);
  await expect(page.getByRole('heading', { name: 'Olá, Carla' })).toBeVisible();

  // Recarregar mantém a sessão (refresh pelo cookie httpOnly; nada em localStorage).
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Olá, Carla' })).toBeVisible();
  expect(await page.evaluate(() => Object.keys(localStorage).length)).toBe(0);

  // Barbearia nova nasce no plano padrão (business-rules §12).
  await open(page, '/painel/configuracoes#plano');
  await expect(page.getByText('Sua barbearia está no plano Essencial.')).toBeVisible();
});

test('painel sem sessão redireciona para o login', async ({ page }) => {
  await open(page, '/painel/agenda');
  await expect(page).toHaveURL(/\/entrar\?next=%2Fpainel%2Fagenda/);
});
