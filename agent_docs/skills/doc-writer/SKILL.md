---
name: doc-writer
description: Writes and updates code documentation — docstrings, README sections, and inline comments for non-obvious logic. Use when the user asks to document a function, update a README, add comments, or explain code for other developers.
---

# Doc Writer

## Process

1. Identify the documentation target: public API/docstring, README/setup docs, developer guide, or inline comment. Each has a different job.
2. Read the current implementation and relevant call sites before writing. Document observed behavior, not intended behavior from memory.
3. For docstrings, document the caller contract: purpose, inputs, outputs, preconditions, side effects, errors, and non-obvious null/empty behavior. Follow the language and project convention.
4. For READMEs, prioritize what a new maintainer needs first: what it is, prerequisites, install, configuration, run, test, and links to deeper docs.
5. For inline comments, explain only the why: domain rule, workaround, ordering requirement, security/performance constraint, or surprising invariant.
6. Prefer updating the existing source of truth over creating duplicate documentation that can drift.
7. Keep docs as short as they can be while still preventing misuse.

<HARD-GATE>
Do not document code you have not read. If the implementation and docs disagree, update the docs to match reality or flag the behavior mismatch; do not write aspirational documentation as if it were true.
</HARD-GATE>

## What NOT to do

- Don't write a comment that just restates the code in English (`// increment counter` above `counter++`) — this adds noise without adding information.
- Don't document implementation details likely to change soon inside a docstring meant for external consumers — that belongs in an inline comment or not at all.
- Don't write documentation that will silently go stale — prefer linking to the single source of truth (e.g. a schema file) over duplicating details that could drift out of sync.
- Don't pad a README with sections no one will read (elaborate badges, verbose philosophy) at the expense of the setup instructions someone actually needs.

## Output format

The documentation itself, written directly into the target file/location — not a summary of what documentation should say.

## References

- Read `references/checklist.md` to choose the right documentation shape and completeness level.
- Read `references/examples.md` when writing contract-focused docstrings or useful inline comments.
- Read `references/anti-patterns.md` before finalizing to remove stale, obvious, or duplicated docs.
