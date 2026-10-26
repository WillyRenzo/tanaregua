---
name: pr-writer
description: Writes pull request titles and descriptions from the actual diff and commit history. Use when the user asks to open a PR, write a PR description, or prepare changes for review.
---

# PR Writer

## Process

1. Read the actual diff and branch commit history. Do not write from chat memory.
2. Check project PR conventions: pull request template, contribution docs, commit/PR title style, linked issue requirements, and required test sections.
3. Write a title that describes the net change and follows the project convention when one exists.
4. Write the body around reviewer needs: what changed, why it matters, how to verify it, and what deserves extra attention.
5. Be honest about verification. List only tests or checks that actually ran; note anything still unverified.
6. If commits are noisy, summarize the final diff instead of narrating WIP history.
7. Keep the body concise enough to review. If it needs a long essay, flag that the PR may be too large.

<HARD-GATE>
Do not draft a PR title or description until the actual diff has been read. Conversation memory, branch name, or commit messages alone are not enough.
</HARD-GATE>

## What NOT to do

- Don't write a PR description before reading the actual diff — a description based on what you remember discussing often misses what actually got written.
- Don't pad the description with a restated checklist of files changed; that's redundant with the diff view itself.
- Don't claim testing was done that wasn't — if tests weren't run, say what verification is still needed instead.
- Don't write in first person as if you personally made the decision ("I decided to...") — write as a neutral description of the change.

## Output format

```
## Title
[title]

## Description
### What & Why
...

### How to Test
...

### Notes for Reviewers
...
```

Omit the Notes section if there's genuinely nothing to flag.

**Example title:** `feat(billing): add prorated refunds for mid-cycle downgrades`

## References

- Read `references/checklist.md` before drafting to gather diff, conventions, risk, and test evidence.
- Read `references/examples.md` when shaping the title, body, and reviewer notes.
- Read `references/anti-patterns.md` before finalizing to remove false claims, file laundry lists, and WIP narration.
