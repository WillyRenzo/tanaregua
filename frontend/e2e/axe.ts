import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/** WCAG 2.2 AA automatizado (axe). Pega só parte dos problemas. */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

export async function expectNoSeriousViolations(page: Page) {
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
