import { defineConfig } from 'vitest/config';

/**
 * Cobertura combinada (unitários + e2e) com os gates da AFA 19:
 * ≥ 80% de linhas e ≥ 70% de branches. Usado pelo CI: `npm run test:cov`.
 */
export default defineConfig({
  test: {
    projects: ['./vitest.config.ts', './vitest.config.e2e.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/generated/**',
        'src/**/*.spec.ts',
        // Pontos de entrada de processo: exercitados pelo CI (build/export), não por testes.
        'src/main.ts',
        'src/telemetry.ts',
        'src/openapi.ts',
        'src/seed.ts',
      ],
      reporter: ['text-summary', 'html'],
      thresholds: { lines: 80, branches: 70 },
    },
  },
});
