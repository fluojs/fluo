# Notifying Other Features That an Order Has Been Paid

<!-- book:volume=02-fluoshop;chapter=13 -->

[Previous: Reconciling Orders That Stopped Halfway](./ch12-reconciliation.md) | [Volume 2 Contents](./toc.md) | [Next: What If the Save Succeeded but the Event Disappeared?](./ch14-outbox-and-inbox.md)

## The Work That Accumulates After One Order

The FluoBlog operator hears from a reader who ordered a logo T-shirt. The payment screen says the payment is complete, but nothing has changed in the blog's order information. Thanks to the order processing and reconciliation from earlier chapters, the database correctly records `paid`. What we need now is not to rebuild payment consistency, but to let other features recognize a fact that has already occurred. The reader's account is still an account in `AccountsModule`, and the order's `customerId` is still the existing user ID. Let us connect orders, fulfillment preparation, and notifications within the same `fluo-blog` process.

In this chapter, an order being "complete" means that the buyer has finished paying. It does not mean that all domain processing is finished. We do not add `completed` to the order states; we deal with the moment a confirmed payment changes `pending_payment` to `paid`. Packing and shipping later proceed through `fulfilling` and `shipped`, while cancellation and refunds follow the separate transition rules established earlier. If we name the event imprecisely, the confusion of a fulfillment worker interpreting "completed order" as "already shipped order" will make its way into the code as well.

At first, we could add `notifications.prepareReceipt()` and `fulfillment.noticePaidOrder()` in sequence at the end of the order service. If there is one consumer and failure of that call should fail the entire order, that is the clearer design. But a failed receipt notification must not now cancel a payment that has already been confirmed. Next week, the sales dashboard will want the same information. If the order service knows every consumer and their calling order, each new feature changes the payment processing path. A domain event turns a request to "have someone do something" into a notification that "a fact has been established."

Using events does not instantly make services independently deployable microservices. This chapter uses `@fluojs/event-bus` for delivery within a process. We do not add a network broker or claim that the order transaction and event delivery become atomic. We first observe the reduction in coupling and the meaning of failure directly, then separate the responsibilities that must survive a restart in the next chapter.

## Past-Tense Names and an Unchanging Envelope

Create `src/orders/events/order-paid.event.ts` as the following complete file. This class is an application-owned contract, not an order type provided by the package.

```typescript
export class OrderPaidEvent {
  static readonly eventKey = 'orders.paid.v1';

  constructor(
    public readonly eventId: string,
    public readonly orderId: string,
    public readonly customerId: string,
    public readonly orderVersion: number,
    public readonly currency: 'KRW',
    public readonly totalMinor: string,
    public readonly occurredAt: string,
  ) {}
}
```

`eventId` identifies the fact, not a delivery attempt. Use the same value when redelivering the same fact. Here, `order-paid:${orderId}:${orderVersion}` identifies the payment transition. It differs from the payment provider's event ID or a reconciliation observation ID. Even when different entry points observe the same payment, the order ledger has one payment transition. Deduplicating by `orderId` alone cannot distinguish different events for one order. Conversely, generating a new UUID every time prevents a consumer that receives the same event twice from recognizing the duplicate. `orderVersion` identifies the order version at which the event occurred. A new `Order.version` is 0; a successful state transition increases it, not payment preparation itself. The `v1` in `eventKey` is the envelope format version. It is not a reason to change the channel name every time an order is modified.

Do not copy the amount string sent by the payment provider or browser unchanged. Read the price snapshot taken when the order was placed in the earlier chapter and insert it with `bigint.toString()`. The default currency is `KRW`, expressed as integer minor units. Receipt preparation needs the amount at that time, so it does not look up current product prices. Consumers that need product names or items must use the order item snapshots, not guess at fields missing from this event.

Do not put names, addresses, email addresses, or raw JWTs in this envelope. `customerId` is the minimum identifier that can connect features, not permission to expose it externally. The notification feature must separately check the required permissions and subscription settings when it actually sends a message. An event store also extends retention, so placing an entire account object in an event for convenience increases the scope of long-term data exposure.

