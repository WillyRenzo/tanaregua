# Security Audit Checklist

Use this checklist to keep security findings specific, reachable, and prioritized.

## Context First

- [ ] `agent_docs/security.md` read when present.
- [ ] Auth model identified.
- [ ] Sensitive data types identified: PII, payment, tokens, secrets, tenant data.
- [ ] Trust boundaries mapped: browser, API, worker, DB, third parties.
- [ ] Framework and version family identified enough to know defaults.
- [ ] Existing middleware and guards checked.
- [ ] Existing ORM/query safety patterns checked.

## High-Risk Surfaces

- [ ] Authentication: login, reset, sessions, JWT, token refresh, logout.
- [ ] Authorization: object-level access, tenant scoping, admin checks.
- [ ] Injection: SQL, NoSQL, shell, template, HTML, LDAP, headers.
- [ ] Secrets: repo, logs, client bundles, CI artifacts, errors.
- [ ] Sensitive data exposure: responses, logs, analytics, exports.
- [ ] SSRF: server-side fetch from user-controlled URL.
- [ ] Open redirect: user-controlled redirect destination.
- [ ] XSS: unsafe HTML sinks and rich text rendering.
- [ ] CSRF: cookie-authenticated mutating routes.
- [ ] File/path: upload, download, path joins, archive extraction.
- [ ] Rate abuse: login, reset, invite, payment, export, scraping endpoints.

## Exploitability Check

For each possible issue:

- [ ] Who is the attacker?
- [ ] What permission do they need?
- [ ] What exact input/request do they send?
- [ ] Which code path receives it?
- [ ] Which sink or missing guard makes it dangerous?
- [ ] What data or capability is compromised?
- [ ] Is there an existing mitigation?
- [ ] Can this be tested?

## Severity

Critical:

- Low-privilege or unauthenticated attacker can read/modify others' data.
- Remote code execution or command execution.
- Secret/session theft with realistic path.
- Payment or account takeover impact.
- Tenant boundary bypass.

Should address:

- Exploitable with extra conditions.
- Sensitive data exposure with limited scope.
- Missing hardening on a sensitive path.
- Weakness likely to become exploitable with normal product growth.

Defense in depth:

- Reduces blast radius.
- Improves auditability.
- Blocks unlikely or already-mitigated paths.

## Finding Format

Each finding should include:

- file and line when possible
- vulnerability or risk
- exploit path
- impact
- project-specific fix
- suggested test when practical

## Stack Notes

Node / TypeScript:

- Check raw SQL and unsafe `$queryRaw` string construction.
- Next route handlers and Server Actions need authz, not only page middleware.
- Redirect URLs should be allowlisted.
- Avoid leaking raw error messages to clients.

Python:

- FastAPI auth dependency is not object-level authz.
- Django `mark_safe`, `|safe`, and CSRF exemptions need scrutiny.
- SQLAlchemy `text(f"...")` with user input is risky; bound params are not.

General:

- Do not call parameterized ORM queries injection findings.
- Do not call every dependency warning Critical.
- Do not recommend library versions without checking current docs.
