# Running Failed Jobs Again

<!-- book:volume=02-fluoshop;chapter=15 -->

[Previous: What If the Save Succeeded but the Event Disappeared?](./ch14-outbox-and-inbox.md) | [Volume 2 Contents](./toc.md) | [Next: Write Models and Read Models Develop Different Needs](./ch16-cqrs-projections.md)

## Who Will Execute the Intent Left Behind?

The problem on the first day of sales was losing events. Now PostgreSQL retains the payment, Outbox, the notification feature's Inbox, and `ReceiptRequest`. But who runs receipt material generation again if a brief database disconnection makes it fail in the early morning? An infinite loop in a request handler holds up the customer response and server shutdown. A single periodic task processing all receipts in sequence makes healthy orders wait behind one slow item. Preserving responsibility and allocating execution resources are different problems.

In this chapter, we use `@fluojs/queue` to hand each receipt preparation request to a Redis-based job. We continue using the Redis and queue infrastructure from Volume 1's blog subscription jobs rather than creating a separate shop application. A singleton worker in the same `fluo-blog` application graph processes the jobs. We do not separate the fulfillment service at this stage either. Without sending actual email or calling a payment provider, we implement generation of receipt material from the payment snapshot and storage in PostgreSQL.

Queue retries are opportunities to call the same code again. They do not determine whether an external side effect occurred during the first call. A job that stops after a successful DB save but before reporting completion may run again. Before choosing queue options, we must therefore decide what counts as the same result. The business result here is one receipt body for a `ReceiptRequest.id`. No matter how often redelivery or an operator-initiated rerun occurs, this row must converge on one completed result.

## The Class Is a Routing Contract; the Payload Is a Storage Contract

Create `src/notifications/jobs/render-receipt.job.ts` as the following complete file.

```typescript
export class RenderReceiptJob {
  constructor(public readonly requestId: string) {}
}
```

We did not put the amount or customer email into the job again. The previous chapter's `ReceiptRequest` already contains the required snapshot from order placement, so the job only needs to point to that row. This also avoids unnecessary copies of personal data in Redis storage and failure records. It does create a dependency on PostgreSQL: if the DB goes down, the job fails and becomes eligible for queue retry. That is the intended boundary of this example.

The identifier chain starts at the `PaidOrderOutbox.id` created by `PaymentLedger.record()`. `EventInbox` stores `(notifications.receipt.v1, eventId)`, and `ReceiptRequest.id` inherits that `eventId` in the same transaction. The queue's `requestId` is the same value. `orderVersion` is the version at the payment transition, while `dispatchVersion` below is the handoff generation. Do not create a new order version or payment event ID for a rerun. This worker neither consumes an already consumed reservation again nor performs refund compensation.

The producer must enqueue an instance of the class exported from this file. `queue.enqueue({ requestId })` may satisfy TypeScript's `object` constraint, but it is rejected at runtime because its constructor is not registered. Redeclaring a class with the same name and fields in another file also produces a different constructor. The current Fluo producer API is `enqueue(new Job(...), options?)`, not `add(name, payload)`.

On storage, the job object is serialized to JSON, and the registered prototype is restored on the worker side. There is no contract that the constructor runs again. Validation placed only inside the constructor can therefore be skipped when a stored job is processed. A `Date` becomes a string across the JSON boundary, and `bigint` fails default JSON serialization. Even with only one ID, an older deployment or invalid stored data is possible, so validate the fields the worker actually consumes at its entry boundary.

## Making Result Persistence Itself Idempotent

The following `src/notifications/receipt.service.ts` is a complete file matching the previous chapter's schema. The receipt is a JSON document containing payment material, not HTML or a legal tax invoice. HTML would need separate boundaries for string escaping and template versioning, so we choose JSON here.

```typescript
import { Inject } from '@fluojs/core';
import { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';

@Inject(PrismaService)
export class ReceiptService {
  constructor(private readonly db: PrismaService<PrismaClient>) {}

  async prepare(requestId: string): Promise<void> {
    const request = await this.db.current().receiptRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) throw new Error('Receipt request not found');
    if (request.completedAt !== null) return;
    if (request.currency !== 'KRW' || request.totalMinor <= 0n) {
      throw new Error('Invalid receipt snapshot');
    }
    const body = JSON.stringify({
      schemaVersion: 1,
      requestId: request.id,
      orderId: request.orderId,
      orderVersion: request.orderVersion,
      currency: request.currency,
      totalMinor: request.totalMinor.toString(),
    });
    await this.db.current().receiptRequest.updateMany({
      where: { id: request.id, completedAt: null },
      data: { body, completedAt: new Date() },
    });
  }
}
```

