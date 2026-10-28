import { expectNoSeriousViolations } from './axe';
import { api, expect, open, test } from './fixtures';

test('conecta o WhatsApp, liga o aniversário e envia uma campanha só para quem consentiu', async ({
  page,
  shop,
}) => {
  // Bruno (da fixture) não aceitou mensagens; Carla aceitou por e-mail.
  await api(page.request, shop, 'post', '/v1/clients', {
    name: 'Carla Consentida',
    email: `carla-${Date.now()}@e2e.test`,
    consents: { email: true },
  });

  await open(page, '/painel/campanhas');
  await expect(page.getByRole('tab', { name: 'Aniversariantes' })).toHaveAttribute('aria-selected', 'true');

  // Conexão manual do WhatsApp (o adapter simulado aceita qualquer ID numérico e token).
  await page.getByRole('tab', { name: 'WhatsApp e aniversário' }).click();
  await page.getByLabel('ID do número de telefone').fill('106540352242922');
  await page.getByLabel('ID da conta do WhatsApp Business').fill('102290129340398');
  await page.getByLabel('Token de acesso').fill('EAAG-token-de-teste-com-tamanho-suficiente');
  await page.getByRole('button', { name: 'Conectar' }).click();
  await expect(page.getByText('WhatsApp conectado.')).toBeVisible();
  await expect(page.getByText(/Conectado: \+55 11 90000-2922/)).toBeVisible();

  // Aniversário: liga e escolhe o modelo aprovado, com a prévia das variáveis.
  await page.getByLabel(/Enviar mensagem no aniversário/).click();
  await page.getByLabel('Modelo aprovado do WhatsApp').click();
  await page.getByRole('option', { name: 'feliz_aniversario (pt_BR)' }).click();
  await expect(page.getByText(/Olá, Carlos! A equipe da .+ deseja um feliz aniversário!/)).toBeVisible();
  // Antes de salvar: o toast animando e o botão em hover dão falso positivo de contraste.
  await expectNoSeriousViolations(page);
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Mensagem de aniversário salva.')).toBeVisible();

  // Campanha por e-mail: a prévia separa quem atende ao filtro de quem pode receber.
  await page.getByRole('button', { name: 'Nova campanha' }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Nome da campanha').fill('Sábado estendido');
  await form.getByLabel('Assunto').fill('{nome}, agora abrimos até as 20h');
  await form.getByLabel('Texto').fill('Oi, {nome}! A {barbearia} agora atende até as 20h aos sábados.');
  await form.getByRole('button', { name: 'Ver quem recebe' }).click();
  await expect(form.getByText('1 cliente vai receber por e-mail.')).toBeVisible();
  await expect(form.getByText(/Todos os clientes: 2 clientes/)).toBeVisible();
  await page.mouse.move(0, 0);
  await expectNoSeriousViolations(page);
  await form.getByRole('button', { name: 'Enviar para 1 cliente' }).click();
  await expect(page.getByText('Campanha na fila: 1 mensagem.')).toBeVisible();

  // O detalhe abre com a destinatária; o worker do outbox entrega em segundos.
  const detail = page.getByRole('dialog');
  await expect(detail.getByRole('heading', { name: 'Sábado estendido' })).toBeVisible();
  await expect(detail.getByRole('row').filter({ hasText: 'Carla Consentida' })).toContainText('Enviada', {
    timeout: 20_000,
  });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('row').filter({ hasText: 'Sábado estendido' })).toContainText('1 de 1 enviada');
});
