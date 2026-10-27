import { expectNoSeriousViolations } from './axe';
import { expect, open, test } from './fixtures';

/** PNG 1×1 válido: a API reprocessa e grava em WebP. */
const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('dono personaliza logo e cores; a página pública mostra a marca e continua acessível', async ({
  browser,
  page,
  shop,
}) => {
  await open(page, '/painel/configuracoes');

  // Amarelo puro não tem contraste no fundo claro: a prévia avisa que a cor foi ajustada.
  await page.getByLabel('Cor principal', { exact: true }).fill('#ffff00');
  await page.getByLabel('Cor secundária', { exact: true }).fill('#1a5d3a');
  await expect(page.getByText(/ajustamos o tom/)).toBeVisible();
  await page.getByRole('button', { name: 'Salvar cores' }).click();
  await expect(page.getByText('Cores salvas.')).toBeVisible();

  await page.getByLabel('Logo', { exact: true }).setInputFiles({
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: Buffer.from(PNG_1PX, 'base64'),
  });
  await expect(page.getByText('Logo atualizado.')).toBeVisible();
  const logo = page.getByRole('img', { name: `Logo da ${shop.name}` }).first();
  await expect(logo).toBeVisible();

  // Visitante (sem sessão) vê a marca na página de agendamento.
  const context = await browser.newContext();
  const visitor = await context.newPage();
  await open(visitor, `/${shop.slug}`);
  await expect(visitor.getByRole('img', { name: `Logo da ${shop.name}` })).toBeVisible();
  const primary = await visitor.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
  );
  expect(primary).toMatch(/^#[0-9a-f]{6}$/);
  expect(primary).not.toBe('#ffff00');

  await visitor.waitForLoadState('networkidle');
  await expectNoSeriousViolations(visitor);
  await context.close();
});
