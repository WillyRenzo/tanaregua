# Feature Planner Checklist

Use this before implementing non-trivial features or changes with unclear scope.

## Ambiguity Gate

- [ ] User, actor, or role is clear.
- [ ] Happy path is clear.
- [ ] Failure paths are identified or explicitly unknown.
- [ ] Data to persist or display is clear.
- [ ] Success criteria are observable.
- [ ] Non-goals are known.
- [ ] Product rules are not guessed when asking is cheap.
- [ ] If unclear, ask targeted questions before planning.

## Context Load

- [ ] `agent_docs/business-rules.md` checked when present.
- [ ] `agent_docs/architecture.md` checked when present.
- [ ] Security notes checked when auth, PII, payments, or user input are involved.
- [ ] Existing patterns in nearby files read.
- [ ] Current commands/tests identified.
- [ ] Existing UI/API/data conventions identified.

## Plan Content

- [ ] Goal fits in one or two sentences.
- [ ] Touch points are listed by area, not as a file-by-file essay.
- [ ] Each step is independently verifiable.
- [ ] Tests or manual checks are named.
- [ ] Out of scope is explicit.
- [ ] Open questions are listed only when they block or affect direction.
- [ ] Trade-offs are included only for real decisions.

## Step Quality

A good step looks like:

```text
[change] — verify by [test command, assertion, or manual check]
```

Examples:

- Add CSV serializer for invoice rows — unit test headers, tax fields, empty result, and row limit.
- Add export endpoint using existing billing authz — integration test 200, 403, and 422.
- Add billing page action — manual check authorized user can download and unauthorized user cannot see control.

Bad steps:

- "Build the feature."
- "Wire everything."
- "Test later."

## Trade-Off Filter

Surface trade-offs when they affect:

- Data model or migration path.
- New dependency or third-party service.
- Auth model or permissions.
- Sync vs async workflow.
- Public API contract.
- Performance or scalability limit.

Do not invent trade-offs for small local changes where the existing pattern clearly decides.

## Confirmation Required

Wait for confirmation when:

- Multiple files or layers will change.
- A schema or migration is involved.
- A dependency may be added.
- A business rule is touched.
- Requirements are still ambiguous.
- The plan includes a meaningful trade-off.

Skip or shorten when:

- The change is a typo, copy edit, or one-line obvious fix.
- The user already provided a complete plan and asked to execute.

## Final Self-Review

- [ ] Could another engineer execute the plan without re-asking the goal?
- [ ] Is every step verifiable?
- [ ] Are non-goals clear enough to prevent scope creep?
- [ ] Are project constraints reflected?
- [ ] Is the plan short enough to be useful?
