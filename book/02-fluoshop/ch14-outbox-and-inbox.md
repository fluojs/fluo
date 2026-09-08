# What If the Save Succeeded but the Event Disappeared?

<!-- book:volume=02-fluoshop;chapter=14 -->

[Previous: Notifying Other Features That an Order Has Been Paid](./ch13-domain-events.md) | [Volume 2 Contents](./toc.md) | [Next: Running Failed Jobs Again](./ch15-reliable-jobs.md)

## The Line After Commit May Never Run

On the Friday T-shirt sales began, deployment shutdown overlapped with payment webhook processing. The order was saved as `paid`, but the process ended before publishing the event. The customer has a correctly paid order, and reconciliation with the payment provider reveals no discrepancy to the operator. What is missing is not the payment, but the responsibility to prepare its receipt notification. The in-process events from the previous chapter leave no publication record to find after a restart. More precise exception handling cannot recover a next line that never ran.

Writing to two stores in sequence does not solve this problem. Save the order first and then put an event in Redis, and the process can die between those calls. Put it in Redis first, and a consumer may believe payment is complete even though the order transaction rolled back. An API that makes the database and network queue look like one local transaction still leaves the gap. We must specify which responsibility is recorded first, and in which store.

Our shop is still a modular monolith using the same PostgreSQL database. We use that condition to save the order and "the fact to be delivered" in one transaction. This is an Outbox. In the receiving feature, an Inbox records that "this consumer received this fact and created this follow-up responsibility." Fluo does not generate these tables automatically, nor does registering `EventBusModule` or `PrismaModule` create this functionality. In this chapter, we write application-owned tables and actual transaction code.

## A Schema That Distinguishes Delivery from Business Completion

This chapter has one consumer: `notifications.receipt.v1`. It only stores the intent to prepare a receipt for a confirmed payment; it does not send email or call a payment provider. The name identifies a logical consumer in the notification feature, not a server instance ID. Even with two servers, duplicate detection must use the same consumer. Conversely, if fulfillment preparation consumes the same event, it needs a different name and its own processing history.

The following contains the **complete definitions of three models** to add to `prisma/schema.prisma`. It is not a replacement for the entire schema, including the existing datasource, generator, accounts, `ProductVariant`, orders, order items, `Stock`, `Reservation`, and payment and refund models. Keep `Order` from Chapter 6 and add the one inverse relation line specified below to the existing `OrderTransition`. IDs are strings, `totalMinor` is Prisma `BigInt`, corresponding to PostgreSQL `bigint`, and versions are `Int`. The payment Outbox's `orderVersion` is the version after applying an actual payment transition to an order whose version starts at 0.

```prisma
model PaidOrderOutbox {
  id           String   @id
  orderId      String
  customerId   String
  orderVersion Int
  currency     String
  totalMinor   BigInt
  occurredAt   DateTime @default(now())
  deliveredAt  DateTime?
  transition   OrderTransition @relation(fields: [orderId, orderVersion], references: [orderId, version], onDelete: Restrict)
  receipt      ReceiptRequest?

  @@unique([orderId, orderVersion])
  @@index([deliveredAt, occurredAt, id])
}

model EventInbox {
  consumer   String
  eventId    String
  receivedAt DateTime @default(now())

  @@id([consumer, eventId])
}

model ReceiptRequest {
  id           String   @id
  orderId      String
  customerId   String
  orderVersion Int
  currency     String
  totalMinor   BigInt
  createdAt    DateTime @default(now())
  enqueuedAt   DateTime?
  completedAt  DateTime?
  body         String?
  source       PaidOrderOutbox @relation(fields: [id], references: [id], onDelete: Restrict)

  @@unique([orderId, orderVersion])
  @@index([enqueuedAt, createdAt, id])
}
```

Add the following **inverse relation field** inside Chapter 6's existing `OrderTransition` model. The actual FK columns are `(orderId, orderVersion)` on the Outbox above; this field does not create a new audit record or an additional column. Declaring the relation in the Prisma schema also prevents a later migration from deleting this foreign key as an unnecessary difference.

```prisma
paidOutbox PaidOrderOutbox?
```

