# Atomic Commits Anti-Patterns

## 1. The Mega Commit

Bad signs:

- One commit with schema, backend, seed, UI and docs: `feat: pacotes`.

Why it hurts:

- Impossible to review in parts or revert one piece.

Do instead:

- Split by logical change in dependency order (see `examples.md`).

## 2. Commits That Only Work Together

Bad signs:

- Commit 1 calls a function introduced in commit 2; typecheck fails in between.

Why it hurts:

- Breaks `git bisect` and partial reverts.

Do instead:

- Validate each staged commit with `scripts/check-staged.sh`.

## 3. Tests in a Separate "add tests" Commit

Bad signs:

- `feat: …` without tests followed by `test: adiciona testes`.

Why it hurts:

- The feature commit is unverified, and reverting one leaves the other inconsistent.

Do instead:

- Code and its tests in the same commit (`test:` is for test-only changes).

## 4. Contract Drift

Bad signs:

- API change committed without `openapi.json` and `schema.d.ts`, or with them in a later commit.

Why it hurts:

- CI fails on the drift check, and the frontend types lie in between.

Do instead:

- Export the contract, regenerate the client, and commit the three together.

## 5. Blind Staging

Bad signs:

- `git add -A`; `.env`, `playwright-report/` or EOL-only files sneaking in.

Why it hurts:

- Leaks secrets and pollutes the diff.

Do instead:

- Restore EOL-only files, review `git status`, stage by path.

## 6. Mixing Refactor and Behavior

Bad signs:

- Renames and moves in the same commit as a new rule.

Why it hurts:

- Reviewers can't see the behavior change through the noise.

Do instead:

- Refactor commit first (no behavior change, tests still green), then the feature.
