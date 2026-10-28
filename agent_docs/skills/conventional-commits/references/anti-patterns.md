# Conventional Commits Anti-Patterns

## 1. Vague Description

Bad signs:

- `fix: ajustes`, `feat: melhorias`, `chore: update`.

Why it hurts:

- The history stops explaining anything; reverts and changelogs become guesswork.

Do instead:

- Name the effect: `fix(frontend/painel): corrige total da comanda com desconto`.

## 2. File-Oriented Message

Bad signs:

- `altera orders.service.ts e orders.module.ts`.

Why it hurts:

- The diff already says that; the reader needs the why.

Do instead:

- Describe the behavior change and put the reason in the body.

## 3. Wrong Language or Tense

Bad signs:

- English, past tense ("adicionado"), gerund ("adicionando"), capitalized start, final period.

Why it hurts:

- Breaks the project's consistent, scannable history.

Do instead:

- Brazilian Portuguese, present imperative, lowercase, no period.

## 4. Mismatched Type

Bad signs:

- `feat` for a pure refactor; `chore` for something users see; `fix` for a new feature.

Why it hurts:

- Misleads reviewers and any changelog built from the history.

Do instead:

- Pick the type from the effect on users and the API.

## 5. Hidden Breaking Change

Bad signs:

- API response shape changed with a plain `feat:` or `fix:`.

Why it hurts:

- Consumers break without warning.

Do instead:

- `!` after the scope plus a `BREAKING CHANGE:` footer.

## 6. AI Attribution

Bad signs:

- `Co-Authored-By: …`, "Generated with …" lines, `--author` overrides.

Why it hurts:

- Violates the project's authorship rule.

Do instead:

- Commit as the repository identity, with no attribution lines.