We did not begin with a JSON table for every kind of event. `PaidOrderOutbox` stores only `orders.paid.v1`, so the schema constrains the event type and fields. A general-purpose Outbox would also need a storage format version, a reconstructor for each type, and a policy for quarantining invalid payloads. With only one event, a specific model is easier to read and validate. We can change it if the number of tables becomes burdensome over time, but that does not remove the responsibility to reconstruct previously stored versions.

`deliveredAt` is not the time an email was sent. In this chapter, it is the time the Inbox and `ReceiptRequest` were stored atomically. `enqueuedAt` records the handoff to Redis in the next chapter, and `completedAt` records the actual storage of the receipt body. Collapsing all three into a `processed` boolean would make it impossible to distinguish which boundary failed. The operations screen must also distinguish "delivered," "awaiting work," and "complete."

The Outbox also stores the amount as a snapshot from order placement. A later product price change or order refund does not change which payment was confirmed at that time. Of course, sending an old receipt after a refund as if it reflected the current payment state is a separate product problem. This chapter's follow-up work only prepares material for a past payment; whether it can be sent is checked against current state and policy at the channel boundary in Chapter 18.

Create the migration in the following order in your isolated PostgreSQL environment. Keep the Prisma CLI and Client versions from Volume 1.

```bash
pnpm exec prisma validate
pnpm exec prisma migrate dev --name add_paid_outbox --create-only
```

Add the following `CHECK` constraints to the end of the generated `migration.sql`. Prisma generates the foreign key from the relation definition above. It references the composite primary key of `OrderTransition` to preserve the audit row identified by the payment event, but the insertion point below remains responsible for ensuring that the row represents `payment_confirmed` to `paid`.

```sql
ALTER TABLE "PaidOrderOutbox"
  ADD CONSTRAINT "PaidOrderOutbox_values_check"
    CHECK ("currency" = 'KRW' AND "totalMinor" > 0 AND "orderVersion" >= 1);

ALTER TABLE "ReceiptRequest"
  ADD CONSTRAINT "ReceiptRequest_values_check"
    CHECK ("currency" = 'KRW' AND "totalMinor" > 0 AND "orderVersion" >= 1),
  ADD CONSTRAINT "ReceiptRequest_completion_check"
    CHECK (("completedAt" IS NULL) = ("body" IS NULL));
```

```bash
pnpm exec prisma migrate dev
pnpm exec prisma generate
```

The meaning of a `CHECK` constraint is not automatically reflected in Prisma's generated types. Preserve this application-owned SQL in later migrations too. Since completed Outbox rows cannot simply be deleted on their own, also design the order for disposing of expired requests, Inbox rows, and Outbox rows.

## Writing the Order State and Outbox Together

Do not create a new payment commit service. The file to modify remains `src/payments/payment-ledger.ts`, and the names, arguments, and return decisions of `PaymentLedger.prepare(orderId, attemptId)`, `recordObservation(expectedAttemptId, observed)`, and `record(event, digest, expectedAttemptId)` remain unchanged. The coordinator and `PaymentReconciler.runBatch()` use the existing `recordObservation()`, while `PaymentWebhooksController.receive()` calls `record()` directly. Replace only the previous chapter's in-process publication with a persistent Outbox insertion.

First remove the `OrderPaidEvent` and `OrderEventsPublisher` imports added in Chapter 13, along with the publisher constructor argument and injection token. Keep `@Inject(PrismaService, OrderInventoryService)` and the existing `db` and `inventory` constructor arguments. Remove the local `publication` variable and `const decision = await` at the start of `record()`, restoring the original `return this.db.transaction(async () => {`. Remove the trailing `announce()` and `return decision` too. Keep the order and payment attempt locks and the transaction's `ReadCommitted` option. After this change, the ledger no longer calls the event bus.

The following fragment **replaces the entire tail of the first successful payment branch in `record()`**. It starts at Chapter 13's `const paid = await this.inventory.confirmPayment(...)` and ends at the immediately following `return finish('applied')`. Do not remove the preceding PaymentInbox insertion, digest check, return of an existing decision, attempt and order lookups, payment identifier/amount/currency checks, reservation SKU/quantity/state/expiry checks, declined and `review` handling, or the `finish()` definition. `tx`, `order`, `attempt`, `event`, and `finish` are all local values in that existing callback. We do not assume a new input type or a helper that replaces validation.

