# Conventional Commits Checklist

## Title

- [ ] Format `<type>(<scope>): <description>` (scope omitted only for repo-wide changes).
- [ ] Type matches the effect (`feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`, `chore`, `style`, `revert`).
- [ ] Scope is the app plus the domain when useful (`backend/packages`, `frontend/agenda`).
- [ ] Description in English, imperative mood ("add", "fix", "show").
- [ ] Lowercase start, no final period, ~72 characters total.
- [ ] Describes the effect, not the file.

## Body

- [ ] Present for `feat` and `fix`.
- [ ] Explains the problem, the decision and the impact.
- [ ] Doesn't repeat the diff; lines wrapped at ~72 characters.
- [ ] In English, naming domain concepts as the code does (`order`, `package`).

## ASCII Only

- [ ] No accented letters anywhere in the message (title, body, footer).
- [ ] No typographic characters: em dash, curly quotes, `§`, `→`, `…`, `×` (use `-`, `"`, `section`, `->`, `...`, `x`).
- [ ] Quoted UI texts and Portuguese rule terms written without accents.

## Breaking Change

- [ ] `!` after the scope when the API contract or behavior breaks.
- [ ] `BREAKING CHANGE: …` footer explaining what consumers must do.

## Authorship

- [ ] No `--author`, no identity change.
- [ ] No `Co-Authored-By` or any AI attribution (commit and PR description).
