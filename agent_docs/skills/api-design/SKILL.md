---
name: api-design
description: Designs or reviews API endpoints — REST or otherwise — for consistency, correct use of HTTP semantics, and alignment with this project's existing API conventions. Use when adding a new endpoint, designing an API, or reviewing an API's shape.
---

# API Design

## Process

1. Check this project's existing API dialect first: route naming, versioning, auth pattern, response envelope, error shape, pagination, validation helpers, and testing style.
2. Research current conventions for the API style and framework actually in use when the choice is not obvious. Do not rely on stale REST, GraphQL, gRPC, or framework defaults.
3. Model the contract before implementation: actor, resource, operation, request fields, success response, error responses, authz, idempotency, pagination, and breaking-change risk.
4. Use correct semantics: safe `GET`, creation/action `POST`, full replace `PUT`, partial update `PATCH`, removal `DELETE`; status codes that let clients distinguish malformed input, auth failure, forbidden action, missing resource, validation failure, and conflict.
5. Reuse the project-wide error shape. If none exists, prefer RFC 9457 Problem Details rather than inventing a bespoke envelope.
6. Validate at the boundary and keep untrusted input out of business logic until it has been parsed, normalized, and authorized.
7. For list endpoints, define pagination before shipping. Prefer cursor pagination for large or frequently changing datasets unless the project already standardizes otherwise.
8. For mutating or duplicate-sensitive operations, define who may call it and what a retried identical request does.

<HARD-GATE>
Do not propose or implement a new endpoint until you have identified the existing project conventions for path style, auth, validation, response shape, and errors. If no convention exists, state that explicitly and define one contract for the endpoint instead of mixing ad hoc formats.
</HARD-GATE>

## What NOT to do

- Don't introduce a second response or error dialect when one already exists.
- Don't skip server-side validation because the frontend validates.
- Don't overfit the contract to one screen when the domain resource needs a stable shape.
- Don't return `200` plus `{ success: false }` for failures unless the project is already locked into that contract.
- Don't treat authn as authz; knowing who the user is does not prove they may access the resource.

## Output format

The endpoint design/implementation, plus a short note on the request/response contract (method, path, status codes, error shape) if it's a new endpoint being proposed rather than existing code being reviewed.

## References

- Read `references/checklist.md` when designing or reviewing an endpoint contract.
- Read `references/examples.md` when you need a concrete input -> good output pattern.
- Read `references/anti-patterns.md` before finalizing to catch common API design failures.
