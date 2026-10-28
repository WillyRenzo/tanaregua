---
name: atomic-commits
description: Splits work into atomic commits - one logical change per commit, each one passing lint, typecheck and tests on its own - grouping and ordering files, staging partial files, and validating what is staged in isolation. Use when preparing commits, especially after accumulating a large change.
---

# Atomic Commits

Source rule: `.claude/rules/general.md` (Commits). Each commit's message follows the
`conventional-commits` skill.

A commit is **one** logical change that can be reverted alone and leaves the repo working:
lint, typecheck and tests pass **on it**, not only on the last commit of the series. The
pre-commit hook (`.claude/hooks/pre-commit-check.sh`) blocks lint/typecheck failures; tests
are on you.

## Process

1. Work on a branch (`feat/`, `fix/`, `chore/`, `docs/`), never on `main`.
2. Drop end-of-line-only changes (Prettier on Windows):
   `bash agent_docs/skills/atomic-commits/scripts/restore-eol-only.sh`.
3. Run `git status` and `git diff --stat`, then **write down the commit list** before any `git add`.
   If a description needs "and" to join unrelated things, it is two commits.
4. Group and order them with `references/checklist.md`: what must go together, what must be
   separate, and the dependency order (infra → domain/backend → seed → UI → e2e → docs).
5. Stage by path (`git add <paths>`). For a file split across two commits, stage a partial
   version without touching the working tree:
   `git hash-object -w <partial-file>` then `git update-index --cacheinfo 100644,<hash>,<path>`.
6. Validate the staged change in isolation:
   `bash agent_docs/skills/atomic-commits/scripts/check-staged.sh backend` (or `frontend`, or both).
   It stashes everything unstaged (including untracked files), runs lint, typecheck and unit
   tests, and restores the stash.
7. Commit with the `conventional-commits` skill, then go back to step 5 for the next group.
8. Finish with `git log --oneline` and a clean `git status`.

<HARD-GATE>
Never `git add -A`/`git add .` blindly, never commit `.env`, secrets, builds or ignored generated
files, and never push without the user asking. Every commit must pass on its own — a series that
only works at the last commit is not atomic.
</HARD-GATE>

## What NOT to do

- Don't split code from its tests, a migration from the schema and code using it, or the API
  change from `contracts/openapi.json` + `frontend/src/lib/api/schema.d.ts`.
- Don't mix a refactor with new behavior, or mass formatting / dependency bumps with anything else.
- Don't commit the seed of a module before the module.
- Don't resolve a `stash pop` conflict by discarding work: recover each file with
  `git checkout stash@{0} -- <path>`, then `git stash drop`.

## Output format

The commit list in order (hash and title), what was validated for each, and the final
`git status`. When several branches are involved, say the merge order — check conflicts with
`git merge-tree --write-tree <a> <b>`.

## References

- Read `references/checklist.md` to group, order and validate.
- Read `references/examples.md` for a real split from this repository.
- Read `references/anti-patterns.md` before committing.
