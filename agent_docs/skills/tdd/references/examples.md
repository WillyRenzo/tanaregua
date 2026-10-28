# TDD Examples

## Example 1: Bug Fix Starting From a Failing Test

Bug: the panel menu stayed brown even with the barbershop's brand colors.

1. Red — `frontend/src/lib/brand.test.ts`:

   ```ts
   it.each(SAMPLES)('cor principal %s: o fundo do menu segue a marca, com texto legível', (color) => {
     const { vars } = brandTheme({ primaryColor: color, secondaryColor: null });
     expect(vars['--sidebar']).toMatch(/^#[0-9a-f]{6}$/);
     expect(contrast(SIDEBAR_FOREGROUND, vars['--sidebar']!)).toBeGreaterThanOrEqual(4.5);
   });
   ```

   Run → fails because `--sidebar` is undefined (the behavior, not a setup error).

2. Green — derive `--sidebar` from the primary color in `brand.ts`. Run → passes.
3. Playwright then found a second real problem (70%-opacity text failing contrast). It became
   another red test before the code changed again.

## Example 2: Wrong Expectation, Not Wrong Code

```ts
// Red: expected the last week of October 2026 to end on 2026-11-07.
expect(monthWeeks('2026-10-15').at(-1)!.at(-1)).toBe('2026-11-07');
```

2026-10-31 is a Saturday, so the week ends on it. The fix is in the test, with a comment, plus
a new case for a month that ends mid-week — never a loosened assertion.

## Example 3: Rule Guaranteed by the Database

"A package balance never goes negative" is enforced by a CHECK and a trigger, so it is tested
in e2e against real Postgres, including concurrency:

```ts
const results = await Promise.allSettled([closeOrder(a), closeOrder(b)]); // both use the last session
expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
```

…and a direct `UPDATE` on the balance with the app role must fail with permission denied.

## Local Playwright Routine

1. `RATE_LIMIT_ENABLED=false docker compose up -d --no-deps --force-recreate backend`
   (`--no-deps` keeps other containers as they are; without the variable the rate limit breaks the run).
2. Windows, after frontend edits: stop `frontend`, delete `frontend/.next`, then
   `docker compose up -d --no-deps frontend`. Wait for `/entrar` to answer 200 and warm the routes with `curl`.
3. `docker compose --profile e2e run --rm --no-deps e2e`.
4. Afterwards: `docker compose up -d --no-deps --force-recreate backend` (default rate limit) and
   delete `frontend/playwright-report` and `frontend/test-results` (they break the lint).

Switched branches and the Prisma schema differs? `be npm run db:generate` before starting the backend.
