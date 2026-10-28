---
name: observability
description: Makes TaNaRegua observable end to end - structured logs, traces, metrics, health checks, frontend errors and web vitals, business signals, SLOs and alerts - with OpenTelemetry and no vendor lock-in, and without leaking personal data. Use when adding a feature or integration, investigating production behavior, preparing a deploy, or auditing what the app reports about itself.
---

# Observability

Source rules: AFA 18 in `agent_docs/architecture.md` (pino with correlation id, optional
OpenTelemetry, health probes), LGPD and log rules in `agent_docs/security.md`, ports and adapters
in `architecture.md`. This skill is how to apply them to every change.

Goal: for any request or job, answer **what happened, to which barbershop, how long it took and
why it failed** — from the browser to the database — without reading code and without personal data.

## Process

1. **Start from the current state** (`references/checklist.md`, "Current state"): know what already
   exists before adding anything. Don't duplicate pino, the request id or the health module.
2. **Name the questions** the change must answer in production (e.g. "how many bookings failed
   with `slot-unavailable` today?", "is the outbox backing up?"). Every signal you add must answer one.
3. **Logs** (pino via `nestjs-pino`): structured fields, one event per line, right level
   (`error` = someone must act; `warn` = degraded but handled; `info` = business event; `debug` = dev).
   Attach `requestId`, `barbershopId`, `membershipId`/`userId` and `traceId` when available.
   Never log PII, tokens, cookies or request bodies (`references/anti-patterns.md`).
4. **Traces** (OpenTelemetry, `backend/src/telemetry.ts`): rely on auto-instrumentation (HTTP,
   Express, pg, Prisma, pino). Add a custom span only around meaningful units of work (closing an
   order, an outbox dispatch, an external provider call), with low-cardinality attributes
   (`barbershop.id`, `order.items`, `provider`) and the error recorded on failure. Propagate W3C
   `traceparent` across the Next server, the API and outbound calls.
5. **Metrics** (OpenTelemetry metrics → OTLP): RED for HTTP (rate, errors, duration by route
   template and status class), plus business and job metrics — outbox pending/failed,
   bookings created/cancelled, orders closed/voided, external provider latency and errors.
   Labels are bounded sets only: never ids, emails or free text.
6. **Health**: `/health/live` stays dependency-free; `/health/ready` checks only what the API
   cannot serve without (the database). External providers (mail, WhatsApp, payment, AI) are
   **not** readiness checks — they get metrics and alerts instead.
7. **Frontend**: Next `instrumentation.ts` (`register` + `onRequestError`) for server-side traces
   and errors; client-side errors and Web Vitals (`useReportWebVitals`) sent to a first-party
   endpoint, with the route template, never the URL with ids or query strings. Check the current
   Next.js docs before wiring this (APIs changed across 15/16).
8. **Business and audit signals**: operational logs are not the audit trail. Who did what in the
   tenant (assistant actions, refunds, voids) belongs in the database, not in logs.
9. **SLOs and alerts**: alert on user-facing symptoms with an owner and a runbook line
   (`references/examples.md`), not on every error log.
10. **Prove it**: reproduce the scenario locally and show the log line, span or metric that answers
    the question from step 2. Tests assert what must never leak (PII masking, redaction).

<HARD-GATE>
No personal data or secrets in any signal: no names, phones, emails, birth dates, tokens, cookies,
passwords, card data or request/response bodies in logs, span attributes, metric labels or
frontend reports — use ids and masks (`••••7777`). Export only through OpenTelemetry/OTLP or stdout:
no vendor SDK outside an adapter, so the backend (Grafana stack, SaaS, self-hosted) can change by
configuration only.
</HARD-GATE>

## What NOT to do

- Don't add a vendor SDK (Sentry, Datadog, New Relic…) to domain or UI code; if one is ever
  needed, it lives behind configuration/OTLP, like any other provider.
- Don't use ids, slugs, emails or raw URLs as metric labels (cardinality explosion).
- Don't log at `error` for handled business outcomes (`slot-unavailable`, `refund-too-high`):
  those are 4xx with a `code`, counted by metric.
- Don't put external providers in the readiness probe: a mail outage must not take the API out of rotation.
- Don't enable verbose instrumentation that records SQL parameters or HTTP bodies.
- Don't create alerts without an action; noisy alerts get ignored.

## Output format

For a feature: the questions it answers, the signals added (log events, spans, metrics with their
labels), the evidence that each one appears locally, and what was checked for PII.
For an audit: a gap table (signal, current state, risk, proposed change) ordered by risk, then the
first changes to make.

## References

- Read `references/checklist.md` for the current state and per-change checklist.
- Read `references/examples.md` for log, span, metric, frontend and alert shapes in this stack.
- Read `references/anti-patterns.md` before finishing.
