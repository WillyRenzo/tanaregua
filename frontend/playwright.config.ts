import { defineConfig, devices } from '@playwright/test';

/**
 * Fluxos críticos do MVP (F7) contra a stack real (Next + NestJS + Postgres).
 * Rodar: `docker compose --profile e2e run --rm e2e`.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 60_000,
  // Em `next dev` cada rota compila no primeiro acesso: 5s é pouco.
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // A página pública é mobile-first: o fluxo de reserva roda também no celular.
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /public-booking|accessibility/ },
  ],
});
