---
name: test-generator
description: Writes tests for existing code, covering realistic edge cases and following this project's testing conventions. Use when the user asks to add tests, improve test coverage, or write tests for a specific function or file.
---

# Test Generator

## Process

1. Check project test conventions, commands, helpers, file layout, and assertion style before writing tests.
2. Read the implementation and nearby tests closely enough to understand behavior, contracts, edge cases, and failure paths.
3. Test through the public interface when possible. Avoid coupling tests to private implementation details.
4. Cover in priority order: core behavior, realistic edge/failure cases, and exact regression cases for bug fixes.
5. Prefer real behavior over mocks. Mock external services, time, randomness, network, and slow/flaky boundaries, not cheap internal logic.
6. Control nondeterminism: freeze clocks, seed randomness, fix UUIDs, isolate shared state, and clean up fixtures.
7. Name tests as behavior specs so CI failures are understandable.
8. Run the tests and report what passed. For regressions, prove or explain that the test fails before the fix.

<HARD-GATE>
Do not hand off tests that were not run unless the environment makes running impossible. If tests cannot be run, say exactly why and what command should be run next.
</HARD-GATE>

## What NOT to do

- Don't write tests that only assert a function was called (mock-checking) when testing the actual output is possible and more meaningful.
- Don't pad coverage with trivial tests (e.g. testing that a constant equals itself) — coverage percentage isn't the goal, catching real breakage is. A large number of low-value tests ("test explosion") slows down the whole suite without improving defect detection — fewer, well-targeted tests beat many shallow ones.
- Don't skip the failure/edge cases because the happy path is what's easy to write.
- Don't leave tests you wrote unrun — always execute them before considering the task done.

## Output format

The test file itself, plus a short summary: what's covered, what edge cases were included, and any gap you couldn't cover with a note on why (e.g. requires a live integration you don't have access to).

## References

- Read `references/checklist.md` before writing tests to select cases, boundaries, mocks, and verification.
- Read `references/examples.md` when shaping behavior-focused tests.
- Read `references/anti-patterns.md` before finalizing to remove brittle, shallow, or unrun tests.
