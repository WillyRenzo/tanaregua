import { expectNoSeriousViolations } from './axe';
import { open, test } from './fixtures';

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

test('painel (agenda e comandas) sem violações graves', async ({ page, shop }) => {
  void shop;
  for (const path of ['/painel', '/painel/agenda', '/painel/comandas', '/painel/clientes']) {
    await open(page, path);
    await page.waitForLoadState('networkidle');
    await expectNoSeriousViolations(page);
  }
});
