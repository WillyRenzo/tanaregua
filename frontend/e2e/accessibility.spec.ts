import AxeBuilder from '@axe-core/playwright';
import { expect, open, test } from './fixtures';

/** WCAG 2.2 AA automatizado (axe) nas telas principais. Pega só parte dos problemas. */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function expectNoSeriousViolations(page: import('@playwright/test').Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const serious = results.violations.filter((violation) =>
    ['serious', 'critical'].includes(violation.impact ?? ''),
  );
  expect(
    serious.map(
      (violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
    ),
  ).toEqual([]);
}

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
