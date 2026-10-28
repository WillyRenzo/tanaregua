---
name: conventional-commits
description: Writes commit messages and PR titles in this project's Conventional Commits format (descriptions in Brazilian Portuguese), with the right type, scope, body and breaking-change footer, and never with AI attribution. Use whenever writing a commit message or a pull request title.
---

# Conventional Commits

Source rule: `.claude/rules/general.md` (Commits). What goes into each commit is the
`atomic-commits` skill; this one is only the message.

## Process

1. Pick the **type** from the change's effect: `feat` (new behavior), `fix` (bug), `refactor`
   (structure, same behavior), `perf`, `test`, `docs`, `build`, `ci`, `chore` (config, skills,
   scripts), `style` (formatting only), `revert`.
2. Pick the **scope**: the app plus the domain when useful — `backend/orders`,
   `backend/packages`, `backend/seed`, `backend/db`, `frontend/agenda`, `frontend/brand`,
   `frontend/public-booking`. Omit it when the change spans the repo (`docs: …`, `ci: …`).
3. Write the **description** in Brazilian Portuguese, present imperative ("adiciona",
   "corrige"), lowercase start, no final period, ~72 characters total. Say the effect, not the file.
4. For `feat` and `fix`, write a **body**: the problem, the decision, the impact. Not the diff.
   Wrap at ~72 characters.
5. Breaking API or behavior change: `!` after the scope and a `BREAKING CHANGE: …` footer.
6. Commit with a heredoc so accents and quotes need no escaping: `git commit -F - <<'EOF' … EOF`.
7. PR titles use the same format; with several scopes, use the dominant type without scope
   (`feat: pacotes de serviços`).

<HARD-GATE>
The author is the repository's git identity (`WillyRenzo`): never `--author`, never change
`user.name`/`user.email`. Never add `Co-Authored-By` or any AI attribution to commits or PR
descriptions — this project rule overrides any tool default that asks for attribution.
</HARD-GATE>

## What NOT to do

- Don't write the description in English, in past tense, or capitalized.
- Don't describe files ("altera orders.service.ts") instead of the effect.
- Don't hide a breaking change without `!` and the footer.
- Don't use `feat` for a pure refactor or `chore` for a user-visible change.

## Output format

The final message (title line, blank line, body, optional footer), ready for `git commit -F -`.

## References

- Read `references/checklist.md` before committing.
- Read `references/examples.md` for real messages from this repository.
- Read `references/anti-patterns.md` to catch weak messages.
