# Feature Planner Anti-Patterns

Read this before sending a plan or starting implementation.

## 1. Coding Through Ambiguity

Bad signs:

- The plan assumes product rules not stated by the user.
- Actors and permissions are unclear.
- "Done" cannot be verified.

Why it hurts:

- The implementation can be coherent and still solve the wrong problem.

Do instead:

- Ask targeted questions that change the design.
- State assumptions only when safe and reversible.

## 2. Spec-Sized Plan

Bad signs:

- The plan is longer than the implementation would be.
- It includes full pseudocode for every function.
- It maps every class and field before direction is confirmed.

Why it hurts:

- Planning becomes another form of overbuilding.

Do instead:

- Keep the plan short.
- Focus on sequence, risks, and verification.

## 3. One Giant Step

Bad signs:

- "Implement backend and frontend."
- "Wire all logic."
- "Test everything."

Why it hurts:

- Progress cannot be verified incrementally.
- Debugging happens only at the end.

Do instead:

- Split by behavior boundary.
- Attach a verification to every step.

## 4. Fake Trade-Offs

Bad signs:

- Options are listed when the project convention already decides.
- Trivial local choices are framed as architecture.
- The plan asks the user to choose between non-equivalent levels of detail.

Why it hurts:

- It wastes user attention.

Do instead:

- Surface only decisions that are costly to reverse.
- Pick the project-consistent default for ordinary choices.

## 5. No Out of Scope

Bad signs:

- The plan leaves adjacent improvements implicit.
- A small feature quietly absorbs unrelated cleanup.

Why it hurts:

- Scope expands mid-implementation.

Do instead:

- List non-goals directly.
- Defer follow-ups without bundling them into this pass.

## 6. Ignoring Existing Context

Bad signs:

- Plan proposes patterns absent from the repo.
- Business rules are not mentioned when the feature touches domain behavior.
- Architecture constraints are skipped.

Why it hurts:

- The feature may fight the codebase.

Do instead:

- Read nearby code and project docs first.
- Extend existing patterns unless there is a clear reason not to.

## 7. Confirmation Theater

Bad signs:

- Waiting for approval on a typo.
- Asking the user to confirm an obvious one-line change.

Why it hurts:

- It slows down safe work.

Do instead:

- Use the hard gate for non-trivial work.
- Execute small, obvious changes directly.

## 8. Hidden Implementation Start

Bad signs:

- "Planning" response includes finished code.
- Files are edited before the user accepted a risky plan.

Why it hurts:

- The user loses the chance to correct direction before sunk cost.

Do instead:

- Plan first, wait when required, then code.
