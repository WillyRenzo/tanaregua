# TDD Anti-Patterns

## 1. Test After the Fact

Bad signs:

- Implementation written first, tests added to match whatever it does.
- No failing output was ever seen.

Why it hurts:

- The test may pass for the wrong reason and lock in the bug.

Do instead:

- Write the test, see it fail on the behavior assertion, then implement.

## 2. Red for the Wrong Reason

Bad signs:

- The "failing test" fails on an import, a typo, a missing container, or a 429.

Why it hurts:

- Green later proves nothing about the behavior.

Do instead:

- Read the failure. Fix setup first, then confirm the failure is the assertion you wrote.

## 3. Bending the Test to Pass

Bad signs:

- `toBeGreaterThanOrEqual` where `toBe` was meant; assertions removed; `skip` added.

Why it hurts:

- Silently changes the rule the test was protecting.

Do instead:

- If the expectation was wrong, fix it and explain why; otherwise fix the code.

## 4. Mocking What the Database Guarantees

Bad signs:

- Unit tests with a mocked Prisma for overlap, balance, RLS, or grants.

Why it hurts:

- Mocks don't run constraints, triggers, RLS, or concurrent transactions.

Do instead:

- e2e against real Postgres (Testcontainers), including parallel requests.

## 5. Chasing the Environment as a Code Bug

Bad signs:

- Editing tests after `ECONNREFUSED`, mass 500s, or everything failing in under a second.

Why it hurts:

- Wastes time and can introduce real regressions.

Do instead:

- Check `docker compose ps` and logs; restart with the routine in `examples.md`.

## 6. Done Without the Full Suite

Bad signs:

- Only the new file was run; other suites of the touched app were not.

Why it hurts:

- Breakage elsewhere reaches CI or the user.

Do instead:

- Run the full suites (and lint/typecheck) of every touched app before handing over.
