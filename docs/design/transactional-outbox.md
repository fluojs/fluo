# transactional outbox

This document defines a proposed durable event publication path for workloads that cannot tolerate in-process event loss.

## problem statement

`@konekti/event-bus` is explicitly in-process only. It dispatches handlers inside one Node.js process and does not provide durability, persistence, replay, or cross-process delivery. If the process crashes during dispatch, in-flight events are lost.

For domain events that must survive crashes and be consumed by distributed workers, the current event-bus behavior is insufficient.

## outbox pattern overview

The transactional outbox pattern stores events in a database table as part of the same database transaction as the domain write.

- service writes domain state changes and outbox rows in one transaction
- transaction commit makes both durable together
- separate publisher process reads unpublished outbox rows and publishes to broker/queue
- publisher marks rows as published (or records attempts/failures) for retry and observability

This removes the "write committed but event lost" failure mode.

## integration points in konekti data packages

Both `@konekti/prisma` and `@konekti/drizzle` already expose transaction APIs with async-local transaction context propagation.

- Prisma path: `$transaction(...)`
- Drizzle path: `transaction(...)`

A durable outbox integration can reuse that context:

- if a transaction context exists, enqueue outbox rows into that same transaction handle
- if no transaction context exists, either open a local transaction or reject based on policy

## api sketch (design only)

Potential package-level API shape:

```typescript
interface OutboxEnvelope {
  id: string;
  topic: string;
  payload: unknown;
  occurredAt: Date;
  aggregateType?: string;
  aggregateId?: string;
  headers?: Record<string, string>;
}

interface OutboxWriter {
  publish(event: OutboxEnvelope): Promise<void>;
}

class OutboxEventBus implements OutboxWriter {
  async publish(event: OutboxEnvelope): Promise<void> {
    // resolve current tx from ALS-aware prisma/drizzle integration
    // insert into outbox table inside current transaction
  }
}
```

Notes:

- `publish()` persists, it does not directly fan out to handlers
- actual delivery is done by outbox dispatcher workers
- optional compatibility adapter can mirror current `EventBus` surface where needed

## schema and migration requirements

Introduce an outbox table through normal migration tooling.

Minimum columns:

- `id` (stable event id, uuid/ulid)
- `topic` (logical routing key)
- `payload` (json/jsonb)
- `headers` (optional json/jsonb)
- `occurred_at` (event creation timestamp)
- `published_at` (nullable)
- `attempt_count` (int, default 0)
- `last_error` (nullable text)

Recommended indexes:

- `(published_at, occurred_at)` for poller scan
- `(topic, occurred_at)` for operational tracing

## publish strategy tradeoffs: polling vs cdc

### polling worker

- easy to implement in app/runtime code
- works with any supported database
- introduces scan interval latency and read amplification
- requires careful locking/claiming strategy (`for update skip locked` or equivalent)

### cdc (change data capture)

- lower latency, event-stream native integration
- better fit for high-throughput or cross-language consumers
- higher operational complexity (connector infrastructure, replay tooling)
- vendor and platform dependencies are stronger than simple polling

Recommended default path: polling first, CDC optional for advanced deployments.

## rollout expectations

- keep `@konekti/event-bus` as documented in-process primitive
- add outbox as a separate package/feature path to avoid behavior ambiguity
- define clear migration guide from in-process publish calls to outbox publish calls

## status

Design documented only. Implementation is intentionally deferred to a separate GitHub issue.
