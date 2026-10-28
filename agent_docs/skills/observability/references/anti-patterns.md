# Observability Anti-Patterns

## 1. PII in Telemetry

Bad signs:

- Client names, phones, emails or birth dates in log messages, span attributes or error reports.
- Request/response bodies logged "for debugging".

Why it hurts:

- LGPD violation; telemetry backends are copied, retained and shared far beyond the database.

Do instead:

- Ids and masks only (`clientId`, `••••7777`); redact by configuration and test the masking.

## 2. High-Cardinality Labels

Bad signs:

- Metric labels with `barbershopId`, `orderId`, slug, email or the raw URL path.

Why it hurts:

- Series explode, costs grow and queries slow down or fail.

Do instead:

- Bounded labels (route template, status class, provider, result); ids go to logs and traces.

## 3. Logs as Metrics

Bad signs:

- Counting errors by grepping log lines; dashboards built on log text.

Why it hurts:

- Fragile, slow and breaks when a message changes.

Do instead:

- Emit a counter or histogram for what you need to count or time.

## 4. Everything at `error`

Bad signs:

- Handled business outcomes (`slot-unavailable`, 4xx) logged at `error`.

Why it hurts:

- Real incidents drown in noise and alerts get muted.

Do instead:

- `error` only when someone must act; business outcomes become metrics by `code`.

## 5. Vendor Lock-In

Bad signs:

- A vendor SDK imported in services or React components.

Why it hurts:

- Changing provider means touching domain and UI code; extra supply-chain risk.

Do instead:

- OpenTelemetry API in code, OTLP exporter chosen by environment variables.

## 6. Readiness Coupled to Optional Dependencies

Bad signs:

- `/health/ready` fails when mail, WhatsApp, payment or AI providers are down.

Why it hurts:

- A third-party outage takes the whole API out of rotation.

Do instead:

- Readiness = hard dependencies only (DB); providers get metrics and alerts.

## 7. Broken Correlation

Bad signs:

- A frontend error with no way to find the API request; logs without `traceId`/`requestId`.

Why it hurts:

- Every investigation starts from scratch.

Do instead:

- Propagate `traceparent` and `x-request-id`; include them in logs and in the Problem Details shown to support.

## 8. Alerts Without Action

Bad signs:

- Alerts on every 5xx line, CPU blips, or with no owner and no runbook.

Why it hurts:

- Alert fatigue; the important one gets ignored.

Do instead:

- Symptom-based alerts tied to SLOs, each with a threshold, owner and one-line runbook.

## 9. Audit Trail in Logs

Bad signs:

- "Who refunded this package?" answered by searching logs.

Why it hurts:

- Logs rotate and are not tenant-scoped records.

Do instead:

- Business audit (author, action, time) stored in the database; logs are operational.
