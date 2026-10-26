# API Design Checklist

Use this checklist when designing, implementing, or reviewing an endpoint. Skip items that truly do not apply, but do not skip the convention check.

## 1. Existing API Dialect

- [ ] Route style checked in neighboring endpoints.
- [ ] Versioning pattern identified (`/v1`, header versioning, none).
- [ ] Auth pattern identified (cookie session, bearer token, API key, internal service auth).
- [ ] Authorization helper or middleware identified.
- [ ] Request validation library or schema pattern identified.
- [ ] Response envelope pattern identified.
- [ ] Error envelope pattern identified.
- [ ] Pagination pattern identified for list endpoints.
- [ ] Test pattern for endpoints identified.

If the project has multiple dialects, prefer the one used by the closest domain area. Do not add a new dialect because it feels cleaner.

## 2. Resource and Path

- [ ] Path uses resources, not verbs, when the project is REST-like.
- [ ] Collection names are consistently plural or match the project standard.
- [ ] Path parameters are stable identifiers, not display names.
- [ ] Nested resources are used only when ownership or containment is real.
- [ ] Non-CRUD actions are modeled as sub-resources or match the project's existing action style.
- [ ] Path does not expose internal implementation names.

Examples:

- Prefer `/orders/{orderId}/cancellation` over `/cancelOrder`.
- Prefer `/users/{userId}/invoices` only when object-level authz is explicit.
- Prefer `/reports/export` only if the project already uses action routes for report jobs.

## 3. Method Semantics

- [ ] `GET` is safe and has no state change.
- [ ] `POST` creates a resource or triggers a non-idempotent action.
- [ ] `PUT` fully replaces a resource and is idempotent.
- [ ] `PATCH` partially updates a resource.
- [ ] `DELETE` removal behavior is defined for repeated calls.
- [ ] Request body is not required for `GET` unless the existing API deliberately supports it.

## 4. Status Codes

- [ ] `200` only when the request succeeded and a body is returned.
- [ ] `201` for created resources, with `Location` when useful.
- [ ] `204` for successful no-body responses.
- [ ] `400` for malformed syntax or unreadable request.
- [ ] `401` for unauthenticated.
- [ ] `403` for authenticated but forbidden.
- [ ] `404` for missing resource or tenant-safe concealment.
- [ ] `409` for conflicts with current state.
- [ ] `422` for semantic validation failures when the request is well-formed.
- [ ] `429` for rate limits.
- [ ] `5xx` only for server faults.

## 5. Error Contract

- [ ] Existing project error shape reused.
- [ ] Error codes are stable and machine-readable when the project uses them.
- [ ] Human messages do not carry logic clients must parse.
- [ ] Field validation errors include field paths in the project's format.
- [ ] Sensitive details are not exposed in `detail`, stack traces, or raw exception messages.

If no project format exists, prefer RFC 9457 Problem Details:

- `type`
- `title`
- `status`
- `detail`
- `instance`
- extension fields such as `errors[]` when needed

## 6. Auth, Validation, and Trust Boundaries

- [ ] Authentication requirement is explicit.
- [ ] Object-level authorization is explicit.
- [ ] Tenant or organization id is included in data filters when applicable.
- [ ] Input is parsed and validated at the boundary.
- [ ] Unknown fields are rejected, stripped, or documented consistently.
- [ ] IDs from path/body are checked for ownership before mutation.
- [ ] Rate-sensitive or abuse-prone actions have a rate-limit story.
- [ ] `agent_docs/security.md` is checked when present.

## 7. Lists and Pagination

- [ ] Endpoint cannot accidentally return unbounded datasets.
- [ ] Page size has a default and maximum.
- [ ] Cursor format is opaque to clients when cursor pagination is used.
- [ ] Sort order is stable.
- [ ] Filters are validated and documented.
- [ ] Empty list shape is consistent with the project.

Cursor pagination is usually safer for hot datasets because inserts between requests can cause offset pagination to skip or duplicate records.

## 8. Idempotency and Retries

- [ ] Duplicate-sensitive `POST` operations define idempotency behavior.
- [ ] Idempotency key header is used if the project already has that pattern.
- [ ] Retried requests produce a documented result.
- [ ] Partial failure behavior is defined for multi-step operations.
- [ ] External calls are not triggered twice on replay unless intended.

## 9. Compatibility

- [ ] Required vs optional fields are deliberate.
- [ ] Removing, renaming, or changing field types is treated as breaking.
- [ ] Adding optional fields is safe for current clients.
- [ ] Error code meanings are not reused.
- [ ] New enum values are considered for older clients.
- [ ] Versioning or migration is planned for breaking changes.

## 10. Final Contract Note

Before handing off, produce a short contract note:

- Method and path
- Request shape
- Success status and response shape
- Error statuses and error shape
- Authz rule
- Pagination/idempotency notes if relevant
- Verification plan
