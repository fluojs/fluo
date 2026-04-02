# @konekti/queue

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>


Redis-backed background job processing for Konekti applications with decorator-based worker discovery and lifecycle-managed startup/shutdown.

## Installation

```bash
npm install @konekti/queue @konekti/redis
```

## Quick Start

```typescript
import { Inject, Module } from '@konekti/core';
import { createQueueModule, QUEUE, Queue, QueueWorker } from '@konekti/queue';
import { createRedisModule } from '@konekti/redis';

class SendWelcomeEmailJob {
  constructor(public readonly userId: string) {}
}

@QueueWorker(SendWelcomeEmailJob, { attempts: 3, concurrency: 5 })
class SendWelcomeEmailWorker {
  async handle(job: SendWelcomeEmailJob) {
    // process job
  }
}

@Inject([QUEUE])
class UserService {
  constructor(private readonly queue: Queue) {}

  async registerUser(userId: string) {
    await this.queue.enqueue(new SendWelcomeEmailJob(userId));
  }
}

@Module({
  imports: [
    createRedisModule({ host: '127.0.0.1', port: 6379 }),
    createQueueModule(),
  ],
  providers: [SendWelcomeEmailWorker, UserService],
})
export class AppModule {}
```

## API

- `createQueueModule(options?)` - registers global `QUEUE` and lifecycle worker processing
- `createQueueProviders(options?)` - returns raw providers for manual composition
- `QUEUE` - DI token for queue enqueueing
- `Queue` - interface with `enqueue(job)`
- `@QueueWorker(JobClass, options?)` - marks singleton worker classes for a job type
- `createQueuePlatformStatusSnapshot(input)` - maps queue lifecycle/dependency/drain signals into shared platform snapshot fields

## Runtime behavior

- worker discovery runs in `onApplicationBootstrap()` across providers/controllers in compiled modules
- only singleton providers/controllers are registered; non-singletons are warned and skipped
- jobs are serialized as JSON payload and rehydrated with the original job prototype before `handle(job)`
- worker classes must implement `handle(job)`
- one BullMQ queue/worker pair is created per job class using queue-owned duplicated Redis connections internally
- terminal failures are appended to Redis list keys: `konekti:queue:dead-letter:<jobName>`
- shutdown is idempotent and stops workers before closing queue-owned resources

## Requirements and boundaries

- `@konekti/queue` requires `@konekti/redis`; import `createRedisModule(...)` alongside `createQueueModule(...)`
- job payloads should stay DTO-like and JSON-serializable
- queue workers are singleton-only and discovered during `onApplicationBootstrap()`
- BullMQ is an internal implementation detail; the public API stays Konekti-native

## Platform status snapshot semantics

Use `createQueuePlatformStatusSnapshot(...)` (or `QueueLifecycleService#createPlatformStatusSnapshot()`) to expose queue lifecycle status in the shared platform snapshot shape.

- `ownership`: queue resources are framework-owned (`ownsResources: true`, `externallyManaged: false`).
- `readiness`: `ready` only when workers are started; startup is `degraded`; shutdown/idle/stopped are `not-ready`.
- `health`: pending dead-letter drain during runtime/shutdown is represented as `degraded`; fully stopped is `unhealthy`.
- `details`: includes explicit dependency edge (`redis.default`), worker discovery/ready counts, and pending dead-letter drain counts.
