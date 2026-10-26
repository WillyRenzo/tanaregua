# Refactor Guide Examples

Use these examples to keep refactors small, reversible, and behavior-preserving.

## Example 1: Extract Order Processing Steps

### Input

`processOrder()` is 180 lines:

- validate input
- calculate price
- apply tax
- persist order
- send notification

The user asks to make it easier to read. Tests cover pricing and persistence through the public function.

### Weak Approach

- Rewrite the whole function in one pass.
- "Improve" tax rounding while extracting.
- Add email retry behavior.
- Run tests only at the end.

### Why This Is Weak

- Mixes refactor with behavior changes.
- Creates a long red period.
- Makes review and rollback hard.

### Strong Approach

1. Run `npm test -- orders` and record baseline.
2. Extract `validateOrderInput(order)` with identical throws.
3. Extract `calculateOrderTotals(lines)` keeping pricing and tax invariants together.
4. Extract `persistOrder(order, totals)` without changing save order.
5. Extract `notifyOrderCreated(order)` without adding retry behavior.
6. Leave `processOrder` as orchestration.
7. Run `npm test -- orders` after extraction.

### Strong Report

```text
Problem: processOrder mixed validation, pricing, persistence, and notification,
which made the order lifecycle hard to review.

Change: extracted validate/totals/persist/notify helpers and left processOrder
as the sequencing function.

Verified: npm test -- orders passed before and after. Return values, errors, and
side-effect order are unchanged.

Out of scope: tax rounding behavior and email retry policy were not changed.
```

## Example 2: Untested Legacy Logic

### Input

A large pricing helper has no tests. User asks to split it.

### Strong First Step

```text
Before refactoring this helper, I need a characterization test because the
function has non-trivial pricing behavior and no existing coverage. I will lock
current outputs for representative inputs first, then split the function while
keeping those tests green.
```

### Characterization Cases

- empty cart
- one normal line
- discount line
- tax-exempt line
- invalid input currently accepted or rejected
- rounding boundary

### Why This Is Strong

- Preserves current behavior before changing structure.
- Makes legacy quirks visible.

## Example 3: Bug Found During Refactor

### Input

While extracting, you find a branch that incorrectly allows negative totals.

### Strong Response

```text
I found a likely bug: negative totals can pass through the current helper. I am
not fixing it inside this refactor because that would change behavior. I will
leave the refactor behavior-preserving and flag the bug as a separate fix with
its own regression test.
```

### Why This Is Strong

- Keeps review intent clean.
- Avoids hiding behavior change.

## Example 4: Deep Module Improvement

### Weak Result

- Extracts five wrappers that each call one line of the old function.
- Callers now need to know more sequence details.

### Strong Result

- Extracts one `PricingCalculator` or helper with a small input and output.
- Callers ask for totals, not tax/discount/rounding internals.

### Why This Is Strong

- Interface shrinks.
- Behavior is easier to test.
- Complexity moves behind a stable boundary.