```typescript
const paid = await this.inventory.confirmPayment(
  order.id, order.version, event.currency, BigInt(event.totalMinor),
  { subject: 'system:payment-ledger', scopes: ['payments:confirm'] },
);
const transition = await tx.orderTransition.findUniqueOrThrow({
  where: { orderId_version: { orderId: paid.id, version: paid.version } },
});
await tx.paidOrderOutbox.create({
  data: {
    id: `order-paid:${paid.id}:${paid.version}`,
    orderId: paid.id,
    customerId: paid.customerId,
    orderVersion: paid.version,
    currency: paid.currency,
    totalMinor: paid.totalMinor,
    occurredAt: transition.occurredAt,
  },
});
await tx.paymentAttempt.update({
  where: { id: attempt.id },
  data: { state: 'succeeded', paymentId: event.paymentId },
});
return finish('applied');
```

The key point is the absence of an `order.updateMany({ status: 'paid' })` that bypasses the ledger. `confirmPayment()` applies the existing version condition and amount policy, writes `OrderTransition`, and consumes `Reservation`. The SKU is Chapter 3's `ProductVariant`, and the inventory ledger is Chapter 7's `Stock.available`. Do not change the inventory table for the Outbox or reduce saleable units again at payment time. If a reservation is missing, already released, or expired, the earlier ledger decision leaves it for review, and execution does not enter this success branch. If a race causes actual confirmation to fail, the entire transaction must end with an exception.

An Outbox insertion failure rolls back the order state and version, transition audit, reservation consumption, and this PaymentInbox insertion together. Catching that exception and converting it to `finish('review')` could commit the preceding order changes, so do not add such a catch to this tail. Redelivery of the same provider event ends in the ledger's existing digest/decision path, while the same success arriving under a different event ID ends at the already successful PaymentAttempt. Neither creates another Outbox or transition record.

`eventId` is the same payment transition ID as in the previous chapter, and `occurredAt` is the same audit timestamp. Even if a later refund increases the order version, do not overwrite the stored envelope with the current `Order.version`. After payment, the reservation is already `consumed`. Chapter 11's refund compensation is recorded separately in the same inventory ledger with persistent duplicate protection; do not interpret payment Outbox redelivery as a command to return inventory.

`PrismaService.current()` returns the transaction client in an active context. Writing the Outbox through a separately injected root PrismaClient can break atomicity even if the code appears to sit inside the same callback. All participating calls must therefore use `current()` on the same service. The standard decorator `@Transaction()` is another option, but this example chooses explicit `transaction()` so the boundary and return value are visible together.

## Committing the Receipt Record Together with the Work

A flawed Inbox implementation checks for duplicates, stores "received," and then starts the follow-up work. If it stops in between, the next delivery skips the event as already received, and the work is never created. The `EventInbox` row and `ReceiptRequest` row must be in the same transaction. Because they currently share PostgreSQL, that boundary can also include marking the Outbox delivery complete.

The following `src/notifications/paid-outbox-relay.ts` is a complete file. `PaidRow` types the columns actually selected from the table above. The SQL uses Prisma's tag with value interpolation, not dynamic table names or string concatenation.