`readonly` expresses a write prohibition to TypeScript callers, but it is not runtime input validation. Asserting an object read from JSON with `as OrderPaidEvent` does not make it a class instance. In this chapter, trusted order code creates the instance; we do not reconstruct it from external input. Nor do we put a Prisma transaction object, a function, or an open connection in an event. The current bus restores the event prototype on a payload cloned for each handler. This contract is consistent with not treating an event as a shared workspace in which consumers see one another's mutations.

## Connecting Small Reactions Explicitly

Our first reaction is a temporary "recent payments" display on the operations screen. We keep only auxiliary information in memory that can be reconstructed from the source orders if it disappears on restart. The following `src/orders/paid-preview.ts` is a complete file. It is neither a customer-facing HTTP response implementation nor a persistent projection.

```typescript
import { Inject } from '@fluojs/core';
import { OnEvent } from '@fluojs/event-bus';
import { OrderPaidEvent } from './events/order-paid.event.js';

export interface PaidPreview {
  orderId: string;
  orderVersion: number;
  totalMinor: string;
}

export class PaidPreviewStore {
  private readonly rows = new Map<string, PaidPreview>();

  apply(event: OrderPaidEvent): void {
    const previous = this.rows.get(event.orderId);
    if (previous && previous.orderVersion >= event.orderVersion) return;
    this.rows.set(event.orderId, {
      orderId: event.orderId,
      orderVersion: event.orderVersion,
      totalMinor: event.totalMinor,
    });
  }

  find(orderId: string): PaidPreview | undefined {
    const row = this.rows.get(orderId);
    return row ? { ...row } : undefined;
  }
}

@Inject(PaidPreviewStore)
export class PaidPreviewListener {
  constructor(private readonly store: PaidPreviewStore) {}

  @OnEvent(OrderPaidEvent)
  handle(event: OrderPaidEvent): void {
    this.store.apply(event);
  }
}
```

The version comparison here applies only to a preview built from payment events. A late event from an older version cannot overwrite a newer row. However, this store does not handle `shipped` or `refunded`. That is why it is called a paid preview, not a store of the current order state. Without this explicit limitation, the product could keep displaying an already delivered order as merely paid. We design a persistent projection that shows multiple states separately in Chapter 16.

Now add `src/orders/order-events.publisher.ts`. Separate the outlet that receives confirmed values from the entry point that determines the payment outcome.

```typescript
import { Inject } from '@fluojs/core';
import { EventBusLifecycleService } from '@fluojs/event-bus';
import { OrderPaidEvent } from './events/order-paid.event.js';

@Inject(EventBusLifecycleService)
export class OrderEventsPublisher {
  constructor(private readonly events: EventBusLifecycleService) {}

  async announce(event: OrderPaidEvent): Promise<void> {
    await this.events.publish(event, {
      waitForHandlers: true,
      timeoutMs: 500,
    });
  }
}
```

This method does not accept a DTO received directly from a payment webhook. The actual owner of persistence is `PaymentLedger.record(event, digest, expectedAttemptId)` in Chapter 10's `src/payments/payment-ledger.ts`. Verified webhooks enter this method directly; the payment coordinator and Chapter 12's reconciliation enter through `recordObservation()`. Keep the optional `expectedAttemptId` argument and the existing return decisions. `prepare(orderId, attemptId)` only stores the intent to charge, so it is not the publication point. Nor is it enough that `record()` returns `applied`. It can return that value when applying a declined observation or returning a previous decision for the same event.

We therefore restrict the insertion point to the **first successful payment transition**. Keep the call to `OrderInventoryService.confirmPayment()` that Chapter 10's `record()` makes after checking the provider, attempt, order, paymentId, currency, amount, duplicates, and reservation validity. This method uses Chapter 6's `OrderTransitionsService.apply()` to write the state, version, and audit row, and changes Chapter 7's `Reservation` from `reserved` to `consumed`. Reservation already reduced `Stock.available`, so payment must not deduct it again. If that call fails, do not create an event either.

