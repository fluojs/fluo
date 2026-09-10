# Reconciling Interrupted Orders

<!-- book:volume=02-fluoshop;chapter=12 -->

[Previous: Cancellation and Refunds Are Not an Undo Button](./ch11-refunds-and-compensation.md) - [Volume 2 Contents](./toc.md) - [Next: Notifying Other Features of Order Completion](./ch13-domain-events.md)

## The Process Waiting for Success Disappeared

On the day a new post becomes popular, orders also pour into FluoBlog's shop. The old process exits during deployment, and the next day the operator discovers two orders. The first succeeded at the provider but is still `pending_payment` in the shop. The second is `refund_pending` and has a refund request, but its execution record never reached completion. Fixing the HTTP error does not move either order forward on its own.

The previous three chapters left records to investigate even after an interruption. Payment attempt keys were saved before charging, webhook receipts committed together with order changes, and refunds became operations with stable IDs. Now we need something responsible for reading those records again. Reconciliation is not a bulk UPDATE that turns old rows into successes. It compares local state with externally observed facts and reapplies the transition rules already established.

Nor is reconciliation magic that eliminates every customer inquiry. Automatic judgment must stop when the provider's lookup is ambiguous or the amount differs. The important distinction is whether an interrupted order remains abandoned and unknown, or moves into an inspectable worklist with a next action. Run this path even on days without incidents, so that recovery code is not used for the first time on the day of a failure.

This chapter adds scheduled work inside the same application. We do not yet extract the fulfillment service or introduce a new broker. `@fluojs/cron` is responsible for when to call a method; the application is responsible for which orders to investigate and how to apply the results. The schedule and the record of business progress have different owners.

## Different States Require Different Questions

A payment attempt in `prepared` means that the DB save completed. It is not evidence that the external call began. `pending` is neither final approval nor final decline. Both are candidates for lookup, but a missing lookup result must not cause an order cancellation or a charge with a new key. If a `succeeded` record is available, however, its amount, currency, and original payment identifier can be validated and passed to the earlier PaymentLedger.

A refund in `pending` may not yet have been executed externally, or it may have succeeded externally without local completion being applied. The previous chapter established that calling again with the same refund key returns the same operation result, so `RefundService.execute()` can run again within the permitted period. Reconciliation code does not need to implement the refund API directly or adjust inventory separately.

Keep `review` separate from the automatic retry list. Retrying an order with an observed amount mismatch every minute does not make the amount correct. Query payment-attempt `review`, refund `review`, and PaymentInbox `review` together in the operational review lists. A contradiction may remain only in the Inbox while the attempt itself is successful, so querying attempt state alone misses cases requiring investigation.

Our automatic retry policy uses five-minute intervals within 24 hours of creation. These are policy values for the local provider experiment, not a guarantee shared by all providers. If a real vendor's key retention or supported lookup period is shorter, the automatic execution window must be shorter too. Refunds past that window move to `review` rather than being executed with a new key. The operator verifies the facts before deciding how to finish the existing operation.

## Reading the Next Records to Check, Not Every Order

Reading every `pending_payment` order each minute would include cart-like orders whose payment has not started. Read from PaymentAttempt, where payment intent is stored. Use the `state`, `createdAt`, `nextCheckAt`, and composite index created earlier. Likewise, use RefundRequest for refunds.

Each run reads at most 25 payments and 25 refunds. Sort by `nextCheckAt` and then `id` to give rows with equal timestamps a fixed order. An unbounded full scan can overrun the next scheduled execution, and an always-failing first order can block the orders behind it. Moving `nextCheckAt` forward lets the next batch start with older rows not yet investigated.

Multiple processes can read the same candidate, so immediately before execution, update `nextCheckAt` conditionally on its previous value. Once one executor changes the time, other executors skip that candidate. This is only a short claim that reduces call frequency, not a complete distributed lock. If a call takes more than five minutes, another executor may take over again. External idempotency keys and conditional DB transitions must still guarantee correctness.

