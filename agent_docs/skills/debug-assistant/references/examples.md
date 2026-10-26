# Debug Assistant Examples

Use these examples to shape the debugging path and final report.

## Example 1: Undefined User Email

### Input

The user reports:

```text
TypeError: Cannot read properties of undefined (reading 'email')
```

The stack points to `sendOrderConfirmation.ts` after placing an order. It happens only for some production users.

### Weak Path

```text
The fix is probably to use user?.email. I will add optional chaining.
```

### Why This Is Weak

- No reproduction.
- No test.
- Assumes the symptom is the cause.
- May silently skip required notifications.

### Strong Path

1. Reproduce with seed data where an order points to a deleted or merged user record.
2. Add a failing test for the intended contract:
   - skip notification when user is missing, or
   - block orders with missing user, depending on product rules.
3. List hypotheses:
   - order references a soft-deleted user
   - query forgot to include the user relation
   - user is deleted between order creation and notification
4. Inspect the query result and confirm `order.user` is null while `userId` exists.
5. Implement the chosen contract.
6. Run the failing test and related notification tests.

### Strong Report

```text
Reproduced: order confirmation with an order whose user record was soft-deleted
throws in sendOrderConfirmation.

Root cause: notification code assumed order.user is always present, but the
account deletion path can leave historical orders with a userId and no live user
relation.

Fix: sendOrderConfirmation now follows the product contract for missing users
and does not read email until the user relation is validated.

Proof: "handles missing user on order confirmation" failed before the fix and
passes after; notification tests also pass.

Related: shipping notification has the same assumption and should be checked.
```

## Example 2: Flaky Time-Based Test

### Input

CI fails intermittently:

```text
Expected subscription status to be expired
Received active
```

The test passes locally.

### Strong Path

1. Reproduce by running the test repeatedly with the same seed and time zone as CI.
2. Capture failure frequency.
3. Hypotheses:
   - test depends on wall clock at midnight
   - shared fixture mutates subscription state
   - async renewal job races assertion
4. Freeze time or inject a clock in the test.
5. Confirm the test fails before the fix when run near the boundary.
6. Fix the code or test harness depending on where nondeterminism belongs.

### Strong Report

```text
Reproduced: test fails when system time crosses UTC midnight during assertion.
Root cause: expiration code uses Date.now() directly while the test creates
fixtures relative to local time.
Fix: subscription expiration now receives the project clock helper; test freezes
the clock at the boundary.
Proof: repeated test run passed 50/50 after failing under the boundary repro.
```

## Example 3: Cannot Reproduce Yet

### Strong Response

```text
I cannot safely propose a fix yet because the failure did not reproduce with the
given steps. To continue, I need:

- exact command or route
- full error/stack trace
- input payload or fixture id
- environment where it fails
- whether a feature flag or recent deploy changed
```

### Why This Is Strong

- It protects the codebase from guesswork.
- It asks for actionable evidence, not vague "more info."
