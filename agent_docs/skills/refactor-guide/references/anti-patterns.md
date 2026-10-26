# Refactor Guide Anti-Patterns

Read this before finalizing a refactor.

## 1. Refactor Plus Feature

Bad signs:

- Cleanup also adds new behavior.
- Error handling changes without being requested.
- Public response shape changes during extraction.

Why it hurts:

- Reviewers cannot tell what caused a regression.

Do instead:

- Split behavior changes into separate work.

## 2. Big-Bang Rewrite

Bad signs:

- Large module rewritten from scratch.
- Tests stay red for a long time.
- Many unrelated files change at once.

Why it hurts:

- Review is hard and rollback is risky.

Do instead:

- Use small mechanical steps.
- Keep each step runnable.

## 3. No Safety Net

Bad signs:

- "Looks equivalent" is the only verification.
- Legacy code has no tests and is changed anyway.
- Manual check does not cover edge cases.

Why it hurts:

- Silent regressions ship.

Do instead:

- Run existing tests.
- Add characterization tests for non-trivial behavior.

## 4. Over-Abstraction

Bad signs:

- New interfaces have one implementation and no real complexity behind them.
- Callers must pass more details than before.
- Files multiply but responsibilities remain unclear.

Why it hurts:

- The code is more complex without being more understandable.

Do instead:

- Extract only when it hides real behavior or reduces duplication.

## 5. Taste-Only Rename

Bad signs:

- Names change without being misleading.
- Large diff affects blame and history.
- No behavior or comprehension gain.

Why it hurts:

- Review noise.

Do instead:

- Rename when the current name lies or blocks understanding.

## 6. Hidden Bug Fix

Bad signs:

- Tests are updated to new behavior during refactor.
- Report says behavior unchanged but outputs differ.
- A discovered defect is corrected silently.

Why it hurts:

- Product behavior changes without review.

Do instead:

- Flag the bug separately.
- Keep characterization tests aligned with current behavior.

## 7. Scope Creep

Bad signs:

- A focused extraction turns into cross-codebase cleanup.
- "While here" changes dominate the diff.

Why it hurts:

- The refactor becomes unreviewable.

Do instead:

- Stop when the named smell is fixed.
- Save follow-ups for later.

## 8. Compatibility Shims for Unshipped Code

Bad signs:

- New branch-only code is preserved through adapters and fallbacks.
- The refactor layers around work that has not shipped.

Why it hurts:

- Complexity is kept for no user-facing compatibility reason.

Do instead:

- Replace unshipped in-progress structure directly when safe.
