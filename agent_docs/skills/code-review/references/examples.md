# Code Review Examples

Use these examples to calibrate severity, specificity, and tone.

## Example 1: Order Cancellation Handler

### Input

A PR adds `POST /api/orders/:id/cancel`. The handler:

- loads order by path id
- sets `status = "cancelled"`
- saves the order
- returns `200`
- has no ownership check
- allows cancellation from `shipped`

### Weak Output

```text
Looks good overall. Maybe add some validation and tests. Consider improving the status code.
```

### Why This Is Weak

- Misses the security issue.
- Softens a business-rule break.
- Gives no concrete fix.
- No verdict.

### Strong Output

```text
## Strengths
- Uses the shared Order repository instead of creating a one-off query.
- Follows the existing handler shape, which keeps the route easy to review.

## Blocking
- src/routes/orders.ts:88 — any authenticated user can cancel any order by id.
  Exploit/failure: user A can call the endpoint with user B's order id.
  Fix: load the order within the current user's tenant/ownership scope, or require
  the support/admin permission before mutation; return the same 403/404 pattern
  neighboring order routes use.
- src/routes/orders.ts:91 — shipped and delivered orders can be cancelled.
  This violates the order lifecycle rule and can desync fulfillment.
  Fix: allow cancellation only from pending/paid states and return a conflict
  error for shipped/delivered/cancelled states.

## Should fix
- src/routes/orders.ts:95 — cancellation emits no domain event, unlike other
  order status transitions. Inventory/email projections may not update.
  Fix: emit the existing order-status event after a successful save.

## Consider
- Add regression tests for user A cancelling user B's order and shipped orders.

## Verdict
Not ready — authorization and illegal state transition must be fixed before merge.
```

### Why This Is Strong

- Severity matches risk.
- Each finding explains concrete failure and fix.
- The verdict cannot be misread.

## Example 2: Clean Diff with Test Gap

### Input

A PR extracts a pure `formatCurrency` helper from duplicated UI code. Existing behavior is unchanged. Tests cover USD and EUR but not zero-decimal currencies.

### Strong Output

```text
## Strengths
- The extraction removes duplicated formatting while keeping the public UI output unchanged.
- The helper follows the existing test style and keeps locale-specific behavior in one place.

## Consider
- src/utils/formatCurrency.test.ts: add one zero-decimal currency case, such as JPY,
  because rounding behavior is easy to regress in currency helpers.

## Verdict
Ready to merge — the only note is an optional coverage improvement.
```

### Why This Is Strong

- Does not invent Blocking issues.
- Calls out a real but non-blocking edge case.
- Gives a clear merge verdict.

## Example 3: Style Noise Owned by Tooling

### Input

Diff has mixed quote style, but the repo uses Prettier and CI runs formatting.

### Strong Output

```text
No review finding for quote style. Formatting is already owned by Prettier in this repo, so it should be fixed by the formatter or CI rather than by human review comments.
```

### Why This Is Strong

- Keeps review signal high.
- Avoids wasting reviewer and author attention on automated concerns.

## Review Wording Pattern

Use this structure for findings:

```text
- file:line — issue. Failure: concrete scenario. Fix: smallest project-consistent change.
```

Avoid:

```text
- This seems bad.
- Maybe improve this.
- Could be a security issue.
```

The reviewer should not have to infer impact or next action.
