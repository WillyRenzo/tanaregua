---
name: security-audit
description: Use when the user asks for a security review or audit, mentions a vulnerability or exploit, is implementing or touching authentication, authorization, payments, or PII, or asks "is this safe" or "can this be exploited." Also use proactively when reviewing code that handles user input, secrets, or sensitive data, even if not explicitly requested.
---

# Security Audit

## Process

1. Check project security context first: `agent_docs/security.md`, auth model, sensitive data, secrets handling, trust boundaries, and existing mitigations.
2. Identify the real stack and sinks before using any checklist: framework, ORM/query layer, templating, file access, outbound requests, auth middleware, and deployment assumptions.
3. Prioritize reachable exploit paths over generic category coverage: authz bypass, injection, secrets, sensitive data exposure, unsafe redirects/fetches, file/path issues, and unsafe rendering.
4. Before labeling Critical, verify framework defaults, middleware, ORM parameterization, and existing guards do not already block the path.
5. For each finding, explain actor -> request/input -> vulnerable code -> impact -> concrete fix.
6. Separate exploitable findings from defense-in-depth hardening.

<HARD-GATE>
Do not output a generic OWASP-style dump. Every finding must name a reachable path in this codebase or be explicitly labeled as defense in depth. Critical requires a realistic attacker and impact now.
</HARD-GATE>

## What NOT to do

- Don't produce a generic OWASP Top 10 checklist disconnected from what this codebase actually does — a mobile app and a payment API have different real risk profiles.
- Don't flag theoretical vulnerabilities with no realistic exploit path as if they were equivalent to exploitable ones.
- Don't recommend a specific security library or pattern without checking it's still current — security tooling and recommended versions change, and outdated advice here is actively harmful.
- Don't skip explaining *why* something is exploitable — "add input validation" without the actual attack scenario doesn't help the user understand the risk.

## Output format

```
## Critical (exploitable now)
- [file:line] — vulnerability — exploit path — fix

## Should address
- [file:line] — risk — fix

## Defense in depth (optional hardening)
- [file:line] — suggestion
```

## References

- Read `references/checklist.md` to inspect context, sinks, exploitability, and severity.
- Read `references/examples.md` when writing concrete exploit-path findings.
- Read `references/anti-patterns.md` before finalizing to remove generic, theoretical, or inflated security claims.