Even if the process exits immediately after updating the claim time, the record does not disappear. It becomes a candidate again five minutes later. That is why this timestamp must not be used as a "processing complete" marker. Using the last execution time in process memory rather than durable state would forget interrupted work on every deployment.

## A Reconciliation Service Using the Same Transition Functions

The following `src/payments/payment-reconciler.ts` is a **complete service file**. It uses Chapter 10's PaymentAttempt and PaymentLedger and Chapter 11's RefundRequest and RefundService. The default PrismaService is the same global registration from the root `BlogDatabaseModule`, and `PAYMENT_GATEWAY` is the payment lookup port from Chapter 9. The clock is injected through an actual token so that tests can fix its value.

```ts
import { Inject } from '@fluojs/core';
import { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import {
  PAYMENT_GATEWAY, type PaymentGateway,
} from './payment-gateway.js';
import { PaymentLedger } from './payment-ledger.js';
import { RefundService } from './refund-service.js';

export const RECONCILIATION_CLOCK = Symbol('RECONCILIATION_CLOCK');
export type ReconciliationClock = () => Date;

export type ReconciliationReport = {
  checked: number;
  applied: number;
  review: number;
  errors: number;
};

@Inject(PrismaService, PAYMENT_GATEWAY, PaymentLedger, RefundService,
  RECONCILIATION_CLOCK)
export class PaymentReconciler {
  constructor(
    private readonly db: PrismaService<PrismaClient>,
    private readonly gateway: PaymentGateway,
    private readonly ledger: PaymentLedger,
    private readonly refunds: RefundService,
    private readonly clock: ReconciliationClock,
  ) {}

  async runBatch(): Promise<ReconciliationReport> {
    const now = this.clock();
    const next = new Date(now.getTime() + 300_000);
    const oldestAutomatic = new Date(now.getTime() - 86_400_000);
    const report: ReconciliationReport = {
      checked: 0, applied: 0, review: 0, errors: 0,
    };
    const db = this.db.current();
    const payments = await db.paymentAttempt.findMany({
      where: {
        state: { in: ['prepared', 'pending'] },
        nextCheckAt: { lte: now },
      },
      orderBy: [{ nextCheckAt: 'asc' }, { id: 'asc' }],
      take: 25,
    });

    for (const candidate of payments) {
      try {
        const claim = await db.paymentAttempt.updateMany({
          where: {
            id: candidate.id, state: { in: ['prepared', 'pending'] },
            nextCheckAt: candidate.nextCheckAt,
          },
          data: { nextCheckAt: next },
        });
        if (claim.count !== 1) continue;
        report.checked += 1;
        if (candidate.createdAt <= oldestAutomatic) {
          const moved = await db.paymentAttempt.updateMany({
            where: {
              id: candidate.id, state: { in: ['prepared', 'pending'] },
              nextCheckAt: next,
            },
            data: { state: 'review', reviewReason: 'automatic_window_elapsed' },
          });
          report.review += moved.count;
          continue;
        }
        const observed = await this.gateway.lookup(candidate.id);
        if (!observed) continue;
        const decision = await this.ledger.recordObservation(candidate.id, observed);
        if (decision === 'applied') report.applied += 1;
        if (decision === 'review') report.review += 1;
      } catch {
        report.errors += 1;
        console.warn('reconcile_item_failed', {
          kind: 'payment', id: candidate.id,
        });
      }
    }

    const refunds = await db.refundRequest.findMany({
      where: { state: 'pending', nextCheckAt: { lte: now } },
      orderBy: [{ nextCheckAt: 'asc' }, { id: 'asc' }],
      take: 25,
    });
    for (const candidate of refunds) {
      try {
        const claim = await db.refundRequest.updateMany({
          where: {
            id: candidate.id, state: 'pending',
            nextCheckAt: candidate.nextCheckAt,
          },
          data: { nextCheckAt: next },
        });
        if (claim.count !== 1) continue;
        report.checked += 1;
        if (candidate.createdAt <= oldestAutomatic) {
          const moved = await db.refundRequest.updateMany({
            where: { id: candidate.id, state: 'pending', nextCheckAt: next },
            data: { state: 'review', reason: 'automatic_window_elapsed' },
          });
          report.review += moved.count;
          continue;
        }
        await this.refunds.execute(candidate.id, now);
        const current = await db.refundRequest.findUniqueOrThrow({
          where: { id: candidate.id },
        });
        if (current.state === 'succeeded') report.applied += 1;
        if (current.state === 'review') report.review += 1;
      } catch {
        report.errors += 1;
        console.warn('reconcile_item_failed', {
          kind: 'refund', id: candidate.id,
        });
      }
    }
    return report;
  }
}
```

