---
name: debug-assistant
description: Use when the user reports a bug, pastes an error message or stack trace, says something works in one environment but not another, asks why something is broken, or a test is failing unexpectedly. Also use for "this used to work" or intermittent/flaky failures.
---

# Debug Assistant

## Process

1. Reproduce first with the exact command, request, input, UI steps, or failing test. If the issue cannot be reproduced, stop and ask for the missing evidence.
2. Capture the bug with a failing test when the project has a test suite. The test should fail for the reported behavior before production code changes.
3. Isolate the failure to the smallest layer or function: input, validation, domain logic, persistence, external integration, UI state, or environment.
4. Generate 2-4 hypotheses, rank them by likelihood and cheapness to falsify, then test the strongest cheap hypothesis first.
5. Fix the root cause, not only the visible symptom. If a guard is the right contract, explain why; otherwise ask why the bad value existed.
6. Run the failing test again, then the relevant broader suite or manual verification.
7. Report reproduction, root cause, fix, proof, and any related call sites that may share the same issue.

<HARD-GATE>
No production fix before reproduction. No final "fixed" claim before the reproducing test or equivalent verification passes. If reproduction is impossible with available information, return the exact missing data instead of guessing.
</HARD-GATE>

## What NOT to do

- Don't propose a fix before reproducing the issue — a plausible-looking fix for an unreproduced bug is a guess, not a fix.
- Don't jump to the first hypothesis that comes to mind and start changing code — form and rank a few candidate causes first, or a quick patch risks masking the real bug instead of fixing it.
- Don't suppress an error (broad try/catch, ignoring a failed assertion) instead of addressing why it happens.
- Don't fix only the reported instance if the same root cause likely affects other call sites — flag those, at minimum.
- Don't skip writing the reproducing test because "it's obviously fixed now" — that confidence is exactly how regressions come back later.

## Out of scope

If the fix requires restructuring working code rather than correcting broken code, that's a refactor, not a bug fix — use refactor-guide instead once the immediate failure is resolved.

## Output format

Report: what was reproduced, root cause, what changed, and the test that proves it. If you couldn't reproduce it, say so explicitly and describe what you'd need (logs, exact input, environment details) to continue.

## References

- Read `references/checklist.md` to drive reproduce -> isolate -> hypothesis -> fix -> prove.
- Read `references/examples.md` when shaping a debugging report or regression test.
- Read `references/anti-patterns.md` when tempted to patch symptoms or guess from the stack trace.
