# Security Audit Examples

Use these examples to write concrete exploit-path findings.

## Example 1: IDOR in Invoice Route

### Input

FastAPI route:

```python
@router.get("/users/{user_id}/invoices")
def list_invoices(user_id: int, user=Depends(current_user), db=Depends(get_db)):
    return db.query(Invoice).filter(Invoice.user_id == user_id).all()
```

Auth dependency ensures the caller is logged in.

### Weak Output

```text
Potential authentication issue. Add security.
```

### Why This Is Weak

- Authentication exists.
- The issue is authorization.
- No exploit path or fix is provided.

### Strong Output

```text
## Critical (exploitable now)
- app/routers/invoices.py:42 — IDOR: any authenticated user can read another
  user's invoices by changing the path id. Exploit: login as user A, request
  GET /users/{userB}/invoices, and receive user B's invoices. Fix: for normal
  users, ignore path user_id and filter by current_user.id; for admins, require
  an explicit admin permission. Add a regression test that user A cannot read
  user B's invoices.
```

### Why This Is Strong

- Names the actual bug.
- Distinguishes authn from authz.
- Gives a testable fix.

## Example 2: Raw SQL Injection

### Input

```ts
const rows = await db.$queryRawUnsafe(
  `SELECT * FROM users WHERE email = '${req.query.email}'`
);
```

### Strong Output

```text
## Critical (exploitable now)
- src/routes/users.ts:31 — SQL injection through email query parameter.
  Exploit: attacker sends email=' OR 1=1 -- and the raw SQL string changes the
  WHERE clause. Fix: use the project's parameterized query helper or Prisma
  tagged query form, and validate email before querying.
```

### Why This Is Strong

- Names the sink.
- Shows how attacker input reaches it.
- Recommends a stack-specific safe API.

## Example 3: Defense in Depth, Not Critical

### Input

Admin-only export endpoint has correct authz and tenant scoping but no rate limit.

### Strong Output

```text
## Defense in depth (optional hardening)
- src/routes/admin/exports.ts:74 — large exports are correctly admin-only and
  tenant-scoped, but adding a per-admin rate limit would reduce accidental or
  compromised-account bulk extraction. This is hardening, not an active authz
  bypass.
```

### Why This Is Strong

- Does not inflate severity.
- Explains current mitigations.
- Keeps prioritization honest.

## Example 4: False Positive Avoidance

### Input

ORM code:

```ts
await db.user.findMany({ where: { email: req.query.email } });
```

### Strong Non-Finding

```text
No SQL injection finding here: this path uses the ORM's structured filter API,
not string-built SQL. Validation may still be useful for contract clarity, but
the shown code is not an injection sink by itself.
```

### Why This Is Strong

- Avoids security theater.
- Preserves trust in real findings.