This method does not run inside a DB transaction. The `db` variable is for the batch's ordinary queries; PaymentLedger and RefundService each open their own transactions to apply state changes. Even when a webhook and scheduled job reach the same order, amount checks and allowed transition rules remain the same because we have not created a second state machine.

Both Chapter 9's coordinator and this batch call `PaymentLedger.recordObservation(expectedAttemptId, observed)`. That method creates an internal event from a hash of the expected attempt ID and the facts actually observed, then passes it to `record`. Even a `pending` lookup validates identifiers and amounts, so an incorrect attempt is not ignored merely because it is "still waiting." If a different attempt ID is returned, the expected attempt becomes `review`, and the Inbox preserves the ID and amount actually observed. Time is not included in the event ID, so the same fact does not become a new event every minute.

A success observation passes through `record -> OrderInventoryService.confirmPayment -> OrderTransitionsService.apply / InventoryService.settle`. Valid reservations become `consumed` without deducting quantities again. Success with an expired or missing reservation becomes `review`, not a state eligible for shipping. Refunds use the compensation record and `apply` inside `RefundService.execute`. Reconciliation itself contains neither an order-status UPDATE nor code to add or subtract inventory.

The `reconcile:` prefix is reserved for internal events. Chapter 10's external webhook input schema rejects it because external eventIds and internal IDs share the same Inbox space. If supporting multiple real providers, it is better to include both the provider and event source explicitly in the schema's composite key. These four chapters limit their scope to one local provider.

A missing lookup result does not trigger another charge. Under this policy, an attempt interrupted before its first call does not complete automatically; it moves to review after 24 hours. This is not a missing implementation. It separates the decision to move money anew from lookup-based recovery. The operator confirms that the provider truly has no history for that key, then either approves retransmission of the same operation within the key retention contract or chooses the unpaid-order cancellation procedure. Charging an order with an uncertain outcome under a new key is not an option.

We catch an individual item's error and move to the next item, but do not disguise the error as success. The report's `errors` count and the item identifier remain, and the item becomes a candidate again when its check time arrives. If the DB itself is unavailable and even candidate lookup fails, the method fails and Cron's error path records it. We do not log the original error verbatim here. Operational code can also record an error classification with secrets removed and a trace ID.

The `applied` count is not a payment revenue total. It counts how many completed applications this run observed; concurrent runs may both observe completion of the same refund. Accounting totals must use the unique identifiers of successful durable payment and refund rows. Keeping operational counters distinct from business facts is part of reconciliation too.

## Cron Does Not Store Business Progress

The following is the **complete file** `src/payments/reconciliation-task.ts`. Use a public instance method so the scheduler can discover it, and register it with the default singleton scope. Do not inject a customer request's request scope or authentication context.

```ts
import { Inject } from '@fluojs/core';
import { Cron, CronExpression } from '@fluojs/cron';
import { PaymentReconciler } from './payment-reconciler.js';

@Inject(PaymentReconciler)
export class ReconciliationTask {
  constructor(private readonly reconciler: PaymentReconciler) {}

  @Cron(CronExpression.EVERY_MINUTE, {
    name: 'payments.reconcile',
    timezone: 'UTC',
  })
  async run(): Promise<void> {
    const report = await this.reconciler.runBatch();
    console.info('payments_reconciliation', report);
  }
}
```

