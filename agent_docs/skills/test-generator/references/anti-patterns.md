# Test Generator Anti-Patterns

Read this before finalizing tests.

## 1. Mock-Only Tests

Bad signs:

- Assertions only check that internal functions were called.
- Output or visible state is never asserted.
- Refactors break tests even when behavior is unchanged.

Why it hurts:

- Tests become implementation locks and miss real bugs.

Do instead:

- Assert public output, response, persisted state, emitted event, or UI result.

## 2. Happy Path Only

Bad signs:

- Only valid input is tested.
- Validation and failure paths are ignored.
- Boundary values are absent.

Why it hurts:

- Most regressions happen outside the easiest path.

Do instead:

- Add realistic failure, empty, boundary, and regression cases.

## 3. Coverage Padding

Bad signs:

- Constants tested against themselves.
- Getters with no logic get many tests.
- Snapshot tests cover noise but not behavior.

Why it hurts:

- Coverage rises while confidence does not.

Do instead:

- Write fewer tests that can fail for meaningful regressions.

## 4. Private-State Coupling

Bad signs:

- Tests inspect private variables.
- Tests depend on helper call order.
- Renaming internals breaks tests.

Why it hurts:

- Safe refactors become red.

Do instead:

- Test through the public API or user-visible behavior.

## 5. Real Time and Randomness

Bad signs:

- Tests use `Date.now()` without control.
- UUIDs or random values are asserted directly.
- Time zone boundaries are implicit.

Why it hurts:

- CI flakes and local-only passes.

Do instead:

- Freeze clocks, seed randomness, inject ids, and make time zones explicit.

## 6. Over-Integration

Bad signs:

- Pure functions require a database or network.
- One failure produces a long unclear stack.
- Tests are slow enough people stop running them.

Why it hurts:

- Feedback slows and failures are hard to diagnose.

Do instead:

- Unit-test pure cores and integrate at boundaries.

## 7. Unrun Tests

Bad signs:

- Tests are written but not executed.
- Focused markers remain.
- The summary says "should pass."

Why it hurts:

- Broken tests can land.

Do instead:

- Run the command or state exactly why it cannot run.

## 8. Inventing Requirements

Bad signs:

- Tests assert behavior not present in code or product rules.
- Edge-case expectations are guessed.

Why it hurts:

- Tests force a contract no one approved.

Do instead:

- Ask for the product decision or document the gap.
