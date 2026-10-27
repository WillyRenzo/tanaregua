# Engineering Standards

These principles are stack-agnostic. The concrete tool or command that
implements each one for THIS project's stack lives in CLAUDE.md's Commands
section or in `.claude/rules/` — this file explains the "why," not the
"which linter."

Where each principle is implemented in TaNaRegua:

- Type safety → `strict: true` in both `tsconfig.json`; `typecheck` script (`tsc --noEmit`).
- Automated validation → `.claude/settings.json` hook blocks `git commit` on lint/typecheck failure; GitHub Actions runs the full pipeline on every PR.
- Test-driven bug fixes → Vitest (backend unit + e2e against real Postgres), frontend test runner per `.claude/rules/frontend.md`.
- Stack-specific practices → `.claude/rules/backend.md`, `frontend.md`, `database.md`.
- Demo data always current → `backend/src/seed/demo-seed.ts`: every new module ships with examples in the full seed (`seedDemo`) and in the top-up of an existing demo (`completeDemo`), covered by `backend/test/demo-seed.e2e-spec.ts`.

- **Correctness over speed.** Prefer a solution that's verifiably correct
  over one that's merely fast to write.
- **Type safety where the language supports it.** Use the strictest
  practical type-checking configuration for the chosen language.
- **Readability and maintainability are not optional.** Code is read far
  more often than written. Favor clear naming and small, single-purpose
  functions/modules over clever compression.
- **Performance matters only where it's measured to matter.** Don't
  micro-optimize blindly. Apply the performance practices standard for
  this specific language/runtime — these vary significantly by stack, so
  the concrete guidance lives in `.claude/rules/` scoped to the relevant
  paths, not duplicated here as generic advice.
- **Automated validation before every push.** Linting, type-checking, and
  tests should run automatically — not rely on a human or the AI
  remembering to run them manually. See `.claude/hooks/` for how this is
  enforced for real, not just requested in prose.
- **Test-driven bug fixes.** When fixing a bug, first write a failing test
  that reproduces it, then fix the code until the test passes. This
  prevents regressions and documents the bug for future readers.
- **Follow current, real documentation — not memorized patterns.** When
  implementing anything non-trivial with a library or framework, check
  that library's current official docs rather than relying on
  potentially outdated training knowledge; APIs and recommended patterns
  change between versions.
- **Every feature ships with demo data.** A module isn't done until the
  development seed shows it in use, both for a fresh database and for a
  database that already has the demo from an earlier version (the top-up
  adds only what's missing, never duplicates, never overwrites what the
  user customized). Otherwise new features stay invisible in local testing.
- **No unexplained magic.** Anything non-obvious (a workaround, a
  performance trick, an unusual dependency) gets a short comment
  explaining why, not just what.
- **Don't write in prose what a linter can enforce.** Formatting, import
  order, and other deterministic style rules belong in the linter/formatter
  config, not as instructions here. Prose rules are for judgment calls a
  linter can't make (e.g. "prefer composition over inheritance here
  because—").