The following shows the **additional imports and constructor replacement** in `payment-ledger.ts`. Keep the existing import and injection of `OrderInventoryService` and the field name `inventory`. Preserve `prepare`, `recordObservation`, and the parts of `record` not specified below. Do not create another class declaration.

```typescript
import { OrderPaidEvent } from '../orders/events/order-paid.event.js';
import { OrderEventsPublisher } from '../orders/order-events.publisher.js';
```

```diff
-@Inject(PrismaService, OrderInventoryService)
+@Inject(PrismaService, OrderInventoryService, OrderEventsPublisher)
 export class PaymentLedger {
   constructor(
     private readonly db: PrismaService<PrismaClient>,
     private readonly inventory: OrderInventoryService,
+    private readonly publisher: OrderEventsPublisher,
   ) {}
```

Replace the first `return this.db.transaction(...)` in `record()` with the following two statements. `publication` is local to each call, not a class field, so concurrent webhooks do not share an envelope.

```typescript
const publication: { event?: OrderPaidEvent } = {};
const decision = await this.db.transaction(async () => {
```

Inside that callback, replace the existing success branch from `confirmPayment()` up to just before completing the payment attempt with the following fragment. Keep the existing reservation precheck, `review` branch, `finish()` function, and the `paymentAttempt.update()` and `return finish('applied')` after success. Do not append a second `confirmPayment()` after the existing call.

```typescript
const paid = await this.inventory.confirmPayment(
  order.id, order.version, event.currency, BigInt(event.totalMinor),
  { subject: 'system:payment-ledger', scopes: ['payments:confirm'] },
);
const transition = await tx.orderTransition.findUniqueOrThrow({
  where: { orderId_version: { orderId: paid.id, version: paid.version } },
});
publication.event = new OrderPaidEvent(
  `order-paid:${paid.id}:${paid.version}`,
  paid.id, paid.customerId, paid.version, event.currency,
  paid.totalMinor.toString(), transition.occurredAt.toISOString(),
);
```

`orderVersion` is `paid.version`, returned by the transition, not `order.version`, read before the checks. Likewise, `occurredAt` is the `OrderTransition.occurredAt` for that same version, not the webhook receipt time or relay execution time. Even if the order is later refunded, this envelope continues to identify the past payment transition.

Finally, replace the end of the existing `transaction` call through the method return in `record()` as follows. This code does not belong at the end of another method's transaction.

```typescript
}, { isolationLevel: 'ReadCommitted' });
if (publication.event) await this.publisher.announce(publication.event);
return decision;
```

At this stage, callers of `record()` start outside a DB transaction. Do not wrap the ledger calls from the webhook controller, payment coordinator, or reconciliation in a request-wide `@Transaction()`. Nested `transaction()` calls reuse the same context, so with an outer transaction, the return point above would not be the final commit point. If the transaction fails, `await` throws and publication is never reached. Conversely, if publication fails after commit, the payment is already confirmed, and the duplicate protection in `record()` prevents another payment on redelivery. That redelivery does not replay the lost in-memory event. The next chapter turns precisely this gap into a persistent record.

Module assembly is part of the code too. The following two blocks are registration fragments to merge into `src/orders/orders.module.ts` and `src/app.ts`, respectively. They are not complete replacements that remove existing imports/providers/exports/controllers.

```typescript
import { Module } from '@fluojs/core';
import { OrderEventsPublisher } from './order-events.publisher.js';
import {
  PaidPreviewListener,
  PaidPreviewStore,
} from './paid-preview.js';

@Module({
  providers: [OrderEventsPublisher, PaidPreviewStore, PaidPreviewListener],
  exports: [OrderEventsPublisher, PaidPreviewStore],
})
export class OrdersModule {}
```

