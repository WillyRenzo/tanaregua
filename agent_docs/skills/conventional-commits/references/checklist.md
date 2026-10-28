# Conventional Commits Checklist

## Title

- [ ] Format `<tipo>(<escopo>): <descrição>` (scope omitted only for repo-wide changes).
- [ ] Type matches the effect (`feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`, `chore`, `style`, `revert`).
- [ ] Scope is the app plus the domain when useful (`backend/packages`, `frontend/agenda`).
- [ ] Description in Brazilian Portuguese, present imperative ("adiciona", "corrige").
- [ ] Lowercase start, no final period, ~72 characters total.
- [ ] Describes the effect, not the file.

## Body

- [ ] Present for `feat` and `fix`.
- [ ] Explains the problem, the decision and the impact.
- [ ] Doesn't repeat the diff; lines wrapped at ~72 characters.

## Breaking Change

- [ ] `!` after the scope when the API contract or behavior breaks.
- [ ] `BREAKING CHANGE: …` footer explaining what consumers must do.

## Authorship

- [ ] No `--author`, no identity change.
- [ ] No `Co-Authored-By` or any AI attribution (commit and PR description).
