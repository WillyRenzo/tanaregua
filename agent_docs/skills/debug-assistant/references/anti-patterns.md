# Debug Assistant Anti-Patterns

Read this before changing production code during a bug investigation.

## 1. Fix Before Reproduce

Bad signs:

- Code changes start from a stack trace alone.
- The fix is described as "probably."
- No command, test, payload, or UI path is known.

Why it hurts:

- The patch may not match the real failure.
- A symptom can be hidden while the root cause remains.

Do instead:

- Reproduce first.
- If reproduction is impossible, ask for exact missing evidence.

## 2. Single-Hypothesis Tunnel

Bad signs:

- The first theory becomes the plan.
- No cheap falsifying check is run.
- Evidence that contradicts the theory is ignored.

Why it hurts:

- Debugging becomes confirmation bias.

Do instead:

- List 2-4 plausible causes.
- Rank by likelihood and cheapness.
- Kill hypotheses quickly with targeted checks.

## 3. Symptom-Only Guards

Bad signs:

- Optional chaining added to stop a crash.
- Broad fallback returns an empty value.
- The code no longer throws, but the bad state still exists.

Why it hurts:

- Data corruption or lost work can continue silently.

Do instead:

- Ask why the value was missing.
- Add a guard only when the guard is the correct contract.

## 4. Swallowing Errors

Bad signs:

- `catch` block ignores the exception.
- Failed assertion is removed.
- Retry loops hide permanent failures.

Why it hurts:

- Operators and users lose the signal needed to fix the system.

Do instead:

- Handle known errors deliberately.
- Let unexpected errors fail in the project's standard way.

## 5. No Regression Test

Bad signs:

- "I tested manually" is the only proof for code with a test suite.
- The exact reported scenario is not locked.
- The new test would have passed before the fix.

Why it hurts:

- The bug can return without warning.

Do instead:

- Make the test fail before the fix.
- Keep the test focused on behavior.

## 6. Debug Logs Left Behind

Bad signs:

- Temporary `console.log`, `print`, or debug traces remain.
- Logs include PII or secrets.
- Logging is added to "prove" the fix instead of using tests.

Why it hurts:

- Production noise and data exposure.

Do instead:

- Remove temporary probes.
- Add permanent logs only when the operational signal is needed.

## 7. Mixing Refactor with Fix

Bad signs:

- The bugfix rewrites unrelated modules.
- Tests fail midway because many moving parts changed.
- Reviewers cannot tell which change fixed the bug.

Why it hurts:

- Regression risk rises and review gets harder.

Do instead:

- Apply the smallest root-cause fix.
- Defer cleanup to a separate refactor after the bug is resolved.

## 8. "Works on My Machine"

Bad signs:

- Local success ends the investigation.
- CI/prod-only environment differences are ignored.
- Flaky failures are treated as not real.

Why it hurts:

- The user's environment still fails.

Do instead:

- Compare env, data, flags, time zone, runtime, dependency versions, and ordering.
