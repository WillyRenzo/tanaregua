# API Design Examples

Use these examples to calibrate output quality. Adapt names, status codes, and envelopes to the project being edited.

## Example 1: Cancel an Order

### Input

The user asks: "Add an endpoint to cancel an order."

The project already uses:

- `/v1` routes
- bearer auth
- RFC 9457 errors
- order ownership checks in adjacent handlers

### Weak Output

```http
POST /cancelOrder
Content-Type: application/json

{ "order_id": "ord_123", "reason": "customer_request" }
```

Returns:

```json
{ "ok": true }
```

Failures return:

```json
{ "error": "nope" }
```

### Why This Is Weak

- Verb in the path instead of a resource.
- Uses `order_id` body field where the project uses path ids.
- No stated authz rule.
- `200` plus loose booleans hides conflicts and validation errors.
- No idempotency or already-cancelled behavior.
- Error shape does not match the project.

### Strong Output

```http
POST /v1/orders/{orderId}/cancellation
Authorization: Bearer <token>
Content-Type: application/json

{ "reason": "customer_request" }
```

Success:

```http
201 Created
Location: /v1/orders/{orderId}/cancellation
Content-Type: application/json
```

```json
{
  "id": "can_123",
  "orderId": "ord_123",
  "reason": "customer_request",
  "createdAt": "2026-07-12T13:00:00Z"
}
```

Errors:

- `401` when unauthenticated.
- `403` when authenticated but not owner/support.
- `404` when the order does not exist in this tenant.
- `409` when the order is already shipped, delivered, or cancelled.
- `422` when `reason` is outside the allowed enum.

Contract note:

```text
Method/path: POST /v1/orders/{orderId}/cancellation
Authz: order owner or support agent with order-cancel permission
Success: 201 + cancellation resource
Errors: project Problem Details envelope
Idempotency: repeat cancellation returns 409 using existing conflict pattern
```

### Why This Is Strong

- Extends the existing route dialect.
- Exposes a domain resource instead of an RPC-shaped verb.
- Separates missing, forbidden, conflict, and validation cases.
- Gives implementers enough contract detail to write tests.

## Example 2: List Audit Events

### Input

The user asks: "Create an endpoint so admins can view audit events."

### Strong Output

```http
GET /v1/audit-events?cursor=opaque_cursor&limit=50&actorId=user_123
Authorization: Bearer <admin-token>
```

Success:

```json
{
  "items": [
    {
      "id": "evt_123",
      "actorId": "user_123",
      "action": "invoice.exported",
      "createdAt": "2026-07-12T13:00:00Z"
    }
  ],
  "nextCursor": "opaque_cursor_2"
}
```

Contract details:

- Admin-only; non-admins receive `403`.
- Cursor pagination is required because audit events are append-heavy.
- Default limit is `50`; maximum is `100`.
- Filters are allowlisted (`actorId`, `action`, `from`, `to`).
- PII-heavy fields are excluded unless already exposed by existing admin audit views.

### Why This Is Strong

- Prevents unbounded audit exports.
- Uses stable sort order and cursor pagination.
- Treats audit data as sensitive even for admin screens.
- Keeps filter fields explicit instead of passing arbitrary query parameters into the database.
