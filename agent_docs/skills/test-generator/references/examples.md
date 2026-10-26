# Test Generator Examples

Use these examples to write tests that lock behavior instead of implementation.

## Example 1: Coupon Application

### Input

```ts
export function applyCoupon(totalCents: number, coupon: Coupon | null): number {
  if (totalCents < 0) throw new Error("invalid total");
  if (!coupon) return totalCents;
  if (coupon.expiresAt < Date.now()) return totalCents;
  if (coupon.type === "percent") {
    return Math.max(0, Math.round(totalCents * (1 - coupon.value / 100)));
  }
  return Math.max(0, totalCents - coupon.value);
}
```

### Strong Tests

```ts
describe("applyCoupon", () => {
  const now = 1_700_000_000_000;

  beforeEach(() => {
    vi.setSystemTime(now);
  });

  it("returns the total unchanged when coupon is null", () => {
    expect(applyCoupon(10_00, null)).toBe(10_00);
  });

  it("applies a percent coupon and rounds to cents", () => {
    const coupon = { type: "percent", value: 10, expiresAt: now + 1 };
    expect(applyCoupon(999, coupon)).toBe(899);
  });

  it("applies a fixed coupon without going below zero", () => {
    const coupon = { type: "fixed", value: 50_00, expiresAt: now + 1 };
    expect(applyCoupon(20_00, coupon)).toBe(0);
  });

  it("ignores an expired coupon", () => {
    const coupon = { type: "fixed", value: 100, expiresAt: now - 1 };
    expect(applyCoupon(20_00, coupon)).toBe(20_00);
  });

  it("throws when total is negative", () => {
    expect(() => applyCoupon(-1, null)).toThrow("invalid total");
  });
});
```

### Why This Is Strong

- Tests public behavior.
- Freezes time.
- Covers null, rounding, floor, expiry, and invalid input.
- Avoids mocking internal math.

## Example 2: API Authorization Regression

### Input

Bug: user A could cancel user B's order.

### Strong Test Shape

```ts
it("returns 403 when a user cancels another user's order", async () => {
  const owner = await userFactory();
  const attacker = await userFactory();
  const order = await orderFactory({ userId: owner.id, status: "paid" });

  const response = await request(app)
    .post(`/orders/${order.id}/cancel`)
    .set(authHeader(attacker));

  expect(response.status).toBe(403);
  await expectOrderStatus(order.id, "paid");
});
```

### Why This Is Strong

- Reproduces the security regression.
- Checks both response and persisted state.
- Uses public HTTP behavior.

## Example 3: Gap Reporting

### Strong Summary

```text
Covered: null coupon, percent rounding, fixed coupon floor, expired coupon, and
negative totals.

Not covered: live payment provider behavior; this module only calculates totals
and provider redemption is handled by integration tests.

Ran: npm test -- applyCoupon
```

### Why This Is Strong

- Tells the user what is protected.
- Does not pretend integration behavior was tested.

## Example 4: Bad Mock-Only Test

### Weak Test

```ts
it("calls calculateTotals", () => {
  checkout(cart);
  expect(calculateTotals).toHaveBeenCalled();
});
```

### Better Test

```ts
it("creates an order with the calculated total", () => {
  const order = checkout(cartWithTwoItems);
  expect(order.totalCents).toBe(2599);
});
```

### Why This Is Better

- Refactors can change collaborators without breaking the test.
- The assertion checks user-visible behavior.