One conditional update records the body and completion time together. Even if two workers read the unfinished row concurrently, both can only calculate a body; only the first to update the still-unfinished row persists it. A `count` of 0 on the second update is not a failure: another call has already produced the result we want. This conclusion relies on a contract that request rows are not arbitrarily deleted and their snapshots are not changed. `ReceiptRequest` is immutable except for completion state and handoff metadata, and administration features must follow that principle too.

There is no network send between calculation and persistence. That is why this short implementation is sufficient. Using the same pattern to send email first and then update completedAt could let both workers send an email. Even a DB lock acquired before sending would leave uncertainty about the external result after process termination. That boundary needs its own design, such as an external adapter's idempotency key or reconciliation of send results. The idempotency here applies only to **storing receipt material**.

Here is the complete worker file, `src/notifications/jobs/render-receipt.worker.ts`, as well.

```typescript
import { Inject } from '@fluojs/core';
import { QueueWorker } from '@fluojs/queue';
import { ReceiptService } from '../receipt.service.js';
import { RenderReceiptJob } from './render-receipt.job.js';

@Inject(ReceiptService)
@QueueWorker(RenderReceiptJob, {
  jobName: 'shop-render-receipt-v1',
  attempts: 5,
  backoff: { type: 'exponential', delayMs: 1_000 },
  concurrency: 2,
})
export class RenderReceiptWorker {
  constructor(private readonly receipts: ReceiptService) {}

  async handle(job: RenderReceiptJob): Promise<void> {
    if (typeof job.requestId !== 'string' || job.requestId.length === 0) {
      throw new Error('Invalid receipt request ID');
    }
    await this.receipts.prepare(job.requestId);
  }
}
```

`attempts: 5` is an attempt budget that includes the first execution. It does not mean five more attempts after failure. Exponential backoff increases the interval after repeated failures, but it is not a scheduling contract to run at an exact time. Redis state, other jobs, and worker availability affect execution. `concurrency: 2` configures concurrency for one worker; it is not a global lock that limits two servers to a combined concurrency of 2.

If you catch a transient connection error and return normally, the queue treats the job as complete. That is why this code lets errors from `prepare()` propagate. Under the current public worker contract, errors that retries cannot fix, such as invalid payloads, may consume the same attempt budget. Do not add unsupported `discard()` or `retry()` methods as if they were Fluo APIs. Expose permanent failures with a low attempt budget and dead-letter observation, then let an operator fix the cause and explicitly request a rerun.

## The Gap Between PostgreSQL and Redis

We now need to find rows where `ReceiptRequest.enqueuedAt IS NULL` and enqueue them. Recording `enqueuedAt` before enqueue loses the work if enqueue fails. Recording it afterward enqueues again if the process stops in between. We choose the latter and use a stable deduplication key. Since the preceding section established business-result idempotency separately, we do not entrust all correctness to queue deduplication.

Add the following field to the previous chapter's `ReceiptRequest` model so operators can recover final failures. This is a schema change fragment, not the entire model.

```prisma
dispatchVersion Int @default(1)
```

`dispatchVersion` differs from the order version and event format version. It is an operational execution generation for enqueuing the same request. Losing the response to the initial handoff is not a reason to increase it. In that case, retry with the same generation and deduplication key. Increase it only after confirming final failure and approving a new execution.

Run `pnpm exec prisma migrate dev --name receipt_dispatch_version --create-only` with the modified model, then add the following constraint to the end of the generated SQL. Existing requests receive the default value of 1. Then run `pnpm exec prisma migrate dev` and `pnpm exec prisma generate` against the isolated DB.

```sql
ALTER TABLE "ReceiptRequest"
  ADD CONSTRAINT "ReceiptRequest_dispatchVersion_check"
    CHECK ("dispatchVersion" >= 1);
```

The following `src/notifications/receipt-dispatcher.ts` is a complete file. `ReceiptDispatchTask`, registered later, calls `enqueueNext()` a bounded number of times. `requestReplay()` is an internal administration operation accepting the expected version confirmed by an operator, not a customer-facing endpoint.