```typescript
import { Inject } from '@fluojs/core';
import { EventBusLifecycleService } from '@fluojs/event-bus';
import { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import { OrderPaidEvent } from '../orders/events/order-paid.event.js';

interface PaidRow {
  id: string;
  orderId: string;
  customerId: string;
  orderVersion: number;
  currency: string;
  totalMinor: bigint;
  occurredAt: Date;
}

@Inject(PrismaService, EventBusLifecycleService)
export class PaidOutboxRelay {
  constructor(
    private readonly db: PrismaService<PrismaClient>,
    private readonly events: EventBusLifecycleService,
  ) {}

  async deliverNext(): Promise<boolean> {
    const event = await this.db.transaction(async () => {
      const tx = this.db.current();
      const rows = await tx.$queryRaw<PaidRow[]>`
        SELECT "id", "orderId", "customerId", "orderVersion",
               "currency", "totalMinor", "occurredAt"
        FROM "PaidOrderOutbox"
        WHERE "deliveredAt" IS NULL
        ORDER BY "occurredAt", "id"
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;
      const row = rows[0];
      if (!row) return null;
      if (row.currency !== 'KRW' || row.totalMinor <= 0n) {
        throw new Error('Invalid paid-order snapshot');
      }
      const accepted = await tx.eventInbox.createMany({
        data: [{ consumer: 'notifications.receipt.v1', eventId: row.id }],
        skipDuplicates: true,
      });
      if (accepted.count === 1) {
        await tx.receiptRequest.create({
          data: {
            id: row.id,
            orderId: row.orderId,
            customerId: row.customerId,
            orderVersion: row.orderVersion,
            currency: row.currency,
            totalMinor: row.totalMinor,
          },
        });
      }
      await tx.paidOrderOutbox.update({
        where: { id: row.id },
        data: { deliveredAt: new Date() },
      });
      return new OrderPaidEvent(
        row.id, row.orderId, row.customerId, row.orderVersion,
        row.currency, row.totalMinor.toString(), row.occurredAt.toISOString(),
      );
    });
    if (!event) return false;
    await this.events.publish(event);
    return true;
  }
}
```

`FOR UPDATE SKIP LOCKED` prevents two relays from owning the same row concurrently. If the process ends during processing, PostgreSQL rolls back the transaction and releases the lock, so no in-memory flag needs recovery. Another relay can move to the next row without waiting for the locked first row. The tradeoff is that processing order across different rows is not guaranteed. This consumer creates one independent request from each payment snapshot, so it does not need a global order. Do not apply this strategy unchanged to a consumer that depends on event order.

`createMany(..., skipDuplicates: true)` detects duplicate receipt together with PostgreSQL's uniqueness constraint. It withstands races better than two separate calls that first query and then insert if absent. A duplicate does not create a new `ReceiptRequest` because of the invariant that the Inbox and request committed together in the past. An operator manually deleting either one breaks that invariant. Recovery must also be a constrained operation that understands the table relationships.

`events.publish()` runs after the transaction ends. PaymentLedger recorded the original event in the Outbox, and the relay reconstructs that same envelope to announce it within the process. It signals fast-reacting consumers such as the preview from the previous chapter, but publication success does not determine `deliveredAt`. This field means only that the handoff to the Inbox and request for `notifications.receipt.v1` is complete. It is not a global marker saying that other consumers have ACKed too. Even if the process dies before publication, the work dispatcher in the next chapter searches `ReceiptRequest`. Conversely, publishing the event twice does not increase the number of persistent requests. This chapter guarantees that a follow-up intent is recorded once within the same database, not that every external side effect executes exactly once.

## Actual Module Boundaries and the Execution Owner

Do not change the DB registration. `BlogDatabaseModule` in Volume 1's `src/database/blog-database.module.ts` is a `PrismaModule.forRootAsync` registration value that injects `AppSettings`, with `global: true` outside the factory and `strictTransactions: true` inside it already configured. The following is the **relevant imports composition** in `src/app.ts`. Keep existing entries, with each existing registration value present only once.

```typescript
import { Module } from '@fluojs/core';
import { BlogDatabaseModule } from './database/blog-database.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';

@Module({
  imports: [BlogDatabaseModule, PaymentsModule, NotificationsModule],
})
export class AppModule {}
```

`strictTransactions: true` prevents a substitute client without transaction support from silently falling back to direct execution. Test doubles must preserve that requirement for this example, which uses PostgreSQL interactive transactions. Node24 provides the package's ALS-based context path. Do not assume that a fake client with matching types has real rollback.

`PaymentLedger` remains only in the existing `PaymentsModule.providers`, and that module imports `OrdersModule`, which exports `OrderInventoryService`. Do not add a separate payment commit provider. Remove Chapter 13's unused `OrderEventsPublisher` provider/export and file, but keep `PaidPreviewStore` and `PaidPreviewListener`. Put the following registration in `src/notifications/notifications.module.ts`. Also retain one instance each of the previous chapter's root `EventBusModule.forRoot()` and the Cron registration carried through Chapter 12. If a notification module already exists, merge its providers and exports.

```typescript
import { Module } from '@fluojs/core';
import { PaidOutboxRelay } from './paid-outbox-relay.js';
import { PaidOutboxTask } from './paid-outbox-task.js';

