# Observability Examples

Shapes for this stack. Check current library docs before copying APIs; the point is the
fields, levels, attributes and labels.

## Example 1: Business Log Line Without PII

```ts
// Good: structured, tenant-scoped, ids only.
this.logger.log({ event: 'order.closed', barbershopId, orderId, items: 3, totalCents, paymentMethod }, 'Comanda fechada');

// Bad: PII and interpolation.
this.logger.log(`Comanda de ${client.name} (${client.phone}) fechada`);
```

Attach request context once instead of in every call — e.g. pino-http `customProps` reading the
authenticated tenant/user from the request context (CLS), so every line of the request carries
`barbershopId` and `membershipId`.

## Example 2: Custom Span Around a Unit of Work

```ts
import { SpanStatusCode, trace } from '@opentelemetry/api';

const tracer = trace.getTracer('tanaregua-api');

return tracer.startActiveSpan('orders.close', async (span) => {
  span.setAttributes({ 'barbershop.id': barbershopId, 'order.items': items.length });
  try {
    return await this.closeInTransaction(orderId, input);
  } catch (error) {
    span.recordException(error as Error);
    span.setStatus({ code: SpanStatusCode.ERROR });
    throw error;
  } finally {
    span.end();
  }
});
```

`@opentelemetry/api` is a no-op when the SDK is not started (`OTEL_ENABLED=false`), so this is safe in tests.

## Example 3: Metrics With Bounded Labels

```ts
import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('tanaregua-api');
const bookings = meter.createCounter('bookings', { description: 'Reservas online por resultado' });
const outboxPending = meter.createObservableGauge('outbox.pending');
const providerLatency = meter.createHistogram('provider.duration', { unit: 'ms' });

bookings.add(1, { result: 'created' });           // created | slot_unavailable | conflict
bookings.add(1, { result: 'slot_unavailable' });
providerLatency.record(elapsed, { provider: 'resend', operation: 'send', outcome: 'ok' });
// Never: { barbershopId }, { slug }, { email }, { path: '/v1/orders/0199…' }
```

The gauge callback counts `outbox_events` by status with a cheap indexed query.

## Example 4: Frontend (Next.js 16)

```ts
// frontend/src/instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.OTEL_ENABLED === 'true') {
    await import('./instrumentation.node');   // NodeSDK + OTLP exporter, service 'tanaregua-web'
  }
}

export async function onRequestError(error, request, context) {
  // Route template (context.routePath), not request.path with ids; no headers, no cookies.
}
```

Client side: `useReportWebVitals` (from `next/web-vitals`) and a global error handler post
`{ name, value, route, release }` to a first-party endpoint that is rate limited and has no PII.

## Example 5: Health Probes

```
GET /health/live   → 200 while the process runs (no dependencies)
GET /health/ready  → 200 only when the DB answers within 2 s
```

The mail provider being down shows up as `provider.errors{provider="resend"}` and an alert,
not as a failing readiness probe.

## Example 6: SLOs and Alerts

| SLO | Indicator | Alert (symptom) | Runbook line |
|---|---|---|---|
| Public booking available | 99.5% non-5xx on `/v1/public/*` over 30 days | 5xx rate > 2% for 10 min | Check `/health/ready`, API logs by `requestId`, recent deploy |
| Availability is fast | p95 `/v1/public/:slug/availability` < 500 ms | p95 > 1 s for 15 min | Trace the slow request; check DB spans and indexes |
| Notifications flow | outbox pending < 100 and no dead letters | dead letters > 0, or pending growing 15 min | Check `lastError` in `outbox_events`; provider status |
| Orders close | `orders.close` errors (5xx) ≈ 0 | any 5xx on close in 5 min | Trace by `requestId`; DB constraint in the span |

## Example 7: Local Collector for Development

Add an OpenTelemetry Collector (and a viewer such as Jaeger or Grafana LGTM) under a Compose
profile (`--profile observability`), point `OTEL_EXPORTER_OTLP_ENDPOINT` at it and set
`OTEL_ENABLED=true`. Production uses the same variables pointing to the chosen backend.