```typescript
import { Inject } from '@fluojs/core';
import { PrismaService } from '@fluojs/prisma';
import { QueueLifecycleService } from '@fluojs/queue';
import type { PrismaClient } from '@prisma/client';
import { RenderReceiptJob } from './jobs/render-receipt.job.js';

@Inject(PrismaService, QueueLifecycleService)
export class ReceiptDispatcher {
  constructor(
    private readonly db: PrismaService<PrismaClient>,
    private readonly queue: QueueLifecycleService,
  ) {}

  async enqueueNext(): Promise<boolean> {
    const request = await this.db.current().receiptRequest.findFirst({
      where: { enqueuedAt: null, completedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (!request) return false;
    await this.queue.enqueue(new RenderReceiptJob(request.id), {
      deduplicationKey:
        `receipt:${request.id}:dispatch:${request.dispatchVersion}`,
    });
    await this.db.current().receiptRequest.updateMany({
      where: {
        id: request.id,
        dispatchVersion: request.dispatchVersion,
        enqueuedAt: null,
      },
      data: { enqueuedAt: new Date() },
    });
    return true;
  }

  async requestReplay(id: string, expectedDispatchVersion: number): Promise<boolean> {
    const changed = await this.db.current().receiptRequest.updateMany({
      where: {
        id,
        completedAt: null,
        enqueuedAt: { not: null },
        dispatchVersion: expectedDispatchVersion,
      },
      data: {
        dispatchVersion: { increment: 1 },
        enqueuedAt: null,
      },
    });
    return changed.count === 1;
  }
}
```

Two dispatchers can read the same row concurrently. Rather than holding a DB lock during the Redis call, this example allows repeated enqueue with the same key. The package maps `deduplicationKey` to a deterministic job ID valid for BullMQ, so business keys containing colons are supported too. The conditional update afterward prevents a slow dispatcher from incorrectly overwriting `enqueuedAt` for a new execution generation.

Deduplication is a property of job identity retained in the queue, not a permanent store of business idempotency. If the existing job is deleted or Redis data is lost, the same key can execute again. Conversely, if a finally failed job remains, do not assume that simply enqueuing the same key creates a new execution. This is why we separate execution generations. Even if an old job for a new generation runs late, the `completedAt` condition on result persistence prevents a duplicate effect.

We have not introduced a distributed transaction joining the DB and Redis. Losing Redis's response can fail the dispatcher call, but the next run uses the same key. If Redis permanently loses data while `enqueuedAt` remains, the automatic search for new handoffs will not find that request. Observe how long unfinished requests remain, reconcile against queue state to confirm lost execution, and then approve a new generation. Calling a queue durable does not establish Redis's actual persistence settings, backups, or disaster recovery policy for you.

## Registration That Reuses Existing Connections

Keep one root Redis registration and one Queue registration per application. If Volume 1's default registration already exists, the following fragment checks or adjusts its settings rather than adding another registration. Keep existing blog job providers as well. The current API shape for the imports in `src/app.ts` is as follows.

```typescript
import { QueueModule } from '@fluojs/queue';
import { RedisModule } from '@fluojs/redis';

const jobInfrastructure = [
  RedisModule.forRoot({
    host: '127.0.0.1',
    port: 6379,
    lifecycle: { connectTimeoutMs: 10_000, quitTimeoutMs: 10_000 },
  }),
  QueueModule.forRoot({
    workerShutdownTimeoutMs: 30_000,
    defaultDeadLetterMaxEntries: 1_000,
  }),
];
```

Spread the value above only when replacing the two existing Redis and Queue registrations in the root imports with `...jobInfrastructure`. This is not a procedure for adding the array alongside existing registrations. The address is an example for your local isolated Redis; actual deployments pass options established by the existing configuration boundary. `RedisModule.forRootAsync` and registration that accepts an already created client are not currently supported APIs. Fluo's Redis registration creates a new ioredis client from options and owns its connection lifecycle. Creating the default registration twice is not a supported way to share it either.

Keep the single `BlogDatabaseModule` from `src/database/blog-database.module.ts` already imported by the root. The relay, dispatcher, and worker's service share the global `PrismaService` created by `forRootAsync` using `AppSettings`. Do not add a DB wrapper or Prisma registration in NotificationsModule. Queue job execution and the ledger's payment transaction occur at different times, but persistent requests in the same store connect them.

The following **complete file**, `src/notifications/receipt-dispatch-task.ts`, is the actual owner of handoff execution. Let the existing Cron registration discover the singleton provider. Its runs are separate from `PaidOutboxTask`, so an event publication failure does not prevent an already created request from being enqueued.

