# Test Generator Checklist

Use this before and after writing tests.

## Before Writing

- [ ] Test framework identified.
- [ ] Test command identified.
- [ ] Existing sibling tests read.
- [ ] Project helpers and factories identified.
- [ ] Assertion style matched.
- [ ] File naming and placement matched.
- [ ] Implementation read beyond the signature.
- [ ] Public interface identified.

## Case Selection

- [ ] Core success path covered.
- [ ] Important failure paths covered.
- [ ] Empty/null/undefined inputs covered where reachable.
- [ ] Boundary values covered.
- [ ] Duplicate or repeated action covered when relevant.
- [ ] Permission/auth denial covered when relevant.
- [ ] Regression scenario covered exactly when fixing a bug.
- [ ] Trivial tests that cannot fail meaningfully are skipped.

## Test Design

- [ ] Test name describes condition and expected behavior.
- [ ] Assertions check visible output, state, response, or side effect.
- [ ] Tests avoid private variables and implementation details.
- [ ] Setup uses project factories/fixtures.
- [ ] Each test is independent.
- [ ] Shared state is reset.
- [ ] Async tests are awaited correctly.
- [ ] Error assertions use the project's idiom.

## Mocks and Fakes

Mock or fake:

- [ ] Network clients.
- [ ] Email/SMS/payment providers.
- [ ] Cloud SDKs.
- [ ] Clock/time.
- [ ] Randomness/UUIDs.
- [ ] Database only when project conventions prefer it.

Prefer real:

- [ ] Pure functions.
- [ ] Validators.
- [ ] Reducers.
- [ ] Price calculators.
- [ ] In-memory repositories already used by the project.

## Nondeterminism

- [ ] Clock is frozen or injected.
- [ ] Random values are seeded or fixed.
- [ ] Generated ids are controlled when asserted.
- [ ] Time zone boundaries are explicit.
- [ ] Tests do not depend on execution order.
- [ ] No real network or live credentials are required for unit tests.

## After Writing

- [ ] New tests run.
- [ ] Relevant existing suite run when risk warrants it.
- [ ] For regressions, test failure before fix is confirmed or explained.
- [ ] No focused-only markers remain.
- [ ] No debug output remains.
- [ ] Summary states covered cases and gaps.

## Gap Reporting

Report gaps honestly when:

- Live integration credentials are required.
- Browser E2E is out of scope.
- Behavior is undefined and needs product decision.
- Environment prevents running the command.
- Database or external service access is not available.
