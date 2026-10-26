# Debug Assistant Checklist

Use this checklist to keep debugging evidence-based. The order matters.

## Reproduce

- [ ] Exact command, route, UI steps, input, or failing test is known.
- [ ] Failure has been triggered locally or in the same environment class.
- [ ] Error text, stack trace, response body, or observed wrong behavior is captured.
- [ ] Versions and runtime are checked when relevant.
- [ ] Environment deltas are noted: `.env`, feature flags, time zone, seed data, browser, OS, dependency version.
- [ ] If reproduction fails, stop and list missing data instead of patching.

## Capture with a Test

- [ ] Project test conventions and runner are identified.
- [ ] A new or existing test fails before the fix.
- [ ] The test name describes behavior, not implementation.
- [ ] Regression input matches the reported failure as closely as practical.
- [ ] If a test is impossible, an equivalent reproducible command or manual check is documented.

## Isolate

- [ ] First application frame in the stack trace is identified.
- [ ] Framework noise is separated from project code.
- [ ] Failure layer is named: validation, domain, persistence, external service, UI state, environment.
- [ ] Inputs at the failing boundary are inspected.
- [ ] Temporary logging or debugger is used only when needed and removed before final.
- [ ] Similar code paths are searched after root cause is known.

## Hypotheses

- [ ] 2-4 plausible causes are listed.
- [ ] Each hypothesis has one falsifying check.
- [ ] Checks are ordered by likelihood and cheapness.
- [ ] Discarded hypotheses are noted briefly.
- [ ] The first plausible idea is not treated as truth without evidence.

## Fix

- [ ] Root cause is addressed.
- [ ] Error handling follows project patterns.
- [ ] The fix is the smallest behavior-correct change.
- [ ] No unrelated refactor is mixed into the bugfix.
- [ ] If behavior requires a product decision, stop and ask.
- [ ] Related call sites are fixed or explicitly flagged.

## Verify

- [ ] Reproducing test now passes.
- [ ] Relevant module/package tests pass.
- [ ] Broader suite or lint is run when risk warrants it.
- [ ] Manual reproduction path no longer fails when applicable.
- [ ] No new logs, debug prints, or temporary probes remain.

## Report

Include:

- Reproduced: exact failing path.
- Root cause: why the bug happened.
- Fix: what changed at the behavior level.
- Proof: tests or commands run.
- Residual risk: anything not verified.

## Stop and Ask When

- Production-only data or logs are required.
- The failure cannot be reproduced with given steps.
- The fix requires choosing product behavior.
- A database operation or environment change would be needed.
- The issue is actually a feature request or refactor rather than a bug.
