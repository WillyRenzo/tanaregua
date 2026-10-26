---
name: refactor-guide
description: Use when the user asks to refactor, clean up, simplify, restructure, or improve existing code without adding new functionality. Also use when code has grown hard to follow, has duplication, or a function/file is doing too much and needs to be split.
---

# Refactor Guide

## Process

1. Confirm the scope: refactoring changes structure, not behavior. If the request includes new behavior, split or ask for confirmation.
2. Establish a safety net before changing production code. Run existing tests or add characterization tests for non-trivial untested logic.
3. Name the structural problem: duplication, unclear responsibility, large function, tangled dependencies, shallow module, or misleading names.
4. Refactor in small verifiable steps that leave the code working after each step.
5. Keep the diff inside scope. If a focused refactor grows across many files, pause and confirm.
6. Run relevant tests after the change and report behavior verification.
7. If a bug is discovered, flag it separately instead of silently changing behavior inside the refactor.

<HARD-GATE>
Do not refactor non-trivial behavior without a safety net. If tests do not exist, add characterization tests first or explicitly stop and explain the risk before changing structure.
</HARD-GATE>

## What NOT to do

- Don't refactor and change behavior in the same pass — that conflates two different kinds of risk and makes it hard to isolate what broke if something does.
- Don't do a large-scale rewrite when a series of small, verifiable steps would reach the same result more safely.
- Don't refactor code with no tests and no plan to verify it still works — "it looks equivalent" is not verification.
- Don't over-engineer the result — a refactor should make the code simpler and clearer, not introduce abstraction layers the codebase doesn't need yet.

## Out of scope

If the goal is to fix broken behavior, that's debugging, not refactoring — use debug-assistant instead. If the goal is to add new functionality, that's a feature — use feature-planner first, then implement.

## Output format

The refactored code, plus a short before/after note: what structural problem this addresses, what was verified (tests run, behavior confirmed unchanged), and anything flagged but deliberately left out of scope.

## References

- Read `references/checklist.md` before editing to set scope, safety net, smell, and step plan.
- Read `references/examples.md` when planning a safe extraction or before/after report.
- Read `references/anti-patterns.md` before finalizing to catch behavior changes, big-bang rewrites, and over-abstraction.
