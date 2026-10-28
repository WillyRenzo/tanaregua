# Observability Checklist

## Current State (verify before relying on it)

| Signal | What exists | Where | Known gap |
|---|---|---|---|
| Logs | pino JSON via `nestjs-pino`; `pino-pretty` only in development | `backend/src/app.module.ts` | Tenant/user ids not attached to log lines |
| Request id | `x-request-id` accepted (≤128 chars) or generated, echoed in the response | `genReqId` in `app.module.ts` | Not forwarded by the frontend; not shown to the user on errors |
| Redaction | `authorization`, `cookie`, `set-cookie` headers | `redact` in `app.module.ts` | Bodies and PII rely on discipline only — no test |
| 5xx | stack logged, generic Problem Details returned | `common/http/problem-details.filter.ts` | No error metric |
| Traces | OpenTelemetry NodeSDK + auto-instrumentations + Prisma, behind `OTEL_ENABLED`, loaded with `node --import dist/telemetry.js` | `backend/src/telemetry.ts` | No custom spans; frontend not instrumented; no collector in Compose |
| Metrics | none | — | No RED, business or job metrics |
| Health | `/health/live` (no deps), `/health/ready` (DB ping, 2 s) | `backend/src/health/` | — |
| Jobs | outbox retries with backoff; dead letter logged at `error`; modules register consumers in `OutboxHandlers`; birthday job every 10 min logs `birthday.queued`; deliveries log `marketing.message.sent/skipped/failed` (ids only) | `modules/notifications/outbox.processor.ts`, `modules/marketing/` | Backlog and failures not measured |
| Frontend | none | — | No `instrumentation.ts`, `onRequestError`, client errors or Web Vitals |
| Alerts/SLOs | none | — | Defined with the production deploy (B7) |

## Per Change

### Questions

- [ ] Production questions written down (what, which tenant, how long, why it failed).
- [ ] Each new signal answers one of them.

### Logs

- [ ] Structured fields, not interpolated strings, for anything you'd filter by.
- [ ] Level matches the action needed (`error` only when someone must act).
- [ ] `barbershopId` / `membershipId` / `requestId` present where available; no PII.
- [ ] External calls log provider, operation, duration and outcome — never payloads.

### Traces

- [ ] Auto-instrumented spans cover HTTP, DB and outbound fetch.
- [ ] Custom span only for a meaningful unit of work, with bounded attributes.
- [ ] Errors recorded on the span (`recordException`, status ERROR).
- [ ] `traceparent` propagated (Next server → API → providers).

### Metrics

- [ ] RED per route template and status class.
- [ ] Business counters for the feature (created, failed by `code`, voided…).
- [ ] Jobs: backlog gauge, attempts, dead letters.
- [ ] External providers: latency histogram and error counter by provider and operation.
- [ ] Labels are bounded sets; no ids, slugs, emails, raw paths.

### Health

- [ ] Liveness without dependencies; readiness only with hard dependencies (DB).

### Frontend

- [ ] Server errors via `onRequestError`; client errors and Web Vitals via a first-party endpoint.
- [ ] Route template reported, not the URL with ids or query strings; no PII.

### Privacy and Security

- [ ] Redaction covers new sensitive fields; a test proves masking where code formats values.
- [ ] No bodies, SQL parameters, tokens or cookies in any signal.
- [ ] Telemetry endpoints authenticated or rate limited; OTLP not exposed publicly.

### Operations

- [ ] Alert has a symptom, a threshold, an owner and a one-line runbook.
- [ ] Evidence captured locally (log line, span, metric) for each new signal.
- [ ] Exporter and backend chosen by environment variables only.