The following are the **imports and metadata fragments to merge into PaymentsModule**. Preserve the ConfigModule, OrdersModule, payment and refund providers, three controllers, and exports from Chapters 9, 10, and 11. Volume 1 already registered CronModule for scheduled publishing in PostsModule, so do not call `CronModule.forRoot()` again here. Task provider discovery examines the app module graph, and this task does not inject a registry token directly.

```ts
import {
  PaymentReconciler, RECONCILIATION_CLOCK,
} from './payment-reconciler.js';
import { ReconciliationTask } from './reconciliation-task.js';
```

```ts
providers: [
  { provide: RECONCILIATION_CLOCK, useValue: () => new Date() },
  PaymentReconciler,
  ReconciliationTask,
],
exports: [PaymentReconciler],
```

Set `shutdown: { timeoutMs: 5_000 }` on the existing CronModule registration at its one original assembly point as well. CronModule has local visibility by default. Choose an import/export structure or explicit `global: true` only when another module needs to inject a registry token directly. For the DB, the root also reuses the asynchronous global registration object in Volume 1's `src/database/blog-database.module.ts`. Do not create a batch-specific connection or a separate PrismaService.

While the same task instance is running, Fluo skips the next tick instead of queuing it. There is no need to add an option called `waitForCompletion`, nor is there a public contract allowing it. The default scheduler's no-overlap protection and the runtime's running guard provide this behavior. Skipped ticks are not durably retained, but our incomplete rows remain in the DB, so the next tick finds them again.

Two servers have two task instances. In that case, in-process protection alone cannot justify claiming a single execution. The current code reduces duplicate lookups by updating the check time in the DB, and protects outcomes through state transitions. If lookup costs grow, you can enable Cron's Redis distributed lock, but that does not automatically create a new Redis connection. Configure a real RedisModule registration together with the supported `distributed` options.

A distributed lock cannot replace payment correctness either. If lock renewal fails, or a process resumes after a long pause, an old executor may finish an external call. A guarantee that unlocking compares the ownership token differs from a guarantee that an already-started external refund is revoked. The boundaries in this book first make duplicate execution safe without a lock, then use a lock to reduce cost.

During shutdown, Cron closes admission for new ticks and waits a bounded amount of time for running work. Once `shutdown.timeoutMs` elapses, it may warn and continue shutdown. That does not mean it forcibly cancelled a JavaScript Promise or rolled back DB changes. The batch above limits only the maximum item count. The payment adapter must separately own timeouts for actual network calls; the number 50 is not an upper bound on total execution time.

In production, design provider call timeouts together with the deployment shutdown budget. If a DB transaction is open, Prisma's shutdown drain matters too. More important than keeping the process alive until the end is the final line of defense: whichever boundary interrupts execution, the intent and key remain for the next process to read.

## Testing the Scheduler Without Waiting

A test that waits a real minute is slow and misses races. CronModule exposes a public `scheduler` injection point, so we can use a small scheduler that triggers ticks directly. The following `src/payments/reconciliation-scheduling.test.ts` is a **complete test file** checking the scheduling contract without a DB. Keep it separate from tests of the business service's `runBatch()`.

