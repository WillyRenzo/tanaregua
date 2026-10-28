import { expectNoSeriousViolations } from './axe';
import { expect, open, test } from './fixtures';

/**
 * Administração da plataforma (/admin). Usa a conta criada pelo seed de desenvolvimento
 * (`npm run db:seed`): a aplicação não cria administradores.
 */
const ADMIN = { email: 'plataforma@tanaregua.dev', password: 'senha-forte-123' };

test('sem sessão da plataforma, /admin vai para o login dela', async ({ page }) => {
  await open(page, '/admin');
  await expect(page).toHaveURL(/\/admin\/entrar$/);
  await expect(page.getByRole('heading', { name: 'Administração' })).toBeVisible();
});

test('a sessão do painel não abre a administração', async ({ page, shop }) => {
  void shop; // o fixture deixou o navegador logado como dono de uma barbearia
  await open(page, '/admin');
  await expect(page).toHaveURL(/\/admin\/entrar$/);

  await page.getByLabel('E-mail').fill(`ana-${shop.slug.replace('e2e-', '')}@e2e.test`);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('E-mail ou senha inválidos.')).toBeVisible();
});

test('entra, muda o preço de um plano e sai', async ({ page }) => {
  await open(page, '/admin/entrar');
  await page.getByLabel('E-mail').fill(ADMIN.email);
  await page.getByLabel('Senha').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Entrar' }).click();

  await expect(page.getByRole('heading', { name: 'Planos e preços' })).toBeVisible();
  const card = page.getByRole('region', { name: 'Profissional' });
  const monthly = card.getByLabel('Preço mensal');
  const original = await monthly.inputValue();

  try {
    await monthly.fill('149,90');
    await expect(card.getByText(/mais barato que 12 mensalidades|mais caro que 12 mensalidades/)).toBeVisible();
    await card.getByRole('button', { name: 'Salvar preços' }).click();
    await expect(page.getByText('Preços do plano Profissional salvos.')).toBeVisible();

    // Recarregar reconstrói a sessão pelo cookie próprio e mostra o preço salvo.
    await page.reload();
    await expect(card.getByLabel('Preço mensal')).toHaveValue('149,90');
    await page.waitForLoadState('networkidle');
    await expectNoSeriousViolations(page);
  } finally {
    // Devolve o preço do seed: o teste roda contra o banco de desenvolvimento.
    await card.getByLabel('Preço mensal').fill(original);
    await card.getByRole('button', { name: 'Salvar preços' }).click();
    await expect(page.getByText('Preços do plano Profissional salvos.').last()).toBeVisible();
  }

  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page).toHaveURL(/\/admin\/entrar$/);
  await open(page, '/admin');
  await expect(page).toHaveURL(/\/admin\/entrar$/);
});

test('login da administração sem violações graves de acessibilidade', async ({ page }) => {
  await open(page, '/admin/entrar');
  await page.waitForLoadState('networkidle');
  await expectNoSeriousViolations(page);
});
