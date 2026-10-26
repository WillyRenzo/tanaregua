# Doc Writer Anti-Patterns

Read this before finalizing documentation.

## 1. Documenting Without Reading

Bad signs:

- Docs are based on function names only.
- Claims reflect intended behavior, not current behavior.
- Existing docs and code conflict.

Why it hurts:

- Callers build on false contracts.

Do instead:

- Read implementation, call sites, and tests.
- If behavior is wrong, flag it instead of documenting a wish.

## 2. Narrating the Code

Bad signs:

- "Loops through items."
- "Sets variable to true."
- "Calls helper function."

Why it hurts:

- The doc goes stale on harmless refactors.
- It adds noise without helping callers.

Do instead:

- Document guarantees, inputs, outputs, side effects, and errors.

## 3. Obvious Inline Comments

Bad signs:

- `// increment counter` above `counter++`.
- `// return user` above `return user`.
- Comments explain syntax rather than intent.

Why it hurts:

- Maintainers stop reading comments.

Do instead:

- Delete the comment or improve names.
- Keep comments for why, not what.

## 4. Duplicate Source of Truth

Bad signs:

- README repeats full schema fields.
- Markdown lists env vars that already live in `.env.example`.
- API docs duplicate generated OpenAPI without a reason.

Why it hurts:

- One source changes and the other lies.

Do instead:

- Link to schema, generated docs, or config examples.
- Add human context around the source of truth.

## 5. README with No Run Path

Bad signs:

- Badges and philosophy come before setup.
- Install/test commands are missing.
- Configuration instructions include real secrets.

Why it hurts:

- Onboarding fails even if the architecture explanation is accurate.

Do instead:

- Put install, configure, run, and test near the top.
- Use secret names, not secret values.

## 6. Over-Documenting Private Helpers

Bad signs:

- Every local helper has a large docblock.
- Docs repeat TypeScript/Python types.
- Comments explain implementation churn.

Why it hurts:

- Noise grows faster than useful documentation.

Do instead:

- Document exported contracts.
- Use comments only for non-obvious local reasons.

## 7. Stale TODO Comments

Bad signs:

- `TODO: fix later` with no owner, issue, or condition.
- TODO describes work unrelated to the current code.

Why it hurts:

- It becomes permanent clutter.

Do instead:

- Link to a tracked issue or remove the TODO.
- Use a precise condition: what should change and why.

## 8. Explaining Bugs as Intended Behavior

Bad signs:

- Docs normalize surprising behavior found during reading.
- A doc update hides a likely defect.

Why it hurts:

- Bugs become contracts accidentally.

Do instead:

- Ask or flag the behavior mismatch.
- Only document quirks as intentional when confirmed by code/tests/business rules.
