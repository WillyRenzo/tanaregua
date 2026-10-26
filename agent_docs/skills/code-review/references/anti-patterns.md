# Code Review Anti-Patterns

Read this before publishing a review. Remove anything that lowers signal or is not grounded in the actual change.

## 1. Diff-Only Review

Bad signs:

- Review comments only mention changed lines.
- No callers, tests, schemas, or docs were checked.
- Verdict says "looks good" without understanding invariants.

Why it hurts:

- Many regressions live outside the hunk.
- A changed line can be correct locally and wrong for the domain.

Do instead:

- Read at least one relevant caller, callee, test, schema, or project rule.
- If context is unavailable, label the review as limited.

## 2. Style as Severity

Bad signs:

- Formatting appears under Blocking or Should fix.
- Import order is reported even though lint handles it.
- Naming taste is treated like a correctness issue.

Why it hurts:

- Authors stop trusting the review.
- Real issues get buried.

Do instead:

- Let tools own style.
- Only mention style if it changes behavior or breaks a local convention not enforced by tools.

## 3. Severity Inflation

Bad signs:

- Theoretical issues are marked Critical or Blocking.
- Defense-in-depth suggestions are mixed with exploitable bugs.
- Every section has comments because empty sections feel uncomfortable.

Why it hurts:

- The team cannot prioritize.
- Real blockers become easier to ignore.

Do instead:

- Blocking only for bugs, security issues, data loss, or business-rule breaks.
- If the change is clean, say clean.

## 4. Vague Findings

Bad signs:

- "This could be better."
- "Add validation."
- "Refactor this."
- "Maybe this is unsafe."

Why it hurts:

- The author does not know what failure to prevent.
- The fix can become larger than the problem.

Do instead:

- State failure scenario, impact, and concrete fix.
- Prefer the smallest fix that fits the existing code.

## 5. Scope Creep

Bad signs:

- Review asks for unrelated refactors.
- Comments request a new architecture during a bugfix PR.
- Existing debt is blamed on the current change.

Why it hurts:

- PRs become unmergeable.
- Authors avoid small improvements because reviews expand them.

Do instead:

- Review only what the diff changes or exposes.
- Mention unrelated debt as a separate follow-up only when useful.

## 6. Softening Real Bugs

Bad signs:

- "Maybe consider checking auth" for an IDOR.
- "Could be an edge case" for data loss.
- Verdict says ready even with Blocking issues.

Why it hurts:

- The team may merge a known bug.

Do instead:

- Be direct and specific.
- Use the verdict to make merge readiness explicit.

## 7. Fixes That Rewrite the World

Bad signs:

- Small handler bug gets a proposal to rebuild the service layer.
- Review suggests new dependencies without checking project patterns.
- Proposed fix requires touching many unrelated files.

Why it hurts:

- The fix becomes harder to review than the bug.

Do instead:

- Offer the smallest project-consistent correction.
- Reserve larger redesigns for a planning discussion.

## 8. Missing Test Honesty

Bad signs:

- Review says "needs tests" without naming which behavior.
- Review ignores the fact that tests cannot run in this environment.
- Verdict claims safety without verification.

Why it hurts:

- Test work becomes vague and unbounded.

Do instead:

- Name the exact behavior to test.
- Separate "not run" from "not needed."
- Tie test gaps to risk.
