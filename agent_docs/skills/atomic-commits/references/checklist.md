# Atomic Commits Checklist

## Before Staging

- [ ] On a feature/fix/chore/docs branch, not `main`.
- [ ] End-of-line-only changes restored (`scripts/restore-eol-only.sh`).
- [ ] Commit list written down, one logical change each.
- [ ] No `.env`, secrets, builds, Playwright artifacts or ignored generated files in `git status`.

## Must Go Together

- [ ] Code + its tests.
- [ ] Migration + `schema.prisma` + code that uses the new tables.
- [ ] Route/response change + `backend/contracts/openapi.json` + `frontend/src/lib/api/schema.d.ts`.
- [ ] Business rule change + the `agent_docs/` passage that documents it.

## Must Go Separate

- [ ] Refactor vs new behavior.
- [ ] Seed of a module (after the module).
- [ ] Mass formatting; dependency bumps.
- [ ] General docs (README, roadmap), at the end.

## Order

- [ ] infra → domain/backend → seed → UI → e2e → docs.
- [ ] Each commit depends only on earlier ones.

## Per Commit

- [ ] Staged by path; partial files via `hash-object` + `update-index`.
- [ ] `scripts/check-staged.sh <apps>` green (lint, typecheck, unit tests).
- [ ] e2e covered: ran on this commit, or the final state passed and this commit doesn't change that path.
- [ ] Message per the `conventional-commits` skill.

## After

- [ ] `git log --oneline` shows the intended sequence.
- [ ] `git status` clean.
- [ ] No push until the user asks; merge order stated when several branches exist.