@Module({
  providers: [PaidOutboxRelay, PaidOutboxTask],
  exports: [PaidOutboxRelay],
})
export class NotificationsModule {}
```

Registering the relay alone does not run it repeatedly. The following **complete file**, `src/notifications/paid-outbox-task.ts`, is discovered by the existing Cron registration. Its runs are separate from payment reconciliation so that a failed provider lookup does not block receipt handoff. This call starts outside an active transaction. Wrapping the entire run in `@Transaction()` could put publication before the final commit.

```typescript
import { Inject } from '@fluojs/core';
import { Cron, CronExpression } from '@fluojs/cron';
import { PaidOutboxRelay } from './paid-outbox-relay.js';

@Inject(PaidOutboxRelay)
export class PaidOutboxTask {
  constructor(private readonly relay: PaidOutboxRelay) {}

  @Cron(CronExpression.EVERY_MINUTE, {
    name: 'notifications.paid-outbox',
    timezone: 'UTC',
  })
  async run(): Promise<void> {
    for (let processed = 0; processed < 100; processed += 1) {
      if (!(await this.relay.deliverNext())) break;
    }
  }
}
```

Limit the number of items per run rather than creating an unbounded drain. This is not a bound on how long each DB call takes. Even when periodic runs overlap, row locks prevent duplicate processing. During application shutdown, Cron closes admission to new runs and waits for in-flight calls within the existing shutdown budget. The first scheduled run after restart also queries the table directly, so it finds remaining rows without an in-memory event.

## Reproducing Failure at a Fixed Gap

Verification in this chapter requires a separate test PostgreSQL database and a generated PrismaClient. Do not run migration or forced process termination experiments against the production database. Apply the schema and seed data in your isolated environment; the manuscript does not claim that real database connection experiments passed during writing. A unit-test substitute such as `transaction(fn) { return fn(); }` verifies no atomicity at all.

The first experiment reproduces stopping before publication without terminating a production process. Prepare an order, reservation, and payment attempt through the creation paths in Chapters 7-10, then run only `PaymentLedger.record()` without calling the relay. For a fixture whose version is 0 before its first transition, the order should be `paid` at version 1, with one `OrderTransition` and one Outbox row at that version. The reservation should be `consumed`, and `Stock.available` should be unchanged from before payment. The Outbox's `deliveredAt` should be `null`, with zero `ReceiptRequest` rows. Connecting a new application instance to the same DB and running `deliverNext()` should create one request. There is no need to get lucky with termination timing through `setTimeout`.

The following is an **integration test body** using that fixture. `ledger` and `db` are the actual ledger and PrismaService resolved from the same test app; `event` and `digest` are a verified local success observation; and `orderId` and `sku` are fixture values. Compare against the values after reservation creation and `prepare()`.

```typescript
const before = await db.current().order.findUniqueOrThrow({ where: { id: orderId } });
const stockBefore = await db.current().stock.findUniqueOrThrow({ where: { sku } });
expect(await ledger.record(event, digest)).toBe('applied');
const paid = await db.current().order.findUniqueOrThrow({ where: { id: orderId } });
expect(paid.status).toBe('paid');
expect(paid.version).toBe(before.version + 1);
const transition = await db.current().orderTransition.findUniqueOrThrow({
  where: { orderId_version: { orderId, version: paid.version } },
});
expect(transition.eventName).toBe('payment_confirmed');
const outbox = await db.current().paidOrderOutbox.findUniqueOrThrow({
  where: { orderId_orderVersion: { orderId, orderVersion: paid.version } },
});
expect(outbox.id).toBe(`order-paid:${orderId}:${paid.version}`);
expect(outbox.occurredAt).toEqual(transition.occurredAt);
expect(outbox.deliveredAt).toBeNull();
expect(await db.current().reservation.findUniqueOrThrow({
  where: { orderId_sku: { orderId, sku } },
})).toMatchObject({ state: 'consumed' });
expect((await db.current().stock.findUniqueOrThrow({ where: { sku } })).available)
  .toBe(stockBefore.available);

