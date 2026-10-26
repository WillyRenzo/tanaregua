# Feature Planner Examples

Use these examples to keep plans short, concrete, and verifiable.

## Example 1: Invoice CSV Export

### Input

The user says: "Let users export their invoices as CSV from the billing page."

### Questions to Ask if Unknown

- Which date range: all invoices or a bounded range?
- Which roles can export?
- Include tax columns?
- Is sync download enough, or should large exports be async?
- What should happen above the row limit?

Assume answers:

- last 12 months
- org admins only
- include tax
- sync download is fine up to 10k rows
- over 10k rows returns a clear error

### Strong Plan

```text
## Goal
Org admins can download a CSV of their organization's invoices for the last
12 months, including tax columns. Requests over 10k rows return a clear error
instead of a partial file.

## Approach
1. Add invoice export query and CSV serializer — verify with unit tests for
   headers, tax fields, empty result, and 10,001-row guard.
2. Add authenticated export endpoint using existing billing authz — verify 200
   file response, 403 for non-admins, and 422 for row-limit overflow.
3. Add billing page Export CSV action gated by the same permission — verify
   authorized user downloads and unauthorized user does not see the control.
4. Check whether exports require audit logging per security/business docs —
   verify the audit event if required.

## Out of scope
- Async/email export.
- PDF export.
- Cross-org admin export.
- Changing invoice tax calculation.

## Open questions / trade-offs
- GET vs POST: project already uses POST for report exports, so recommend POST
  to match existing report behavior.
```

### Why This Is Strong

- Defines observable done.
- Keeps steps independently testable.
- Names auth, limits, and non-goals.
- Surfaces only a real trade-off.

## Example 2: Too Vague to Plan Fully

### Input

The user says: "Add a better onboarding."

### Strong Response

```text
Before planning, I need to pin down the behavior:

- Which users see onboarding: all new users, invited team members, or only admins?
- What is the success state: profile complete, first project created, first invite sent?
- Should progress persist if the user leaves and returns?
- Is this UI-only, or does the backend need onboarding state?
- What is out of scope for the first pass?
```

### Why This Is Strong

- Does not invent product requirements.
- Asks questions that materially affect design and implementation.

## Example 3: Small Change That Should Skip Ceremony

### Input

The user says: "Rename the button label from Save to Save changes."

### Strong Response

```text
This is a small, local copy change. I will update the label and run the relevant
check if the project has one.
```

### Why This Is Strong

- Avoids planning theater.
- Keeps momentum for trivial work.

## Example 4: Real Trade-Off

### Input

Feature requires sending large exports.

### Strong Trade-Off Note

```text
Sync download is simpler and fits small exports, but can time out and tie up a
request for large accounts. Async export adds queue/storage complexity but gives
reliable delivery and retry. Since the first pass has a 10k row cap and existing
report endpoints are sync, recommend sync now and keep async out of scope.
```

### Why This Is Strong

- Names cost and benefit.
- Chooses based on project context.
- Avoids turning a small feature into a platform rewrite.