```typescript
import { Module } from '@fluojs/core';
import { EventBusModule } from '@fluojs/event-bus';
import { BlogDatabaseModule } from './database/blog-database.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { PaymentsModule } from './payments/payments.module.js';

@Module({
  imports: [
    BlogDatabaseModule,
    EventBusModule.forRoot({
      publish: { waitForHandlers: true, timeoutMs: 500 },
      shutdown: { drainTimeoutMs: 5_000 },
    }),
    OrdersModule,
    PaymentsModule,
  ],
})
export class AppModule {}
```

Do not delete the existing `AccountsModule`, `PostsModule`, `AppSettingsModule`, or other order providers. Receive `OrderInventoryService` and `OrderEventsPublisher` through the existing `OrdersModule` in `PaymentsModule.imports`. Do not register these two classes again as providers of PaymentsModule. Also keep the existing `OrderInventoryService` in `OrdersModule.exports`. Dependencies run from `PaymentsModule` to `OrdersModule` to `InventoryModule`; OrdersModule does not import the payment module in the reverse direction.

The DB uses the **same `BlogDatabaseModule` value** exported by `src/database/blog-database.module.ts` in Volume 1. If it is already in the root imports, do not add it again. Continue using that value's `PrismaModule.forRootAsync({ global: true, inject: [AppSettings], useFactory: ... })` and the factory's `strictTransactions: true`. Feature modules receive this global `PrismaService`; do not create a new `DatabaseModule` wrapper, `prisma` variable, or separate `forRoot()` registration. The default event-bus is also global, so publishers receive the same instance. Even decorated listeners must be listed explicitly in `providers`. Importing a file alone does not register a handler.

## The Exact Scope of Failure Isolation

Suppose one receipt preparation handler throws. The current `@OnEvent` contract records that failure and continues running the other matching handlers. A local handler failure alone does not reject `publish()`. Therefore, reaching the line after `await announce()` must not be recorded as "every feature has processed the order." The moment call completion and business completion are stored as the same value, observability becomes incorrect too.

`timeoutMs` does not undo work either. Even when the wait is bounded, an already running handler may finish persisting data later. Cancelling `signal` does not make the bus forcibly cancel arbitrary database calls or external requests that have already started. `waitForHandlers: false` returns to the caller sooner, and the publication wait timeout does not apply in that mode. The work itself remains tracked during shutdown. Once the lifecycle shutdown drain period expires, intents that were not persisted may still disappear.

Let us ask the actual package about this distinction. The following is a complete isolated experiment file that can be placed at `src/orders/domain-events.spec.ts`. Run it in a Vitest environment with the project's standard decorator transform configured. It does not start an HTTP server, PostgreSQL, or Redis. We collect logs not to hide exceptions, but to verify both conditions: the call completes, and the failure is observable.

```typescript
import { Inject, Module } from '@fluojs/core';
import { EventBusLifecycleService, EventBusModule, OnEvent } from '@fluojs/event-bus';
import { FluoFactory, type ApplicationLogger } from '@fluojs/runtime';
import { expect, test } from 'vitest';
import { OrderPaidEvent } from './events/order-paid.event.js';
import { PaidPreviewListener, PaidPreviewStore } from './paid-preview.js';

class Attempts {
  count = 0;
}

@Inject(Attempts)
class BrokenReceiptListener {
  constructor(private readonly attempts: Attempts) { }

  @OnEvent(OrderPaidEvent)
  handle(): void {
    this.attempts.count += 1;
    throw new Error('receipt-store-unavailable');
  }
}

test('distinguishes publication completion from reaction success', async () => {
  const failures: unknown[] = [];
  const logger: ApplicationLogger = {
    debug() { },
    log() { },
    warn() { },
    error(_message, error) { failures.push(error); },
  };
  @Module({
    imports: [EventBusModule.forRoot()],
    providers: [
      Attempts, BrokenReceiptListener, PaidPreviewStore, PaidPreviewListener,
    ],
  })
  class ExperimentModule { }

  const app = await FluoFactory.create(ExperimentModule, { logger });
  try {
    const bus = await app.container.resolve(EventBusLifecycleService);
    const store = await app.container.resolve(PaidPreviewStore);
    const attempts = await app.container.resolve(Attempts);
    const event = new OrderPaidEvent(
      'order-paid:order-13:1', 'order-13', 'reader-7', 1, 'KRW', '29000',
      '2026-09-01T03:00:00.000Z',
    );
    await expect(bus.publish(event)).resolves.toBeUndefined();
    expect(attempts.count).toBe(1);
    expect(store.find('order-13')?.totalMinor).toBe('29000');
    expect(failures.some(
      value => value instanceof Error &&
        value.message === 'receipt-store-unavailable',
    )).toBe(true);

    await bus.publish(event);
    expect(attempts.count).toBe(2);
    expect(store.find('order-13')?.orderVersion).toBe(1);
  } finally {
    await app.close();
  }
}, 5_000);
```