```typescript
import { Inject } from '@fluojs/core';
import { Cron, CronExpression } from '@fluojs/cron';
import { ReceiptDispatcher } from './receipt-dispatcher.js';

@Inject(ReceiptDispatcher)
export class ReceiptDispatchTask {
  constructor(private readonly dispatcher: ReceiptDispatcher) {}

  @Cron(CronExpression.EVERY_MINUTE, {
    name: 'notifications.receipt-dispatch',
    timezone: 'UTC',
  })
  async run(): Promise<void> {
    for (let processed = 0; processed < 100; processed += 1) {
      if (!(await this.dispatcher.enqueueNext())) break;
    }
  }
}
```

Scheduled runs start outside a transaction and do not keep a DB transaction open while waiting for Redis. The first run after restart searches `ReceiptRequest` too, so an `@OnEvent` notification is not the starting condition. Which of the two tasks runs first in the same minute does not affect consistency. If a request does not yet exist, the next run finds it.

Merge the following providers into the previous chapter's relay registration in `src/notifications/notifications.module.ts`. The existing `PaidOutboxRelay` still needs the global Prisma and event-bus for injection.

```typescript
import { Module } from '@fluojs/core';
import { PaidOutboxRelay } from './paid-outbox-relay.js';
import { PaidOutboxTask } from './paid-outbox-task.js';
import { ReceiptDispatcher } from './receipt-dispatcher.js';
import { ReceiptDispatchTask } from './receipt-dispatch-task.js';
import { ReceiptService } from './receipt.service.js';
import { RenderReceiptWorker } from './jobs/render-receipt.worker.js';

@Module({
  providers: [
    PaidOutboxRelay, ReceiptService, ReceiptDispatcher, RenderReceiptWorker,
    PaidOutboxTask, ReceiptDispatchTask,
  ],
  exports: [PaidOutboxRelay, ReceiptDispatcher],
})
export class NotificationsModule {}
```

One worker owns a given job class and `jobName`. Creating different workers for different features with the same name can cause a duplicate ownership error during bootstrap rather than create competing consumers. The default global queue discovers singleton workers in the application graph. Do not make a worker request-scoped or omit it from `providers`.

Queue does not dedicate the shared Redis client directly to workers; it creates duplicate connections for BullMQ. Queue closes those duplicates, while the Redis module closes the shared connection. The application breaks that ownership if it arbitrarily calls `quit()` on the shared client first. During shutdown, Queue rejects new enqueue calls, waits for graceful worker shutdown, and attempts forced shutdown if necessary. Graceful and forced shutdown each have a time budget, so do not treat `workerShutdownTimeoutMs` as the sole upper bound on total process shutdown.

## Reading Dead Letters and Approving New Execution Separately

Final failures leave separate records in a Redis dead-letter list. The BullMQ job is not moved into that list. The following is a method-body fragment in an operations service with `QueueLifecycleService` injected. It uses only the public inspection API and does not interpret internal Redis keys directly.

```typescript
const inspection = await this.queue.inspectDeadLetters(
  'shop-render-receipt-v1',
  { limit: 25 },
);
return {
  malformedRecordCount: inspection.malformedRecordCount,
  records: inspection.records.map(record => ({
    jobId: record.jobId,
    attemptsMade: record.attemptsMade,
    failedAt: record.failedAt,
    errorMessage: record.errorMessage,
  })),
};
```

The returned payload is `unknown`, not a new job that an administration tool should execute unchanged. We leave it out of the output here. Connect the latest failure record to the unfinished PostgreSQL request, fix the cause, and then call `requestReplay()` with the confirmed `dispatchVersion`. If two administration requests supply the same expected version, only one increases the generation. If the request is already complete, nothing changes. Apply the existing operator authorization checks and requester/reason logging at the actual administration boundary; do not wire this internal method directly to a public customer route.

By default, dead letters retain only the latest 1,000 records per job, and the inspection limit has an upper bound too. An empty result is not evidence that no past failures occurred. Invalid stored values are skipped and exposed through `malformedRecordCount`. Inspection can also fail when Redis is shut down. Distinguish the fact that package inspection does not start workers from a claim that it guarantees Redis accessibility.

## Failure Experiments That Do Not Depend on Timing Luck

First verify idempotency of DB result persistence. Prepare one request with `completedAt: null` in the isolated PostgreSQL from the previous chapter and call the actual `ReceiptService.prepare(id)` twice concurrently. Both calls should complete normally, and the body should contain the same snapshot. Read the completion time, then call it a third time; the completion time should remain unchanged too. The following is a test-body fragment with a DB connection and fixture. `receipts` is the actual service, `db` is the PrismaService for the same test DB, and `id` is the fixture request ID.

