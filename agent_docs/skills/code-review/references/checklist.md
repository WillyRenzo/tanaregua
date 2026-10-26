# Code Review Checklist

Use this after `SKILL.md` to run a review that is grounded in the actual change and its context.

## Scope and Inputs

- [ ] Review target is clear: PR range, branch diff, uncommitted diff, or named files.
- [ ] Base branch or comparison point is known.
- [ ] Generated files, lockfiles, or vendored files are identified so they do not dominate the review.
- [ ] The user's requested focus is honored.
- [ ] If the scope is too large, call that out and prioritize risky areas.

## Project Context

- [ ] Business rules checked when `agent_docs/business-rules.md` exists.
- [ ] Security notes checked when `agent_docs/security.md` exists.
- [ ] Architecture or engineering standards checked when present.
- [ ] Relevant callers/callees read, not just changed hunks.
- [ ] Neighboring tests and fixtures read for intended behavior.
- [ ] Existing lint/formatter ownership checked before reporting style.

## Correctness

- [ ] Happy path still matches the intended behavior.
- [ ] Null, empty, boundary, duplicate, and invalid inputs are considered where reachable.
- [ ] Error paths use the project's error types, status codes, and message style.
- [ ] Async behavior is awaited or handled correctly.
- [ ] Shared state, cache, and concurrency risks are checked.
- [ ] Retry/idempotency behavior is safe for jobs, webhooks, payments, and external callbacks.

## Contracts and Regressions

- [ ] Public APIs remain compatible unless a breaking change is explicit.
- [ ] Database/schema/event payload changes have migration or rollout implications considered.
- [ ] Auth and permission behavior did not become broader by accident.
- [ ] Existing tests still express the intended behavior.
- [ ] New behavior has enough test coverage for the risk level.
- [ ] Feature flags keep both enabled and disabled paths coherent.

## Security and Data

- [ ] Object-level authorization is checked on touched resource access.
- [ ] User input does not reach SQL, shell, template, HTML, redirect, file path, or outbound request sinks unsafely.
- [ ] Secrets, tokens, PII, and payment data are not logged or returned in errors.
- [ ] Tenant/org filters are present where multi-tenant data is queried.
- [ ] Sensitive actions have appropriate rate limits or abuse controls when relevant.

## Maintainability

- [ ] New abstractions reduce real complexity rather than adding pass-through layers.
- [ ] Names communicate domain behavior instead of implementation trivia.
- [ ] The change follows local patterns for imports, errors, state, tests, and file layout.
- [ ] The diff stays within the requested scope.
- [ ] Duplicated logic is intentional or small enough to leave alone.

## Finding Quality

- [ ] Findings are sorted by severity, not file order.
- [ ] Each finding includes location, failure mode, impact, and concrete fix.
- [ ] Blocking issues are not softened into suggestions.
- [ ] Optional ideas are not mixed with real defects.
- [ ] No finding is created only to prove the review was thorough.
- [ ] Genuine strengths are included when there are any.
- [ ] Verdict is explicit.

## Severity Guide

Blocking:

- Production bug or regression.
- Security vulnerability or data exposure.
- Data loss or corruption.
- Business-rule violation.
- Migration that can break or lose data.

Should fix:

- Real edge case that can fail.
- Missing test for risky new behavior.
- Confusing structure that increases future bug risk.
- Error handling inconsistent with the project.

Consider:

- Small clarity improvement.
- Optional hardening.
- Follow-up test that would be useful but not required.

## Final Review Shape

Before responding, make sure the review can answer:

- What would break?
- Who would be affected?
- How can it be fixed?
- Is it safe to merge?
