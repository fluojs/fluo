# @fluojs/queue

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Redis-backed distributed job processing for fluo. It features decorator-based worker discovery, automatic job serialization, and lifecycle-managed execution.

## Table of Contents

- [Installation](#installation)
- [When to use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
- [Public API](#public-api)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @fluojs/queue @fluojs/redis
```

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

```typescript
import { Module, Inject } from '@fluojs/core';
import { QueueModule, QueueLifecycleService } from '@fluojs/queue';
import { RedisModule } from '@fluojs/redis';

@Module({
  imports: [
    RedisModule.forRoot({ host: 'localhost', port: 6379 }),
    QueueModule.forRoot(),
  ],
  providers: [OrderWorker],
})
export class AppModule {}

export class OrderService {
  @Inject(QueueLifecycleService)
  private readonly queue: QueueLifecycleService;

  async placeOrder(id: string) {
    await this.queue.enqueue(new ProcessOrderJob(id));
  }
}
```

## Common Patterns

### Named Redis Client

Leave `clientName` unset to keep using the default `@fluojs/redis` client from your app. If your queues should use a non-default Redis connection, set `clientName` to the name registered with `RedisModule.forRootNamed(...)`.

```typescript
QueueModule.forRoot({ clientName: 'jobs' })
```

### Distributed Retries

Workers can be configured with a maximum number of attempts and backoff strategies to handle transient failures automatically.

```typescript
@QueueWorker(MyJob, { 
  attempts: 5, 
  backoff: { type: 'exponential', delayMs: 1000 } 
})
```

### Dead-Letter Handling

Jobs that fail all retry attempts are automatically moved to a dead-letter list in Redis (`fluo:queue:dead-letter:<jobName>`) for manual inspection or recovery.

## Public API Overview

### Core
- `QueueModule`: Main entry point for queue registration.
- `QueueLifecycleService`: Primary service for enqueuing jobs (`enqueue(job)`).
- `@QueueWorker(JobClass, options?)`: Decorator to mark a class as a job handler.

### Types
- `QueueModuleOptions`: Global queue settings (clientName, default attempts, concurrency, rate limiting).
- `QueueWorkerOptions`: Per-job settings (attempts, backoff, concurrency, priority).
- `QueueBackoffOptions`: Retry backoff settings (`type`, `delayMs`).

## Related Packages

- `@fluojs/redis`: Required as the backing store for job persistence.
- `@fluojs/cron`: For scheduled/recurring background tasks.

## Example Sources

- `packages/queue/src/module.test.ts`: Worker discovery and enqueueing tests.
- `packages/queue/src/public-surface.test.ts`: Public API contract verification.