```typescript
await Promise.all([receipts.prepare(id), receipts.prepare(id)]);
const first = await db.current().receiptRequest.findUniqueOrThrow({
  where: { id },
});
expect(first.completedAt).not.toBeNull();
if (first.body === null) throw new Error('Receipt body was not persisted');
expect(JSON.parse(first.body)).toMatchObject({
  requestId: id,
  orderVersion: first.orderVersion,
  currency: 'KRW',
  totalMinor: '29000',
});
await receipts.prepare(id);
const second = await db.current().receiptRequest.findUniqueOrThrow({
  where: { id },
});
expect(second.completedAt).toEqual(first.completedAt);
expect(second.body).toBe(first.body);
```

The queue integration experiment uses a separate Redis and PostgreSQL. Configure a test replacement provider for `ReceiptService` to throw explicitly on the first two calls and invoke the real `prepare()` on the third. Create a deferred Promise that resolves after successful persistence **before enqueue**, and have the test await that completion signal within a timeout. Sleeping for roughly three seconds and then checking the DB can fail in a slow environment or pass without observing retries. The expected result of this experiment is three attempts, one body, and the same request ID.

Next control the dispatcher's boundary where enqueue has completed but the DB marker has not been written. **Before the first enqueue**, create both a release Promise that the test worker will await just before entering the actual `ReceiptService.prepare()`, and a completion Promise resolved after persistence. Make the test queue facade return an error exactly once after performing the real enqueue to model a lost response. The first `enqueueNext()` should fail and leave `enqueuedAt` empty. Since the worker waits at the barrier, `completedAt` is still `null` as well. In this state, verify that the second `enqueueNext()` uses the same deduplication key and returns the same job identity. Then release the barrier and await the actual persistence completion signal within the test timeout. Release the barrier in `finally` too, so an assertion failure cannot hold the worker. Without the barrier, the worker might complete first and cause the second query to exclude the request, making the experiment's requirement to enqueue again with the same key depend on execution speed. A mock that does not actually enqueue, or replaces actual persistence, has not verified this gap.

For the final-failure scenario, make the worker fail on every attempt. Observe the final failure event or completion of the dead-letter write through an explicit signal from the test double, then verify `attemptsMade`, the job name, and the failure reason in the inspection result. Remove the cause and request a new generation. `dispatchVersion` should increase by one, and the job running under the new key should complete the same `ReceiptRequest`. This specification is a procedure to run in your integration environment; actual Redis retry and forced shutdown experiments were not run during manuscript preparation.

## Boundaries Matter More Than Retry Counts

Many successful retries can make a system look resilient, but multiplying continually failing jobs five times every second amplifies an incident. Look at throughput, the number of old unfinished requests, time from first attempt to completion, and final failure counts together. Even if Queue is ready, old unfinished requests accumulating in PostgreSQL mean customers' work is not progressing. Conversely, a remaining dead-letter record may belong to a request already recovered in a new generation, so interpret it alongside the business result.

Not every small, fast synchronous DB update needs a queue. Use one for work that need not be awaited, must run again after failure, and has a reason to separate execution resources. Here, Outbox/Inbox preserves intent, the dispatcher makes Redis handoff repeatable, and the worker stores the completed result idempotently. The key is not covering one of these three layers with another layer's supposed guarantee.

The next requirement comes from reads, not execution. Customers want to see their order progress, while operators want payment and preparation status in one list. Putting every screen requirement into the model that changes orders complicates the write boundary. The next chapter separates commands and queries while applying the responsibilities for duplicates, reordering, and recovery we have just learned to the projection as well.

## Implementation References

- [Queue registration, producer, retry, and dead-letter contracts](../../packages/queue/README.md)
- [Queue public exports](../../packages/queue/src/index.ts), [worker and enqueue options](../../packages/queue/src/types.ts)
- [JSON serialization, job ID, and worker execution implementation](../../packages/queue/src/service.ts)
- [Discovery, retry option, and duplicate key contract tests](../../packages/queue/src/module.test.ts)
- [Dead-letter reading and retention implementation](../../packages/queue/src/dead-letter-manager.ts), [inspection tests](../../packages/queue/src/dead-letter-manager.test.ts)
- [Redis registration and connection ownership](../../packages/redis/README.md), [public exports](../../packages/redis/src/index.ts)
- [The transaction handing off from Outbox to Inbox and requests](./ch14-outbox-and-inbox.md), [Cron discovery and shutdown contracts](../../packages/cron/README.md)

[Previous: What If the Save Succeeded but the Event Disappeared?](./ch14-outbox-and-inbox.md) | [Volume 2 Contents](./toc.md) | [Next: Write Models and Read Models Develop Different Needs](./ch16-cqrs-projections.md)
