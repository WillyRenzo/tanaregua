---
name: code-review
description: Use when the user asks for a code review, wants a diff or PR reviewed before merging, asks "is this code good," "what's wrong with this," or "can you check this before I push." Also use proactively before committing a non-trivial change.
---

# Code Review

## Process

1. Identify the review scope: specific diff, PR range, files, or uncommitted work. If unspecified, use the current diff.
2. Read project rules and context that can change the verdict: business rules, security notes, architecture notes, tests, and neighboring code.
3. Review behavior before style. Look for correctness, regressions, authz/data leaks, broken contracts, missing edge cases, and tests that should exist.
4. Check whether lint/format tools already own style concerns. Do not report machine-owned style noise as review findings.
5. Organize findings by severity:
   - **Blocking** — bug, security issue, data loss, or business-rule break that must not merge.
   - **Should fix** — real defect or maintainability problem that should be addressed soon.
   - **Consider** — optional improvement with clear value.
6. For each finding, include location, failure mode, impact, and the smallest concrete fix.
7. Mention genuine strengths when present and close with an explicit verdict.
8. If no issue is found, say that clearly and name any residual test gap or risk.

<HARD-GATE>
Do not publish findings from the diff alone. At least one relevant caller, callee, schema, test, or project rule must be checked before giving a verdict. If no surrounding context is available, say the review is limited.
</HARD-GATE>

## What NOT to do

- Don't flag formatting, import order, or other style issues a linter/formatter already enforces — check this project's lint config first and skip anything it already covers.
- Don't review code you haven't actually read in context — a diff alone can look fine and still break an invariant defined elsewhere.
- Don't soften blocking issues into suggestions to be polite. If it's a real bug or security hole, say so directly.
- Don't request changes outside the scope of the diff under review.

## Output format

```
## Strengths
- what the change does well, briefly

## Blocking
- [file:line] — issue — fix

## Should fix
- [file:line] — issue — fix

## Consider
- [file:line] — suggestion

## Verdict
Ready to merge | Ready with fixes above | Not ready — [why]
```

If the change is clean, say so and skip the empty sections.

**Example finding:**
```
## Blocking
- src/auth/session.ts:42 — session token compared with `==` instead of a
  constant-time comparison, enabling a timing attack — use a
  constant-time string comparison function instead
```

## References

- Read `references/checklist.md` to run the review without missing scope, correctness, security, and test checks.
- Read `references/examples.md` when calibrating severity and wording for findings.
- Read `references/anti-patterns.md` before finalizing to remove noisy or low-signal review comments.
