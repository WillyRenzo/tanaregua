# Security Audit Anti-Patterns

Read this before publishing a security audit.

## 1. Generic OWASP Dump

Bad signs:

- Every OWASP category is listed.
- Findings do not point to code.
- Risks are described without reachable inputs.

Why it hurts:

- The user cannot prioritize.
- Real vulnerabilities get buried.

Do instead:

- Map categories to actual sinks and trust boundaries in this repo.

## 2. Severity Inflation

Bad signs:

- Theoretical possibilities are Critical.
- Defense-in-depth suggestions appear with exploitable bugs.
- Existing mitigations are ignored.

Why it hurts:

- Critical stops meaning critical.

Do instead:

- Critical requires realistic attacker, path, and impact now.

## 3. "Sanitize Input" Without a Sink

Bad signs:

- Recommendation says only "sanitize."
- The vulnerable API is not named.
- Safe alternative is not stack-specific.

Why it hurts:

- The fix is ambiguous and often wrong.

Do instead:

- Name the sink and safe pattern: parameterized query, encoder, allowlist, schema validation, or framework helper.

## 4. Authn/Authz Confusion

Bad signs:

- "Missing authentication" is reported when login is present.
- Object-level permission checks are skipped.
- Tenant filters are not inspected.

Why it hurts:

- The real bug is missed or mislabeled.

Do instead:

- Ask: who is the caller, and may they access this specific object?

## 5. Outdated or Invented Library Advice

Bad signs:

- Recommending hard-coded versions without checking.
- Replacing a maintained project-standard library without evidence.
- "Use bcrypt" when the project already uses Argon2 or scrypt correctly.

Why it hurts:

- Security guidance can become harmful.

Do instead:

- Recommend the class of fix and verify current stack docs when version details matter.

## 6. Client-Only Threat Model

Bad signs:

- UI restrictions are treated as security.
- Hidden buttons are considered authorization.
- Client validation is trusted.

Why it hurts:

- Attackers call APIs directly.

Do instead:

- Check server-side authorization and validation.

## 7. Ignoring Sensitive Output

Bad signs:

- Responses return whole database rows.
- Logs include tokens or PII.
- Error details expose stack traces.

Why it hurts:

- Data can leak without a classic injection bug.

Do instead:

- Use explicit response schemas and safe logging patterns.

## 8. Dependency Audit Scope Drift

Bad signs:

- First-party code audit turns into package CVE triage.
- `npm audit` output is pasted as findings without reachability.

Why it hurts:

- Different risk model and remediation path.

Do instead:

- Keep first-party code findings here.
- Mention dependency issues only when the vulnerable code path is relevant.