```ts
import { Inject, Module } from '@fluojs/core';
import {
  Cron, CronModule, type CronScheduler, type CronScheduleOptions,
} from '@fluojs/cron';
import { FluoFactory } from '@fluojs/runtime';
import { expect, it } from 'vitest';

it('skips an overlapping tick and stops on close', async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let calls = 0;
  let stopped = false;
  let tick: (() => Promise<void>) | undefined;
  let captured: CronScheduleOptions | undefined;
  const scheduler: CronScheduler = (_expression, options, callback) => {
    captured = options;
    tick = callback;
    return { stop() { stopped = true; } };
  };
  const WORK = Symbol('WORK');
  type Work = () => Promise<void>;

  @Inject(WORK)
  class BlockingReconciliationTask {
    constructor(private readonly work: Work) { }

    @Cron('* * * * *', { name: 'payments.reconcile', timezone: 'UTC' })
    async run(): Promise<void> {
      await this.work();
    }
  }

  @Module({
    imports: [CronModule.forRoot({ scheduler })],
    providers: [
      {
        provide: WORK,
        useValue: async () => {
          calls += 1;
          entered.resolve();
          await release.promise;
        },
      },
      BlockingReconciliationTask,
    ],
  })
  class TestModule { }

  const app = await FluoFactory.create(TestModule);
  let active: Promise<void> | undefined;
  try {
    expect(captured).toMatchObject({ protect: true, timezone: 'UTC' });
    if (!tick) throw new Error('Scheduler did not register a task');
    active = tick();
    await entered.promise;
    await tick();
    expect(calls).toBe(1);
    release.resolve();
    await active;
    await tick();
    expect(calls).toBe(2);
  } finally {
    release.resolve();
    await active;
    await app.close();
  }
  expect(stopped).toBe(true);
  if (tick) await tick();
  expect(calls).toBe(2);
}, 5_000);
```

Create the task-entry signal before the first tick. Since the second tick is called after the first task has actually entered, the result does not depend on CPU speed. The five-second limit for the whole test is a cap that prevents an infinite wait on failure, not a sleep that lets time pass to achieve success. Even directly invoking a callback that was already queued before shutdown must not start new work afterward.

In your app, run `pnpm exec vitest run src/payments/reconciliation-scheduling.test.ts`. Use the existing test environment configured with the standard decorator transform. This test file was not created in the app and executed during manuscript preparation; it is an experiment describing the expected behavior.

Business recovery tests require PostgreSQL and a provider double whose records persist. Replace `RECONCILIATION_CLOCK` with a value provider returning a fixed time, then check the following.

| Prepared interruption point | Expected observation after `runBatch()` |
| --- | --- |
| Local attempt `prepared`, complete valid reservations, provider double successful, no webhook | Order `paid`, attempt `succeeded`, one internal Inbox row, reservations `consumed`, one audit row, and no change in saleable units |
| Call the same batch again at the same time | No additional order transition and no new external charge |
| Recreate the process after saving refund intent | Execution uses the existing ID; refund, audit, and compensation records complete; available increases once, and reservations remain consumed |
| Interrupt execution immediately after updating a candidate's check time | No takeover before five minutes; advancing the injected time by five minutes makes it a candidate again |
| Lookup returns a different payment attempt | No order change; the expected attempt is `review`, and the actually observed ID remains in Inbox.facts |
| Successful lookup with expired, missing, or released reservations | `record` preserves a specific reason and success evidence; no `paid` state or shipping instruction |
| Attempt is exactly 24 hours old or older | `review` without an external charge; it remains in the operational list with the automatic_window_elapsed reason |
| Two batches initially read the same candidate | Only one succeeds in updating the check time, or the final business transition still occurs once despite duplicate execution |
| One candidate's lookup throws an exception | `errors` increases; later candidates are still investigated, and the failed candidate can be checked again later |

Do not wait for the real clock in experiments that advance time. Align the Date returned by the clock provider with the candidate's `nextCheckAt`, and check just before, exactly at, and just after the boundary. In restart tests, recreate only the shop's container and preserve records in the test DB and provider double. You cannot reset all memory at once and then claim that recovery succeeded.

## Leaving Results an Operator Can Read

One successful reconciliation log line does not finish the operational work. Track the age of the oldest incomplete operation and the current batch's checked, applied, error, and review counts. If the oldest operation keeps aging while execution counts steadily grow, automatic recovery is missing something that needs attention. Conversely, a checked count of zero may be normal if no candidates exist.

During review, the operator must be able to follow an order ID through the payment attempt ID, provider's original payment ID, refund ID, and Inbox event ID. Do not change order status immediately based only on a screenshot of the customer's card statement. Check the amount, currency, and shop reference through provider lookup, check for refunds or shipments already applied, and then select a state transition. Record the reason for the correction and the responsible operator too. Reconciliation compares what is read; moving money anew or repairing state is a separate, authorized business operation.