On the second publication, the failing handler's call count becomes 2. This demonstrates that the bus does not recognize the same `eventId` and prevent duplicate delivery. The preview value stays the same because of the store's version condition, not a delivery guarantee from the bus. `try/finally` closes the application lifecycle even when an assertion fails. The test's five-second limit is not a fixed wait; it is an upper bound that fails a stalled experiment.

The experiment above remains valid: legacy `publish` passes a raw `Error` to the logger. Now compare opt-in `publishWithResult`. The following is an **additional fragment to insert after the second publication's assertions and before `finally` in the same test**. It does not replace the existing experiment or the policy in `OrderEventsPublisher.announce()`.

```typescript
failures.length = 0;
const result = await bus.publishWithResult(event, { waitForHandlers: true });
expect(result.status).toBe('settled');
if (result.status !== 'settled') throw new Error('Expected local observations.');
expect(result.outcomes.map(outcome => outcome.status)).toEqual(['failed', 'succeeded']);
expect(result.outcomes[0]).toMatchObject({
  target: {
    kind: 'handler',
    index: 0,
    moduleName: 'ExperimentModule',
    targetName: 'BrokenReceiptListener',
    methodName: 'handle',
  },
  status: 'failed',
  reason: 'handler',
});
expect(attempts.count).toBe(3);
expect(store.find('order-13')?.orderVersion).toBe(1);
expect(failures).toEqual([undefined]);
```

The expected result is a mixture of failure and success inside `settled`, with no raw `Error` in the error argument received by the logger. Existing safe target/status messages remain. Results also omit payloads, raw errors, and handler return values. This sanitization applies only to the new publication path, not to app logs written directly by handlers or transports. The `EVENT_BUS` runtime facade supports the same API through the additive `EventBusWithResults` type, leaving `EventBus` unchanged.

The array follows discovery order for matching effective local handlers, not completion order; `index` is scoped to this publication. When a transport is configured, outbound outcomes follow in channel order. Remote handlers or subscribers are not enumerated, and an adapter success remains transport success even without subscribers. Only the absence of both local handlers and a configured transport produces `no-recipients` with an empty array. A caller checking required reactions must therefore check `status === 'settled'`, a nonempty result, and `succeeded` for every outcome, and separately verify the required handler registration.

Failed outcomes carry `reason: 'handler' | 'transport' | 'not-callable'`; `timed-out` carries `timeoutMs`, and `cancelled` carries the `started` flag. Lifecycle `stopping`/`stopped`/`failed` states become a `rejected` reason, while discovery/preparation errors still reject. There is no API that automatically aggregates results into rejection. Awaited timeout/cancellation ends only observation; started work remains shutdown-tracked. `waitForHandlers: false` returns `background` with `completion: Promise<EventPublishSettlement>`, ignoring timeout and post-start cancellation while awaiting actual work. An already-aborted signal skips work that has not started. Completion can remain pending after bounded shutdown and be lost on process exit, so it cannot replace a persistent outbox.

