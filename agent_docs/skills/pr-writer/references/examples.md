# PR Writer Examples

Use these examples to draft PR text that helps reviewers.

## Example 1: Billing Feature

### Input

Diff adds prorated refunds for mid-cycle downgrades. Commits include `wip`, `fix typo`, and final test updates. Project uses Conventional Commits and a template with Summary and Test plan.

### Weak Output

```text
Title: Update billing

Updated billing files and fixed some things. Tested locally.
```

### Why This Is Weak

- Title is vague.
- Body does not explain why the change exists.
- Test claim is not actionable.
- WIP history leaks into reviewer context.

### Strong Output

```text
## Title
feat(billing): add prorated refunds for mid-cycle downgrades

## Description
### What & Why
Customers who downgrade mid-cycle were charged for the full period and only
credited at renewal. This adds prorated refunds for unused time on plan
downgrades so support no longer needs to issue manual credits.

The change adds a proration helper and wires it into the existing refund path
for downgrades only. Upgrades and cancel-at-period-end behavior are unchanged.

### How to Test
1. `npm test -- billing/proration billing/refunds`
2. Create a monthly Pro subscription, set the clock to day 15, downgrade to
   Basic, and confirm the refund is approximately half the Pro delta.
3. Confirm upgrades and cancel-at-period-end paths do not issue refunds.

### Notes for Reviewers
Rounding follows the existing billing rule for cents. Annual-plan downgrades are
out of scope for this PR.
```

### Why This Is Strong

- Title describes the net change.
- Body gives the business reason.
- Testing is concrete.
- Reviewer notes focus attention on risk and scope.

## Example 2: Bug Fix

### Input

Diff fixes refresh token expiry handling and adds regression tests.

### Strong Output

```text
## Title
fix(auth): reject expired refresh tokens consistently

## Description
### What & Why
Expired refresh tokens were rejected in the web login path but accepted by the
mobile refresh endpoint because the mobile handler skipped the shared expiry
check. This routes both handlers through the same token validation helper.

### How to Test
1. `npm test -- auth/refresh-token`
2. Manually call the mobile refresh endpoint with an expired token and expect
   the project's unauthorized error response.

### Notes for Reviewers
The response shape intentionally matches the existing web endpoint to avoid a
client-specific error dialect.
```

## Example 3: Clean Refactor

### Input

Diff extracts order total calculation into a helper. Behavior unchanged. Tests pass.

### Strong Output

```text
## Title
refactor(orders): extract order total calculation

## Description
### What & Why
Order total calculation was duplicated between checkout preview and order
creation. This extracts the shared calculation into a single helper so both
paths keep the same rounding and tax behavior.

### How to Test
1. `npm test -- orders`
2. Confirm checkout preview and order creation snapshots are unchanged.
```

### Why This Is Strong

- It states behavior is intended to be unchanged.
- It explains maintainability value without overselling.

## Useful Phrases

- "This changes..."
- "This keeps ... unchanged."
- "Out of scope for this PR..."
- "Reviewers should pay attention to..."
- "Not run: ... because ..."

Avoid:

- "I decided..."
- "Just some cleanup."
- "Tested locally."
- "Various fixes."