The following is **review-list SQL** to run through a read-only connection with operational permissions. Amounts in JSON remain decimal strings. Read all three lists: when a contradictory additional event arrives for a successful attempt, the attempt may remain `succeeded` while only the Inbox is `review`.

```sql
SELECT "id", "orderId", "paymentId", "reviewReason", "createdAt"
FROM "PaymentAttempt" WHERE "state" = 'review' ORDER BY "createdAt", "id";

SELECT "provider", "eventId", "attemptId", "facts", "reason", "receivedAt"
FROM "PaymentInbox" WHERE "decision" = 'review'
ORDER BY "receivedAt", "provider", "eventId";

SELECT "id", "orderId", "paymentId", "reason", "observedResult", "createdAt"
FROM "RefundRequest" WHERE "state" = 'review' ORDER BY "createdAt", "id";
```

We do not provide a generic UPDATE to clear `review` or an API to force an order without inventory into `paid`. A cancelled order that received a late payment requires a separate authorized financial operation after fact verification. Do not force it through this chapter's automatic refund path for normally paid orders before shipment. Review evidence remains even before resolution, and resending the same event does not switch it to automatic application.

This single batch is enough when order volume is small. If incomplete operations grow in number and provider call limits are low, design batch size, check intervals, per-key serialization, and work queues together. Merely setting a shorter cron expression sends more requests into the same external failure. Limiting the investigation workload with indexes and next-check times comes before making every full scan faster.

Now, even if a webhook never arrives or a process exits partway through, we can find interrupted records and reconcile them using the existing business rules, or hand them over explicitly for review. The next chapter sends payment completion facts to other features, such as fulfillment and notifications. The next task is to build events on top of the consistency boundaries established here without mistaking in-process event delivery for durable recovery.

The extension point for subsequent chapters is the successful branch after `await this.inventory.confirmPayment(...)` inside `PaymentLedger.record` in `src/payments/payment-ledger.ts`. Preserve the `prepare/record` names and the coordinator's save -> external call -> record sequence. `applied` is also returned when recording a decline, so do not create a payment completion event based only on the returned string. The next chapter publishes its event after committing a new `paid` transition; the chapter after that inserts an Outbox entry in this very success branch's transaction. Do not create shipping or payment completion facts from `review`, duplicates, or declines.

## Sources and Verification Scope

- [Cron README](../../packages/cron/README.md), [public exports](../../packages/cron/src/index.ts), [public scheduler types](../../packages/cron/src/types.ts): expressions, local registration, `scheduler`, shutdown options, and supported scope.
- [Cron module implementation](../../packages/cron/src/module.ts), [scheduling lifecycle](../../packages/cron/src/service.ts), [task runner](../../packages/cron/src/task-runner.ts): rejecting ticks during execution, DI resolution, error handling, and shutdown boundaries.
- [Cron module tests](../../packages/cron/src/module.test.ts): source evidence for manual scheduler injection, module discovery, time zones, no-overlap options, and shutdown experiments.
- [Prisma README](../../packages/prisma/README.md), [shutdown drain tests](../../packages/prisma/src/shutdown-drain-status.test.ts): the relationship between in-flight DB work and shutdown.
- [Webhook application boundary](./ch10-payment-webhooks.md), [refund execution boundary](./ch11-refunds-and-compensation.md): application code reused by reconciliation.

The scheduler's public contract was compared with its implementation. No claim is made that this chapter's batch service, PostgreSQL interruption experiments, real provider lookups, or multiprocess behavior were verified by execution. Scheduler tick protection and monetary idempotency are different guarantees.

[Previous: Cancellation and Refunds Are Not an Undo Button](./ch11-refunds-and-compensation.md) - [Volume 2 Contents](./toc.md) - [Next: Notifying Other Features of Order Completion](./ch13-domain-events.md)
