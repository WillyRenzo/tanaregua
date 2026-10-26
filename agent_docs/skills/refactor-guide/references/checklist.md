# Refactor Guide Checklist

Use this before and during a refactor.

## Scope

- [ ] User goal is structure-only.
- [ ] Any behavior change is separated or confirmed.
- [ ] Target files/modules are named.
- [ ] Out-of-scope cleanup is explicit.
- [ ] The refactor has a reason beyond taste.

## Safety Net

- [ ] Existing tests for the target area are found.
- [ ] Baseline tests pass before editing.
- [ ] If tests are missing, characterization tests are added for non-trivial logic.
- [ ] Manual verification path is known when automated tests are not available.
- [ ] Current behavior, including quirks, is preserved unless separately approved.

## Name the Smell

- [ ] Duplication.
- [ ] Function or file doing too much.
- [ ] Unclear responsibility.
- [ ] Tangled dependency direction.
- [ ] Shallow module with wide interface and little behavior.
- [ ] Misleading names.
- [ ] Dead code after call sites are gone.

Write one sentence:

```text
This is better because [specific maintenance problem is reduced].
```

## Step Plan

- [ ] Mechanical rename when names mislead.
- [ ] Extract pure helper before moving IO-heavy code.
- [ ] Move code without changing behavior.
- [ ] Collapse duplication behind a smaller interface.
- [ ] Delete dead code only after references are gone.
- [ ] Run tests after meaningful steps.

## Deep Module Check

Prefer:

- small stable interface
- real behavior hidden behind it
- fewer call-site decisions
- clearer dependency direction

Avoid:

- pass-through wrappers
- many tiny files with no responsibility
- abstractions named after implementation details
- making the interface bigger without reducing complexity

## Diff Budget

Pause when:

- A small refactor touches many unrelated files.
- The change requires new behavior to justify itself.
- Tests fail for reasons not explained by the refactor.
- You discover a bug that should be fixed separately.

## Verification

- [ ] Targeted tests pass.
- [ ] Broader tests run when shared behavior changed.
- [ ] Public output, errors, and side effects remain unchanged.
- [ ] Imports and file moves follow project style.
- [ ] No temporary compatibility shim remains unless intentional.

## Final Note

Report:

- Structural problem.
- What changed structurally.
- Behavior verification.
- Anything discovered but left out of scope.
