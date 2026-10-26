# API Design Anti-Patterns

Read this before finalizing an API design or review. These are common ways an endpoint looks acceptable but creates a long-term contract problem.

## 1. Creating a Second API Dialect

Bad signs:

- One endpoint returns `{ ok, data }` while neighbors return raw resources.
- One endpoint uses Problem Details while neighbors use project error codes.
- New routes use `/createThing` while existing routes use resources.
- Auth is passed in a new header without a project reason.

Why it hurts:

- Clients need endpoint-specific parsing.
- Observability and SDKs become inconsistent.
- Reviewers cannot infer the next endpoint's shape.

Do instead:

- Extend the closest existing convention.
- If the convention is weak but shipped, improve deliberately across a planned boundary, not one random endpoint.

## 2. Treating Frontend Validation as Enough

Bad signs:

- Handler accepts raw request bodies.
- UI enum choices are trusted server-side.
- Limits exist in form code only.

Why it hurts:

- Attackers do not use the UI.
- Mobile or older clients may send stale shapes.
- Business logic receives invalid data and fails later in harder-to-debug ways.

Do instead:

- Parse and validate at the API boundary.
- Normalize before authorization and mutation.
- Return the project's validation error shape.

## 3. `200` for Everything

Bad signs:

- Failed requests return `200 { "success": false }`.
- Conflicts, validation errors, and missing resources all look the same.
- Clients must parse English messages to know what happened.

Why it hurts:

- Caches, retries, metrics, and SDKs cannot reason about outcomes.
- Client code grows fragile conditionals.

Do instead:

- Use status codes for the class of outcome.
- Use stable machine-readable error codes or Problem Details types.

## 4. Missing Object-Level Authorization

Bad signs:

- Route has `currentUser`, but database query filters only by path id.
- Admin and normal-user paths share a handler with no role branch.
- Tenant id is read from the body instead of trusted context.

Why it hurts:

- IDOR and tenant data leaks are among the most common API failures.

Do instead:

- Filter by both resource id and allowed owner/tenant scope.
- Return `403` or tenant-safe `404` consistently with the project.

## 5. Unbounded Lists

Bad signs:

- `GET /items` returns all rows.
- `limit` has no maximum.
- Sort order is unspecified.
- Offset pagination is used on hot append-heavy feeds without reason.

Why it hurts:

- Production data growth turns a harmless endpoint into a slow or expensive one.
- Offset pagination can skip or duplicate rows under writes.

Do instead:

- Require pagination, stable sorting, and maximum limits.
- Prefer cursors for large or changing datasets.

## 6. Overfitting to One Screen

Bad signs:

- Endpoint name mirrors a component name.
- Response fields are arranged only for one table view.
- Domain concepts are flattened into UI labels.

Why it hurts:

- The next consumer either gets an awkward contract or creates another endpoint.

Do instead:

- Model the domain resource.
- Let UI-specific presentation stay in the frontend unless the API is explicitly a BFF.

## 7. Silent Breaking Changes

Bad signs:

- Field type changes from string to number.
- Error code meaning changes.
- Required field is added to an existing request.
- Enum gains a value older clients cannot handle.

Why it hurts:

- Existing clients break without compile-time help.

Do instead:

- Add fields optionally.
- Version or migrate breaking changes.
- Document compatibility decisions in the contract note.

## 8. Vague Fixes in Review

Bad signs:

- "Sanitize input."
- "Use better REST."
- "Add pagination."

Why it hurts:

- The implementer still has to design the real contract.

Do instead:

- Name the exact sink, route shape, status code, helper, or schema pattern to use.
- Provide the smallest contract change that aligns with the project.