await ledger.record(event, digest);
expect(await db.current().paidOrderOutbox.count({ where: { orderId } })).toBe(1);
expect(await db.current().orderTransition.count({ where: { orderId } })).toBe(1);
```

Also test whether an Outbox failure reverses the entire confirmation. Adding a temporary `CHECK (false) NOT VALID` constraint to `PaidOrderOutbox` in the isolated DB through the test connection only can reject new insertions without changing existing rows. A success observation for a new fixture should throw, and the order state and version, `reserved` reservation, `Stock.available`, and PaymentAttempt should remain as they were before the call. That fixture should have no PaymentInbox, OrderTransition, or Outbox rows. After removing the constraint in the test's `finally`, submitting the same observation again should meet the success conditions above. Do not run this test in parallel with other DB experiments.

Test separately that success observations with missing, released, or expired reservations leave only `review` without a payment transition or Outbox, and that amount mismatches and cancellation races preserve the same boundary. The Outbox count must not increase when the same success is observed again for the same paymentId, whether under the same event or a different eventId. Pure state machine tests cannot prove these persistence invariants.

On the relay side, cause request persistence to fail after Inbox insertion. Put the same kind of temporary insertion-rejection constraint on `ReceiptRequest` in a separate isolated DB and call `deliverNext()`. The call should fail, the Inbox row just attempted should not exist, and the Outbox's `deliveredAt` should still be `null`. After removing the constraint in `finally`, another call should process normally. This verifies real rollback without seeding a fake request that violates a foreign key.

The third experiment is a race between two relays. Call `deliverNext()` concurrently from two test applications using independent connections. With only one event inserted, exactly one return value should be `true`, with one request and one Inbox row. You can inspect the result using the following read-only SQL. Change only the values to match your fixture's IDs.

```sql
SELECT "status", "version" FROM "Order" WHERE "id" = 'order-14';
SELECT "id", "deliveredAt" FROM "PaidOrderOutbox"
WHERE "orderId" = 'order-14';
SELECT "consumer", "eventId" FROM "EventInbox"
WHERE "consumer" = 'notifications.receipt.v1';
SELECT "id", "enqueuedAt", "completedAt" FROM "ReceiptRequest"
WHERE "orderId" = 'order-14';
```

Verify duplicate replay too. In test-only data, reset only `deliveredAt` on an already processed Outbox row to `null`, then run the relay. The existing Inbox key must prevent the request count from increasing. This modification is test setup to create redelivery, not a production recovery procedure. Simulating retry by deleting the Inbox bypasses duplicate protection and makes the test invalid.

## Turning Remaining Failures into Responsibilities You Can Operate

This implementation does not lose intent, but it does not resolve every error automatically. Retrying does not fix an invalid currency or a corrupted snapshot. The example leaves the row failed and ends the run. Since the same row can block the next run, report the age of the oldest undelivered item and the failing event ID through operational alerts. If you add an automatic quarantine state, it must not mean deletion or completion; preserve the original data, the error, and the responsible operator's action together.

Table retention policy is a feature too. Deleting Inbox rows too soon makes late redelivery look like a new request. Deleting Outbox rows makes it harder to investigate which fact was delivered when. Define customer personal data retention and the possible redelivery period together, and dispose of completed rows as a group. Do not delete undelivered rows merely because of their age.

In a small service where every reaction is a short DB update like order persistence itself, putting those updates directly in the same transaction may be simpler. Introduce Outbox/Inbox when separating slow follow-up processing and restart recovery justifies the cost. We have now reached a point where receipt preparation intent accumulates durably. The next chapter hands that intent to Redis jobs while addressing the new gap between "queued" and "execution complete."

## Implementation References

- [Prisma registration, transaction, and lifecycle contracts](../../packages/prisma/README.md)
- [Prisma public exports](../../packages/prisma/src/index.ts), [transaction handle types](../../packages/prisma/src/types.ts)
- [ALS context and current implementation](../../packages/prisma/src/service.ts)
- [Prisma module and transaction tests](../../packages/prisma/src/module.test.ts)
- [The meaning and limits of event-bus success](../../packages/event-bus/README.md)
- [Listener failure isolation implementation](../../packages/event-bus/src/service.ts), [related tests](../../packages/event-bus/src/module.test.ts)
- [The payment ledger and idempotent receipt](./ch10-payment-webhooks.md), [inventory consumption boundary](./ch07-inventory-concurrency.md), [audit transition schema](./ch06-order-state-machine.md)

[Previous: Notifying Other Features That an Order Has Been Paid](./ch13-domain-events.md) | [Volume 2 Contents](./toc.md) | [Next: Running Failed Jobs Again](./ch15-reliable-jobs.md)
