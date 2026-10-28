---
name: tdd
description: Drives implementation with tests first (red, green, refactor) using this project's test layers - Vitest units, e2e against real Postgres with Testcontainers, and Playwright with axe. Use when implementing a feature, fixing a bug, or changing behavior that tests should lock in.
---

# TDD

Source rules: `CLAUDE.md` (Regras de Trabalho), `agent_docs/engineering-standards.md` and the
per-area conventions in `.claude/rules/`. This skill is the step-by-step cycle.

Shortcuts (run from the repo root; in Git Bash prefix with `MSYS_NO_PATHCONV=1`):
`be` = `docker compose run --rm --no-deps backend`, `fe` = `docker compose run --rm --no-deps frontend`.

## Process

1. Read the business rule involved (`agent_docs/business-rules.md`). If it is missing or
   ambiguous, ask before writing the test: a test locks behavior, and gaps are never filled
   with invented rules.
2. List the cases to cover per layer (`references/checklist.md`) before opening the editor.
3. **Red:** write the test for the next behavior and run only that file
   (`be npx vitest run <path>`, `fe npx vitest run <path>`). It must fail **for the right
   reason** — the behavior assertion, not an import, compile, or environment error. Read the
   output before moving on.
4. **Green:** write the minimum code that makes it pass. Run it again.
5. **Refactor:** with the test green, clean names and duplication. Run it again.
6. Repeat per behavior. At the end, run the full suites of every app you touched
   (`be npm test`, `be npm run test:e2e` when API/DB changed, `fe npm test`, Playwright when a
   screen changed — see `references/examples.md` for the local Playwright routine).
7. Hand over to the `atomic-commits` and `conventional-commits` skills to commit.

<HARD-GATE>
A bug fix starts with a test that reproduces the bug, and its failing output is shown before the
fix. No behavior change is called done until its tests went red, then green, and were run.
</HARD-GATE>

## What NOT to do

- Don't write the implementation first and the tests afterwards "to match".
- Don't loosen an assertion to make it pass. If the expectation itself was wrong (e.g. a date
  that falls on a Saturday), fix the test and say why.
- Don't mock what the database guarantees (constraints, triggers, RLS, grants, concurrency):
  those belong in e2e against real Postgres.
- Don't debug the code when the failure is environmental (`ECONNREFUSED`, mass
  `Internal Server Error`, everything failing in under a second): check containers and logs first.
- Don't change a documented business rule silently: update the doc in the same change and tell the user.

## Output format

Report, per behavior: the test that went red (and why it failed), the change that made it green,
and the final suite results per app (counts, plus coverage when `test:cov` ran). Call out any
layer you could not test and why.

## References

- Read `references/checklist.md` to choose what to test in each layer.
- Read `references/examples.md` for the project's test shapes and the local Playwright routine.
- Read `references/anti-patterns.md` before finishing.
