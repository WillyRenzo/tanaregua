# TDD Checklist

## Before the First Test

- [ ] Business rule read in `agent_docs/business-rules.md` (or question asked when missing).
- [ ] Layers affected identified: pure rule, API + DB, seed, UI, end-to-end flow.
- [ ] Existing sibling tests and helpers read (`expectTenantIsolation`, Playwright `open()`, `api()`, `Clock.at`).

## What to Cover per Layer

### Pure rule (backend `src/**/x.spec.ts`, frontend `src/**/x.test.ts`)

- [ ] Main calculation or decision.
- [ ] Boundaries: zero, limits, rounding (money in cents, half-cent rule), basis points.
- [ ] Time: barbershop timezone (never the browser's), month/year turnover, DST.

### API + DB (`backend/test/*.e2e-spec.ts`, real Postgres)

- [ ] Happy path with the response shape.
- [ ] Each business error asserted by its Problem Details `code`.
- [ ] 403 for a role without the permission; `:own` vs `:any` scope.
- [ ] IDOR: another resource id in the URL.
- [ ] Tenant isolation with `expectTenantIsolation` (404 for another tenant).
- [ ] Concurrency when the DB guarantees the rule (two parallel requests, one wins).
- [ ] Direct DB write denied when the app role has no grant (append-only tables).

### Seed (`backend/test/demo-seed.e2e-spec.ts`)

- [ ] Full demo shows the new module.
- [ ] Top-up of an existing demo adds it once and never overwrites customization.

### UI and flows

- [ ] Component logic that doesn't need the API (Testing Library).
- [ ] Critical flow in Playwright (`frontend/e2e/`), with `expectNoSeriousViolations`.
- [ ] Mobile project covered when the screen is public or listed in `playwright.config.ts`.

## Cycle

- [ ] Test failed for the right reason before the code existed.
- [ ] Minimum code to pass, then refactor with green tests.
- [ ] Full suites of the touched apps green; lint and typecheck green.
- [ ] API changed → `openapi:export` + `api:generate`; new dynamic page → `npx next build`.
