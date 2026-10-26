# PR Writer Anti-Patterns

Read this before finalizing a PR title or description.

## 1. Writing from Memory

Bad signs:

- The title comes from the chat.
- The body describes intended work, not the diff.
- New files or risky changes are missing from the description.

Why it hurts:

- Reviewers trust a PR description that may be false.

Do instead:

- Read the actual diff and commits first.

## 2. File Laundry List

Bad signs:

- "Changed `a.ts`, `b.ts`, and `c.ts`."
- Description repeats the Files changed tab.

Why it hurts:

- It hides purpose and risk behind inventory.

Do instead:

- Describe behavior, system area, and reviewer-relevant risk.

## 3. Fake Test Claims

Bad signs:

- "All tests pass" without running them.
- "Tested locally" with no command or expected result.
- Manual checks are implied but not performed.

Why it hurts:

- Reviewers may merge with false confidence.

Do instead:

- List exact commands run.
- Say "Not run" for missing verification.

## 4. Commit Archaeology

Bad signs:

- Body narrates `wip`, `fix`, `oops`, and `final` commits.
- Reviewers must reconstruct the final state.

Why it hurts:

- WIP history distracts from the net change.

Do instead:

- Summarize the final diff.

## 5. Vague Title

Bad signs:

- "Update code."
- "Fix stuff."
- Branch name as title.
- Scope too broad to be useful.

Why it hurts:

- PR lists become impossible to scan.

Do instead:

- Use an action and scope that describe the delivered change.

## 6. First-Person Diary

Bad signs:

- "I decided to..."
- "I tried..."
- "Then I changed..."

Why it hurts:

- The PR reads like a work log instead of review guidance.

Do instead:

- Write neutral descriptions of the change and rationale.

## 7. Empty Boilerplate Sections

Bad signs:

- `Notes: N/A`
- `Screenshots: none`
- Unused template headings copied without content.

Why it hurts:

- Reviewers learn to skim past the whole body.

Do instead:

- Preserve required template sections.
- Omit optional empty sections when allowed.

## 8. Hiding Risk

Bad signs:

- Migration, auth, or payment behavior is mentioned only indirectly.
- Known unverified paths are omitted.

Why it hurts:

- Reviewers miss where they should focus.

Do instead:

- Put risk in Notes for Reviewers.
- Be direct about what was not tested.
