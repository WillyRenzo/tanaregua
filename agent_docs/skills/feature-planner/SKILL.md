---
name: feature-planner
description: Use before writing implementation code for any new feature, non-trivial change, or task with unclear scope. Also use when the user says "help me plan," "how should I build this," "let's design this first," or describes an idea that isn't broken into concrete steps yet.
---

# Feature Planner

## Why this comes before coding

Letting an AI session jump straight into implementation is how you get a plausible-looking change that misses the actual point, touches files it shouldn't, or solves a subtly different problem than the one intended. A short planning pass catches this before any code exists to unwind.

## Process

1. Understand the request before planning. Ask targeted questions for unclear actors, scope, success criteria, constraints, and non-goals.
2. Check real project context: business rules, architecture notes, existing patterns, nearby files, commands, and tests.
3. Write a short plan, not a spec. Include goal, likely touch points, small verifiable steps, out of scope, and real open questions.
4. Surface trade-offs only when choices are meaningfully different and costly to reverse, such as schema, dependency, auth model, or workflow changes.
5. Get confirmation before coding when the work is non-trivial: multiple files, new dependency, schema change, business-rule impact, or ambiguous product behavior.
6. After confirmation, implement step by step and verify each step before moving on.

<HARD-GATE>
For non-trivial work, do not write implementation code before the plan is confirmed. If the user already gave an explicit plan and approval, restate the active plan briefly and proceed.
</HARD-GATE>

## What NOT to do

- Don't skip straight to a wall of code for anything with real ambiguity in scope or approach — the cost of a five-minute planning pass is far lower than the cost of a wrong implementation.
- Don't write a plan so detailed it becomes a second implementation effort in prose — keep it to what's needed to confirm direction and sequence.
- Don't silently pick between genuinely different valid approaches without surfacing the choice — that's a decision the user should make, not one to make for them.
- Don't treat this as required ceremony for trivial changes (a one-line fix, a typo, a well-specified small task) — apply it where ambiguity or risk actually exists.

## Output format

```
## Goal
[one or two sentences]

## Approach
1. [step] — [how to verify this step]
2. [step] — [how to verify this step]
...

## Out of scope
- ...

## Open questions / trade-offs (if any)
- ...
```

## References

- Read `references/checklist.md` to decide what the plan must cover and when to ask questions.
- Read `references/examples.md` when shaping a concise, verifiable plan.
- Read `references/anti-patterns.md` before sending the plan to remove vague steps, fake trade-offs, and scope creep.