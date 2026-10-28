import { expectNoSeriousViolations } from './axe';
import { api, expect, localDate, open, spInstant, test } from './fixtures';

test('agenda por semana e por mês, filtrando por profissional', async ({ page, shop }) => {
  // Segundo profissional, com expediente, para o filtro ter o que separar.
  const caio = await api<{ id: string }>(page.request, shop, 'post', '/v1/staff', {
    name: 'Caio Barbeiro',
    email: `caio-${shop.slug}@e2e.test`,
    password: 'senha-forte-123',
    roleKey: 'professional',
    isProfessional: true,
  });
  const everyDay = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: '09:00', end: '18:00' }));
  await api(page.request, shop, 'put', `/v1/staff/${caio.id}/schedule`, { intervals: everyDay });

  const tomorrow = localDate(1);
  const book = (professionalId: string, clock: string) =>
    api(page.request, shop, 'post', '/v1/appointments', {
      professionalId,
      clientId: shop.clientId,
      serviceIds: [shop.serviceId],
      startsAt: spInstant(tomorrow, clock),
    });
  await book(shop.membershipId, '10:00');
  await book(caio.id, '11:00');

  await open(page, '/painel/agenda');
  await page.getByLabel('Escolher data').fill(tomorrow);

  // Semana: os dois atendimentos, cada um com quem atende.
  await page.getByRole('tab', { name: 'Semana' }).click();
  const day = page.getByRole('region', { name: /ver o dia/ }).filter({ hasText: '10:00 · Bruno Cliente' });
  await expect(day.getByRole('button', { name: /10:00 · Bruno Cliente.*Ana Dona.*Agendado/ })).toBeVisible();
  await expect(day.getByRole('button', { name: /11:00 · Bruno Cliente.*Caio Barbeiro/ })).toBeVisible();
  await expectNoSeriousViolations(page);

  // Filtro: só o Caio.
  await page.getByLabel('Profissional').click();
  await page.getByRole('option', { name: 'Caio Barbeiro' }).click();
  await expect(page.getByRole('button', { name: /11:00 · Bruno Cliente/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /10:00 · Bruno Cliente/ })).toHaveCount(0);

  // Mês: mantém o filtro; o dia leva para a grade do dia, só com a coluna do Caio.
  await page.getByRole('tab', { name: 'Mês' }).click();
  await expect(page.getByRole('button', { name: /11:00 Bruno Cliente/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /10:00 Bruno Cliente/ })).toHaveCount(0);
  await expectNoSeriousViolations(page);

  await page.getByRole('button', { name: /: 1 atendimento$/ }).click();
  await expect(page.getByRole('tab', { name: 'Dia' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('group', { name: 'Agenda de Caio Barbeiro' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Agenda de Ana Dona' })).toHaveCount(0);
});
