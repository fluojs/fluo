# @fluojs/queue

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Redis-backed distributed job processing for fluo. It features decorator-based worker discovery, JSON-safe job serialization, and lifecycle-managed execution.

## Table of Contents

- [Installation](#installation)
- [When to use](#when-to-use)
- [Quick Start](#quick-start)
- [Migrating from NestJS Queue Workers](#migrating-from-nestjs-queue-workers)
- [Common Patterns](#common-patterns)
- [Public API](#public-api)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @fluojs/queue @fluojs/redis
```

`@fluojs/queue` requires Node.js `>=20.0.0`, as declared by `engines.node` in the package manifest. This package-level requirement still applies when the rest of a fluo application uses runtime-portable APIs.

`@fluojs/queue` includes BullMQ `^5.81.1`. Refresh the application lockfile when upgrading so BullMQ's patched dependency graph is installed. Queue registration, worker discovery, and persisted-job contracts are unchanged.

## When to Use

- When you need to process long-running or resource-intensive tasks in the background.
- When you want to decouple expensive operations (e.g., sending emails, image processing) from the request-response cycle.
- When you need a distributed queue with retry logic, backoff, and dead-letter handling.

## Quick Start

### 1. Define a Job and Worker

Create a job class and a worker class decorated with `@QueueWorker`.

```typescript
import { QueueWorker } from '@fluojs/queue';

export class ProcessOrderJob {
  constructor(public readonly orderId: string) {}
}

@QueueWorker(ProcessOrderJob, { attempts: 3, backoff: { type: 'fixed', delayMs: 5000 } })
export class OrderWorker {
  async handle(job: ProcessOrderJob) {
    console.log(`Processing order: ${job.orderId}`);
    // Your logic here
  }
}
```

### 2. Register and Enqueue

Import `QueueModule` and inject `QueueLifecycleService` to enqueue jobs.

`QueueModule.forRoot(...)` is the supported root entrypoint for application-level queue registration.

```typescript
import { Module, Inject } from '@fluojs/core';
import { QueueModule, QueueLifecycleService } from '@fluojs/queue';
import { RedisModule } from '@fluojs/redis';

@Inject(QueueLifecycleService)
export class OrderService {
  constructor(private readonly queue: QueueLifecycleService) {}

  async placeOrder(id: string) {
    await this.queue.enqueue(new ProcessOrderJob(id));
  }
}

@Module({
  imports: [
    RedisModule.forRoot({ host: 'localhost', port: 6379 }),
    QueueModule.forRoot(),
  ],
  providers: [OrderService, OrderWorker],
})
export class AppModule {}
```

## Migrating from NestJS Queue Workers

Consumers moving from NestJS queue integrations must replace metadata-driven processor discovery with fluo's explicit module and worker contract. This is a source migration, not a compatibility mode:

1. Register the backing Redis client with `RedisModule.forRoot(...)`, then import `QueueModule.forRoot(...)` from the module graph that owns the queue. Do not copy NestJS async-module shapes or expect Queue to read environment configuration implicitly.
2. Replace `@Processor(...)`, `@Process(...)`, or other NestJS/Bull provider metadata with the TC39 standard class decorator `@QueueWorker(JobClass, options?)`. Each worker must expose a callable `handle(job)` method.
3. Add the decorated worker class to `@Module({ providers: [...] })` as a singleton. Queue scans compiled provider/controller registrations; it does not scan `@Injectable()` metadata, emitted constructor types, or arbitrary imported classes. Declare constructor dependencies explicitly with `@Inject(...)`.
4. Keep the worker reachable from the queue registration. The default global `QueueModule.forRoot()` can discover singleton workers across the compiled application graph. With `global: false`, discovery is limited to modules that can reach that specific registration through their authored imports/exports, and the matching Redis provider must be reachable from the same module tree.
5. Remove worker-owned start/stop hooks that duplicate Queue lifecycle ownership. Queue creates resources during application bootstrap, starts BullMQ processors only after the application bootstrap-ready handoff, rejects new enqueue calls after shutdown starts, and bounds active processor shutdown with `workerShutdownTimeoutMs` before requesting a force-close.

Before cutover, account for the persistence identity mismatch. NestJS Bull/BullMQ can persist multiple named job values under one `queueName`. fluo instead uses the worker's `jobName` as both the BullMQ queue name and the named job when it creates one queue/worker pair for each job type. Setting `jobName` alone therefore cannot preserve a legacy topology in which multiple named jobs share one `queueName`, and `@fluojs/queue` does not interpret NestJS decorator metadata or transform an existing serialized payload.

Choose an application-owned persisted-job cutover: drain the legacy queue with the old workers before switching producers; transform and re-enqueue compatible payloads into fluo's per-job queues; or use separate queue names for fluo while legacy workers drain old work. In every path, verify the payload class shape, retry/backoff settings, and shutdown budget, then deploy producers and singleton `@QueueWorker(JobClass)` providers through the same `QueueModule.forRoot(...)` graph. For `global: false`, preserve worker and Redis reachability, and remember that processing starts only after the bootstrap-ready handoff and shutdown is bounded by `workerShutdownTimeoutMs`.

## Common Patterns

### Named Redis Client

Leave `clientName` unset to keep using the default `@fluojs/redis` client from your app. If your queues should use a non-default Redis connection, set `clientName` to the name registered with `RedisModule.forRoot({ name, ... })`.

```typescript
QueueModule.forRoot({ clientName: 'jobs' })
```

`@fluojs/queue` resolves that Redis client during application bootstrap, then creates queue-owned duplicate connections for BullMQ. The shared `@fluojs/redis` client remains owned by `RedisModule`; Queue closes only the duplicate BullMQ connections it creates. Those duplicate connections are configured with BullMQ's required `maxRetriesPerRequest: null` worker setting so startup behavior matches BullMQ's runtime constraints.

When `QueueModule.forRoot({ global: false })` is used, each queue registration only discovers workers that are reachable from the same module tree that imported that specific `QueueModule.forRoot(...)` call. Separate scoped queue feature modules stay isolated from one another, and the Redis client provider must be reachable from that same module tree.

### Scoped Queue Registrations

Use an explicit `scope` when an application imports more than one non-global queue registration. Scope names are trimmed, must be non-empty, and must be unique per compiled module graph. Duplicate default scoped registrations such as two `QueueModule.forRoot({ global: false })` imports, or duplicate explicit scopes such as two `QueueModule.forRoot({ global: false, scope: 'jobs' })` imports, fail deterministically during bootstrap.

```typescript
import { Inject, Module } from '@fluojs/core';
import { getQueueLifecycleServiceToken, getQueueToken, QueueModule, type Queue } from '@fluojs/queue';

const EMAIL_QUEUE = getQueueToken('email');
const EMAIL_QUEUE_LIFECYCLE = getQueueLifecycleServiceToken('email');

@Inject(EMAIL_QUEUE)
export class EmailPublisher {
  constructor(private readonly queue: Queue) {}
}

@Module({
  imports: [QueueModule.forRoot({ global: false, scope: 'email' })],
  providers: [EmailPublisher, EmailWorker],
})
export class EmailQueueModule {}
```

Omit `scope` only when the application has a single default queue registration and injects the compatibility `QUEUE` token or `QueueLifecycleService` class directly. For scoped registrations, inject `getQueueToken(scope)` or `getQueueLifecycleServiceToken(scope)` so each feature module resolves its own queue instance instead of the default compatibility token.

### Bootstrap and Shutdown Lifecycle

Queue discovers workers and creates queue-owned BullMQ resources during application bootstrap, but BullMQ worker processors are started only after the runtime marks the full application bootstrap/readiness sequence complete. Jobs enqueued by other `onApplicationBootstrap()` hooks can be accepted once the Queue service is initialized, and their processors run after the bootstrap-ready handoff instead of racing ahead of later async bootstrap hooks or application readiness. Queue status reports degraded readiness until those BullMQ processors have actually started; if a processor fails to start, the lifecycle moves to `failed` and status snapshots expose the failure instead of reporting the workers as ready.

Application shutdown marks Queue as `stopping`, rejects new enqueue attempts, closes queue-owned workers/queues/connections, and then attempts to drain pending dead-letter writes. Queue waits at most `5_000ms` for each pending dead-letter write. If that wait times out, Queue logs the timeout, stops counting the write as pending, and continues shutdown without guaranteeing that the record reached Redis. Worker shutdown is separately bounded by `workerShutdownTimeoutMs` so an active processor that never settles cannot block application shutdown indefinitely. When that timeout elapses, Queue logs the timeout and asks BullMQ to force-close the worker before continuing resource cleanup.

### Distributed Retries

Workers can be configured with a maximum number of attempts and backoff strategies to handle transient failures automatically.

```typescript
@QueueWorker(MyJob, { 
  attempts: 5, 
  backoff: { type: 'exponential', delayMs: 1000 } 
})
```

### Dead-Letter Handling

When a worker exhausts its retry attempts, Queue appends a dead-letter record to Redis (`fluo:queue:dead-letter:<jobName>`) for manual inspection or recovery. Queue does not move the BullMQ job itself.

`QueueModule.forRoot()` keeps the most recent `1_000` dead-letter entries per job by default. Set `defaultDeadLetterMaxEntries: false` to opt out, or provide a smaller positive number when operators need a tighter retention budget.

Use `QueueLifecycleService.inspectDeadLetters(jobName, { limit })` or the same method on an injected `Queue` facade to inspect records without reading Queue's Redis keys directly:

```typescript
const inspection = await queue.inspectDeadLetters('ProcessOrderJob', { limit: 25 });

for (const record of inspection.records) {
  console.log(record.jobId, record.failedAt, record.errorMessage);
}
```

Inspection is read-only and returns valid records in newest-first order. It reads Redis without lifecycle-gating the operation, so inspection does not start workers and remains usable while Queue is `idle` or after worker startup reaches `failed`, as long as the backing Redis client is reachable. Queue does not own the shared Redis client; after `RedisModule` shuts that client down, inspection propagates the backing Redis operation error instead of promising post-shutdown availability. The limit defaults to `100` stored entries and is capped at `1_000`; invalid limits fall back to the default. Malformed stored values are omitted and counted in `malformedRecordCount` for the inspected window, and `payload` remains `unknown` so application code must narrow its own job data. Inspection does not delete, replay, or mutate jobs or dead-letter records.

Jobs must be JSON-serializable plain objects. Queue serializes the job payload before enqueueing and rehydrates the job prototype on the worker side.

Treat low-level provider assembly as an internal implementation detail: low-level provider helpers are not part of the documented root-barrel contract.

## Public API Overview

### Core
- `QueueModule`: Main entry point for queue registration.
- `QueueModule.forRoot(options)`: Registers queue support for an application module.
- `QueueLifecycleService`: Primary service for enqueuing jobs, read-only dead-letter inspection, and lifecycle/status snapshots (`enqueue(job)`, `inspectDeadLetters(jobName, options?)`, `createPlatformStatusSnapshot()`).
- `@QueueWorker(JobClass, options?)`: Decorator to mark a class as a job handler.
- `QUEUE`: Compatibility injection token for the queue facade.
- `getQueueToken(scope?)`: Queue facade token helper. Omitting `scope` returns the default `QUEUE` token; a non-empty scope returns that scoped registration's facade token.
- `getQueueLifecycleServiceToken(scope?)`: Lifecycle service token helper for scoped queue registrations.
- `createQueuePlatformStatusSnapshot(...)`: Status snapshot helper for lifecycle/readiness diagnostics.


### Types
- `Queue`: Application facade with `enqueue(job)` and read-only `inspectDeadLetters(jobName, options?)` for application code and the `QUEUE` token.
- `QueueDeadLetterInspectionOptions`: Bounded dead-letter inspection settings (`limit`).
- `QueueDeadLetterInspectionResult`: Newest-first valid records plus `malformedRecordCount` for the inspected window.
- `QueueDeadLetterRecord`: Typed dead-letter metadata with an `unknown` application payload.
- `QueueJobType`: Constructor type used to identify and rehydrate a job payload class.
- `QueueModuleOptions`: Global queue settings (`global`, clientName, default attempts, `defaultBackoff`, concurrency, rate limiting, dead-letter retention).
- `QueueWorkerOptions`: Per-job settings (attempts, backoff, concurrency, jobName, rate limiting).
- `QueueBackoffType`: Supported retry backoff strategy names (`fixed`, `exponential`).
- `QueueBackoffOptions`: Retry backoff settings (`type`, `delayMs`).
- `QueueRateLimiterOptions`: Worker-level distributed rate limiter settings (`max`, `duration`).
- `QueueLifecycleState`: Lifecycle states reported by Queue status adapters (`idle`, `starting`, `started`, `stopping`, `stopped`, `failed`).
- `QueueStatusAdapterInput`: Normalized queue metrics and worker-start diagnostics passed to `createQueuePlatformStatusSnapshot(...)`.
- `QueuePlatformStatusSnapshot`: Queue-specific readiness, health, ownership, and detail snapshot returned by the status helper and `QueueLifecycleService.createPlatformStatusSnapshot()`.

`QueueModuleOptions` also includes lifecycle and dead-letter retention controls such as `workerShutdownTimeoutMs` and `defaultDeadLetterMaxEntries`.

`QueueModuleOptions` lifecycle/status controls:

- `global`: whether the queue module registration is global. Defaults to `true`; set `false` when queue providers should stay scoped to the importing module graph.
- `scope`: unique non-empty queue registration scope. Required when multiple non-global queue registrations exist in one app.
- `workerShutdownTimeoutMs`: maximum time to wait for active worker processors during shutdown before force-closing the BullMQ worker. Defaults to `30_000`.
- `defaultDeadLetterMaxEntries`: maximum retained dead-letter records per job, or `false` to disable trimming. Defaults to `1_000`.

`QueueLifecycleService.createPlatformStatusSnapshot()` uses the same public snapshot contract as `createQueuePlatformStatusSnapshot(...)`. It reports readiness as `ready` only after Queue reaches `started` and every discovered BullMQ worker processor has started. While those conditions remain true, pending dead-letter writes keep readiness `ready` but degrade health until the pending count returns to zero. `started` resources with pending processors report degraded readiness, `starting` reports degraded readiness, `stopping` reports not-ready/degraded, `stopped` reports not-ready/unhealthy, and worker-start failures report not-ready/unhealthy with `workerStartFailures` and `lastWorkerStartFailure` details. Snapshot details include the Redis dependency id, lifecycle state, ready/discovered worker counts, pending dead-letter writes, the `5_000ms` dead-letter drain timeout, and `workerShutdownTimeoutMs`.

Only singleton `@QueueWorker()` providers/controllers are registered. Request/transient workers are skipped during discovery.

## Related Packages

- `@fluojs/redis`: Required as the backing store for job persistence.
- `@fluojs/cron`: For scheduled/recurring background tasks.

## Example Sources

- `packages/queue/src/module.test.ts`: Worker discovery and enqueueing tests.
- `packages/queue/src/public-surface.test.ts`: Public API contract verification.
- `packages/queue/src/status.test.ts`: Queue lifecycle status snapshot tests.