The [consumer examples in the messaging guide](../../apps/docs/content/docs/guides/messaging-workflows.mdx) compare best-effort `publish` for last-used bookkeeping after authentication has already succeeded, carrying only a token record ID, with checking reaction results before choosing the next step. They put no raw credential in the event and do not turn bookkeeping failure into authentication failure. Payment in this chapter is also an established fact, so a failed observation is not a payment rollback.

Run the following command in your `fluo-blog`. This application test was not run during manuscript preparation; the results described here are expected results.

```bash
pnpm exec vitest run src/orders/domain-events.spec.ts
```

As an additional check, removing the listener from `providers` should leave no successful preview. The test must fail in that case to catch a registration mistake. Conversely, registering the listener under two different singleton tokens can discover two reactions even for the same implementation class. Review module registration identity rather than assuming "the same class means once."

## Faster Does Not Mean Safer

The advantage of in-process events is that small reactions can live with their respective features while order code changes less. The cost is that the execution path no longer resides in one method. To trace one order, an operator must connect `orderId`, `eventId`, the consumer name, and the processing result. Log those identifiers and error classifications rather than the entire original payload. When a handler takes a long time, first ask why its reaction must be awaited on the request path instead of immediately increasing the timeout.

Do not move mandatory invariants behind events. Rules such as not confirming an order without an inventory reservation, and checks that the payment amount matches, stay within the earlier synchronous boundary. Turning a conflict the buyer needs to know about immediately into an internal notification failure log breaks business rules after the API has returned success. Events are useful for separating reactions to established facts, not for hiding conditions that have yet to hold.

Adding a Redis Pub/Sub transport adapter does not change this conclusion. It is a way to distribute facts across processes, not a queue that preserves work history. Every subscribing instance can react to the same fact, which actually broadens the responsibility for idempotency. Adding a broker at this stage only raises operating costs while leaving the gap where the process stops after saving but before publishing.

By the end of this chapter, we have a shared language in `OrderPaidEvent`, explicitly registered publishers and consumers, and a test that observes failure isolation. But we cannot say that receipt preparation will eventually run without fail. In the next chapter, we store "a fact still awaiting delivery" alongside the paid order. The next change makes it possible to rediscover a responsibility left in the database even when the event disappears.

## Implementation References

- [event-bus usage and failure isolation contract](../../packages/event-bus/README.md)
- [Public exports](../../packages/event-bus/src/index.ts), [publication option types](../../packages/event-bus/src/types.ts)
- [Cloning, invocation, and failure logging implementation](../../packages/event-bus/src/service.ts)
- [Discovery, duplicate publication, and failure isolation tests](../../packages/event-bus/src/module.test.ts)
- [Shutdown tracking tests for background work](../../packages/event-bus/src/shutdown-contract.test.ts)
- [Executable result-aware publication example](../../packages/event-bus/examples/publish-results.ts), [result types](../../packages/event-bus/src/publish-result.ts)
- [Result tests](../../packages/event-bus/src/publish-result.test.ts), [bound tests](../../packages/event-bus/src/publish-result-bounds.test.ts), [lifecycle tests](../../packages/event-bus/src/publish-result-lifecycle.test.ts)
- [The original payment ledger's receiving boundary](./ch10-payment-webhooks.md), [the existing service that confirms inventory together with the order](./ch07-inventory-concurrency.md), [transition audit records](./ch06-order-state-machine.md)

Package owners verify this evidence from the repository root with `pnpm --dir packages/event-bus test` and `pnpm --filter '@fluojs/event-bus...' build`. This does not replace tests in the reader's application or verification of the latest registry release.

[Previous: Reconciling Orders That Stopped Halfway](./ch12-reconciliation.md) | [Volume 2 Contents](./toc.md) | [Next: What If the Save Succeeded but the Event Disappeared?](./ch14-outbox-and-inbox.md)
