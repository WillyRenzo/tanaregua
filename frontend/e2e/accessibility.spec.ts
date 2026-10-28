import { expectNoSeriousViolations } from './axe';
import { expect, open, test } from './fixtures';

/** WCAG 2.2 AA automatizado (axe) nas telas principais. */

test('páginas públicas sem violações graves', async ({ browser, shop }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  for (const path of ['/', '/entrar', '/cadastro', `/${shop.slug}`]) {
    await open(page, path);
    await page.waitForLoadState('networkidle');
    await expectNoSeriousViolations(page);
  }
  await context.close();
});

test('painel (agenda, comandas, clientes e configurações) sem violações graves', async ({ page, shop }) => {
  void shop;
  for (const path of [
    '/painel',
    '/painel/agenda',
    '/painel/comandas',
    '/painel/clientes',
    '/painel/configuracoes',
  ]) {
    await open(page, path);
    await page.waitForLoadState('networkidle');
    await expectNoSeriousViolations(page);
  }
});

test('avisos (toasts) coloridos têm contraste AA', async ({ page, shop }) => {
  void shop;
  await open(page, '/painel/configuracoes');
  await page.getByRole('button', { name: 'Salvar' }).first().click();
  const toast = page.locator('[data-sonner-toast][data-type="success"]');
  await expect(toast).toContainText('Configurações salvas.');
  // Espera a animação de entrada: com opacidade parcial, o axe mede outro contraste.
  await expect(toast).toHaveCSS('opacity', '1');
  await page.mouse.move(0, 0);
  await expectNoSeriousViolations(page);
});
