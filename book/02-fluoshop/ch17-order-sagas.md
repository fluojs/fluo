# Coordinating Multi-Step Order Processing

<!-- book:volume=02-fluoshop;chapter=17 -->

[Previous: When Write Models and Read Models Need Different Things](./ch16-cqrs-projections.md) | [Table of Contents](./toc.md) | [Next: Delivering the Same Event through Email, Slack, and Discord](./ch18-notification-channels.md)

## Payment Is Complete, but the T-Shirt Has Not Left

A FluoBlog reader has ordered their first T-shirt. The payment screen showed success, and the operator's order view also shows `paid`. In the same payment confirmation transaction, the order's `Reservation` already became `consumed`. Yet the order is missing from the packing list. Payment and inventory updates are complete, but nobody was responsible for recording a packing request and carrying its result through to the fulfillment handoff. The previous chapter's projection can show this situation, but it does not decide what happens next.

The Outbox and Inbox built in earlier chapters addressed lost messages and duplicate delivery. The queue provided a route for retrying failed executions. But being able to redeliver a message is different from moving an order in the right direction. If a packer identifies an undeliverable address and finalizes a rejection before dispatch, we must not retry the same fulfillment handoff. We need a separate business flow to refund the money already received. This is not about obtaining fresh approval for an inventory reservation after payment; it is about coordinating the results of processing that takes place after payment.

At first, the order service can simply call the inventory, payment, and fulfillment services in sequence. If everything finishes immediately in the same database, a single transaction is simpler. Here, payment results arrive through webhooks, and packing goes through a queue and confirmation by a worker. Keeping an HTTP request open or holding a database lock while waiting for a result extends both connection time and lock duration. In this chapter, we introduce **a process manager that retains the facts needed for decisions across executions and determines the next command**. CQRS's `@Saga` connects incoming events to those decisions.

The shop is still a modular monolith in the same `fluo-blog` application. `AccountsModule` and readers' user IDs remain unchanged, and `OrdersModule`, `InventoryModule`, `PaymentsModule`, and `FulfillmentModule` all remain in the process. Introducing a Saga is no reason to deploy four services on separate servers. We are separating responsibility for decisions over time, not introducing a network boundary.

## Do Not Put Order State and Coordination State in the Same Column

An order's `status` can be `pending_payment`, `paid`, `fulfilling`, `shipped`, `cancelled`, `refund_pending`, or `refunded`. Inventory reservations have separate states. The coordinator does not arbitrarily add business states such as `awaiting_packing` to orders. Waiting for a packing result is an internal detail of advancing an order that is `paid`. Keeping the state seen by customers and accounting independent of an execution engine's detailed steps makes changes easier.

This implementation is limited to **requesting packing for an order with confirmed payment, then connecting the packing result to either a fulfillment handoff or a refund**. Payment declines, cancellations before payment, and reservation expiry remain the responsibility of the order state machine and reconciliation work built earlier. The actual starting point for payment is `PaymentLedger.prepare/record` in `src/payments/payment-ledger.ts`. It charges outside the transaction using the saved attempt ID and amount, then records the confirmed result in the ledger. Webhooks and reconciliation use the same result-application boundary.

The input `payment.confirmed` here is not the successful charge response itself. It is a business fact emitted after `OrderInventoryService.confirmPayment` applies payment confirmation and reservation consumption together, and `OrderTransitionsService.apply` saves the state, version, and `OrderTransition` audit in the same transaction. `Stock.available` was already reduced at reservation time, so changing the `(orderId, sku)` `Reservation` to `consumed` must not deduct it again. The Saga must not repeat this work as a separate inventory command.

`packing.confirmed` and `packing.rejected` are the definitive results of the single packing attempt added in this chapter. `FulfillmentModule` accepts the packing request idempotently, saves the actual confirmed result, and then emits it. Transient work failures cause the queue to retry the same request; `packing.rejected` is sent only when a final rejection is made before dispatch. If both approval and rejection arrive for the same attempt, quarantine them for reconciliation rather than trusting the later message. Allowing another packing attempt after correcting an address following rejection would require a `packingAttemptId` and a new business flow. This experiment permits only one packing attempt per order.

These steps have a causal order. Consuming packing completion before saving its request, or consuming refund completion before requesting a refund, suggests missing or incorrectly correlated data rather than a normal difference in arrival order. The decision function below rejects such results without leaving a successful Inbox record. In contrast, an identical result for a step already advanced, or a late redelivery of payment confirmation, creates no new work.

The following is the **complete file** `src/orders/saga/decision.ts`. A pure function expresses the business decisions so that order, conflicts, and duplicates can be verified without connecting to a payment provider. `fulfilled` means the coordinator has received **confirmation of local admission of the fulfillment request**, not that the order is `shipped` or that a remote fulfillment worker has accepted it. `fulfillment.accepted` records that the order process has verified trusted packing approval and committed to taking durable responsibility for the fulfillment request. Only this commit transitions `paid/version=1 → fulfilling/version=2`. Saving the remote Inbox and shipment job, and finally dispatching the shipment, are separate boundaries that follow it. This definition also holds in [Chapter 23's service extraction](./ch23-extract-fulfillment.md). Here, `revision` is the Saga's consumption history counter, separate from the order version.

After packing approval but before local admission, the order is still `paid`, so the customer refund from Chapter 11 can win first. In that case, the fulfillment command recipient records `fulfillment.superseded` without requesting another refund. The Saga's `superseded` is a terminal state that hands responsibility to the refund flow already durably admitted. Conversely, if local fulfillment admission wins first, the order is `fulfilling` even without a consumer, and automatic refunds are rejected. A fulfillment delay or lost notification must not be turned into a packing rejection.

```ts
export type Fact =
  | 'payment.confirmed'
  | 'packing.confirmed'
  | 'packing.rejected'
  | 'fulfillment.accepted'
  | 'fulfillment.superseded'
  | 'refund.confirmed';

export type Phase =
  | 'awaiting_payment'
  | 'awaiting_packing'
  | 'awaiting_fulfillment'
  | 'awaiting_refund'
  | 'fulfilled'
  | 'superseded'
  | 'refunded';

export type State = Readonly<{
  orderId: string;
  phase: Phase;
  revision: number;
}>;

export type Intent = Readonly<{
  id: string;
  orderId: string;
  kind: 'packing.request' | 'fulfillment.request' | 'refund.request';
}>;

export type Decision = Readonly<{
  state: State;
  intents: readonly Intent[];
}>;

export function initialState(orderId: string): State {
  return {
    orderId,
    phase: 'awaiting_payment',
    revision: 0,
  };
}

export function decide(current: State, fact: Fact): Decision {
  let phase = current.phase;
  let kind: Intent['kind'] | undefined;

  switch (fact) {
    case 'payment.confirmed':
      if (phase === 'awaiting_payment') {
        phase = 'awaiting_packing';
        kind = 'packing.request';
      }
      break;
    case 'packing.confirmed':
      if (phase === 'awaiting_packing') {
        phase = 'awaiting_fulfillment';
        kind = 'fulfillment.request';
      } else if (
        phase !== 'awaiting_fulfillment' && phase !== 'fulfilled' &&
        phase !== 'superseded'
      ) {
        throw new Error('Conflicting or premature packing outcome');
      }
      break;
    case 'packing.rejected':
      if (phase === 'awaiting_packing') {
        phase = 'awaiting_refund';
        kind = 'refund.request';
      } else if (phase !== 'awaiting_refund' && phase !== 'refunded') {
        throw new Error('Conflicting or premature packing outcome');
      }
      break;
    case 'fulfillment.accepted':
      if (phase !== 'awaiting_fulfillment' && phase !== 'fulfilled') {
        throw new Error('Unexpected fulfillment acknowledgement');
      }
      phase = 'fulfilled';
      break;
    case 'fulfillment.superseded':
      if (phase !== 'awaiting_fulfillment' && phase !== 'superseded') {
        throw new Error('Unexpected superseded fulfillment');
      }
      phase = 'superseded';
      break;
    case 'refund.confirmed':
      if (phase === 'superseded') break;
      if (phase !== 'awaiting_refund' && phase !== 'refunded') {
        throw new Error('Unexpected refund confirmation');
      }
      phase = 'refunded';
      break;
  }

  return {
    state: { ...current, phase, revision: current.revision + 1 },
    intents: kind ? [{
      id: `${current.orderId}:${kind}:v1`,
      orderId: current.orderId,
      kind,
    }] : [],
  };
}
```

There is a reason the intent ID does not contain the event ID. Different webhook IDs can report the same successful payment. Two delivery messages must not produce two fulfillment requests. Within one coordination flow for an order, the same kind of next action occurs only once, so we use the order ID, action kind, and contract version. This value carries through to the queue job ID and the receiving Inbox's business idempotency key. The string `v1` is the identity rule for this action, not a code deployment version. Changing it on every routine deployment would make the same previous action look new.

The return value is split into state and intents for the same reason. Sending externally from the decision function would couple retries to the database transaction. First save the intent that says "a refund must be requested," then let a separate executor handle it. Creating a refund request alone does not make the order `refunded`. The refund boundary uses `OrderTransitionsService.apply` to record the allowed transition and audit together, moving the order to `refund_pending`, and moves it to `refunded` when a confirmed refund result is available.

Inventory compensation is another separate decision. Cancellation before payment returns only reservations changed to `released`, once, but these reservations are already `consumed`. A packing rejection does not mean releasing the same reservation again or unconditionally increasing `Stock.available`. Check whether the items have shipped and whether they are saleable, then apply the return once using the durable compensation record defined earlier and the same `Stock` and `Reservation` ledgers. The refund transfer and inventory return are results that each need confirmation. This Saga's `refunded` means it has received a refund result, not a composite state asserting that all compensation is complete.

## CQRS Connects Events; the Store Makes Consumption Atomic

Now we connect the pure decision logic to the actual `@fluojs/cqrs` path. The following `src/orders/saga/order-saga.ts` is a **complete in-memory experiment file**. It uses the preceding file in the same directory. `MemorySagaStore` is a minimal executable model of the persistence protocol, not a production store. It starts empty each time it is created and therefore does not guarantee recovery after restart.

```ts
import { Inject, Module } from '@fluojs/core';
import {
  CommandBusLifecycleService,
  CommandHandler,
  CqrsModule,
  Saga,
  type CqrsDispatchContext,
  type ICommandHandler,
  type IEvent,
  type ISaga,
} from '@fluojs/cqrs';
import {
  decide, initialState,
  type Fact, type Intent, type State,
} from './decision.js';

export class OrderFact implements IEvent {
  constructor(
    public readonly eventId: string,
    public readonly orderId: string,
    public readonly fact: Fact,
  ) {}
}

export class AdvanceOrder {
  constructor(public readonly event: OrderFact) {}
}

export const SAGA_STORE = Symbol('orders.saga.store');

export interface SagaStore {
  consume(event: OrderFact): Promise<void>;
}

export class MemorySagaStore implements SagaStore {
  readonly states = new Map<string, State>();
  readonly inbox = new Set<string>();
  readonly outbox = new Map<string, Intent>();

  async consume(event: OrderFact): Promise<void> {
    const inboxKey = `${event.orderId}:${event.eventId}`;
    if (this.inbox.has(inboxKey)) return;

    const current = this.states.get(event.orderId)
      ?? initialState(event.orderId);
    const decision = decide(current, event.fact);

    this.states.set(event.orderId, decision.state);
    for (const intent of decision.intents) {
      this.outbox.set(intent.id, intent);
    }
    this.inbox.add(inboxKey);
  }
}

@Inject(SAGA_STORE)
@CommandHandler(AdvanceOrder)
export class AdvanceOrderHandler
implements ICommandHandler<AdvanceOrder> {
  constructor(private readonly store: SagaStore) {}

  async execute(command: AdvanceOrder): Promise<void> {
    await this.store.consume(command.event);
  }
}

@Inject(CommandBusLifecycleService)
@Saga(OrderFact)
export class OrderSaga implements ISaga<OrderFact> {
  constructor(private readonly commands: CommandBusLifecycleService) {}

  async handle(event: OrderFact, context?: CqrsDispatchContext): Promise<void> {
    await this.commands.execute(new AdvanceOrder(event), context);
  }
}

@Module({
  imports: [CqrsModule.forRoot()],
  providers: [
    { provide: SAGA_STORE, useClass: MemorySagaStore },
    AdvanceOrderHandler,
    OrderSaga,
  ],
  exports: [SAGA_STORE],
})
export class OrderSagaLabModule {}
```

Class-level `@Inject` specifies the actual token. The `SagaStore` interface disappears at runtime, so its interface name cannot be used for injection. Register handlers and the Saga in `providers`. CQRS discovers handlers among singleton providers; decorating an HTTP controller does not make it discoverable in the same way. The experimental module has its own CQRS registration. When integrating it into the existing application, reuse the `CqrsModule.forRoot()` configured in Chapter 16, and merge the three providers above and the required exports into the existing `OrdersModule` configuration. The goal is not to create duplicate root buses.

The in-memory `consume` implementation has no intermediate `await`. It completes the decision within one JavaScript execution segment, then changes the three data structures. It therefore performs the potentially throwing decision first and does not record a conflicting fact as successfully consumed in the Inbox. This is an experimental assumption that models an atomic database commit. Do not translate it directly into a production implementation that saves the data structures asynchronously one by one.

At the actual input boundary, validate the persisted event's `eventId`, `orderId`, and fact kind, then reconstruct it with `new OrderFact(...)`. CQRS finds class-based event routes, so publishing a JSON object directly differs from publishing a class instance. Events should contain identifiers and cloneable data, not payment clients, open sockets, or functions. CQRS gives each handler and Saga an isolated copy of the event, so a handler cannot append processing results to the object and pass them on to the next handler either.

## Three Writes Must Become One in Persistent Storage

The transaction boundary of the production `SagaStore.consume` is clear. Lock the coordination row for the order, check the Inbox for duplication, save the decision result and Outbox, then record the Inbox and commit. Keep the database registration from Volume 1: `BlogDatabaseModule` in `src/database/blog-database.module.ts`. Its root `PrismaModule.forRootAsync` registration injects `AppSettings`, creates a client per container, and shares it with `global: true`, so the Saga store also receives the same `PrismaService`. Merely wrapping the same raw client in a new service does not share the transaction context.

The SQL below is a **schema for an isolated database experiment that reproduces the preceding protocol**. It is not a migration replacing the existing order and inventory ledgers; create it only in a separate experimental database. In production, express the same keys and constraints in the application's Prisma schema and save the coordination state, Inbox, and Outbox within one transaction context of the shared service. The responsible service records transitions of the order itself together with `OrderTransition`. The Outbox is a delivery intent, not a replacement for the audit trail of every order transition.

```sql
CREATE TABLE order_saga_lab (
  order_id text PRIMARY KEY,
  phase text NOT NULL DEFAULT 'awaiting_payment'
    CHECK (phase IN (
      'awaiting_payment', 'awaiting_packing',
      'awaiting_fulfillment', 'awaiting_refund',
      'fulfilled', 'superseded', 'refunded'
    )),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0)
);

CREATE TABLE saga_inbox_lab (
  order_id text NOT NULL REFERENCES order_saga_lab(order_id),
  event_id text NOT NULL,
  PRIMARY KEY (order_id, event_id)
);

CREATE TABLE saga_outbox_lab (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES order_saga_lab(order_id),
  kind text NOT NULL
    CHECK (kind IN ('packing.request', 'fulfillment.request', 'refund.request')),
  dispatched_at timestamptz
);
```

Ensure a new row exists with `INSERT ... ON CONFLICT DO NOTHING`, then use `SELECT ... FOR UPDATE` in the same transaction. Query the Inbox **after** acquiring the lock. If two consumers both read "absent" before taking the lock, their decisions and writes can race. If the Inbox entry already exists, finish without touching the state. Otherwise, call `decide` with the locked row to increment the Saga's `revision`, record intents in the Outbox, and finally insert the Inbox entry. If any write fails, the entire transaction rolls back. Keeping the intent content in the Outbox unchanged except for the delivery completion timestamp makes reprocessing easier to analyze.

Instead of a row lock, a conditional update with `WHERE revision = expectedRevision` is also possible. If it updates zero rows, reread the state and recompute rather than reusing the previous calculation. Do not assume that in-process Saga serialization eliminates database contention. A web process and a worker process, or two instances during a rolling deployment, have separate memory.

The Outbox relay hands committed intents to executors. The recipient of `packing.request` checks that the current order is `paid` and its ledger reservations are `consumed`, then accepts the packing task idempotently. `RecordPackingResult` below is the internal command that records the final result of that task. The **local** recipient of `fulfillment.request` is the `AdmitFulfillment` handler in Chapter 23. It verifies packing approval and writes the fulfillment Outbox, the `fulfilling` transition, audit, and local acceptance fact in one transaction. The remote recipient's Inbox and `ShipmentJob` are not part of that transaction. The recipient of `refund.request` executes the external request using the refund idempotency key defined earlier.

This design still has a crash window after sending but before saving confirmation. If the process dies after enqueueing but before recording `dispatched_at`, the same intent is delivered again. Recipient idempotency is not optional. Conversely, marking delivery complete before sending the intent creates a permanent omission. A durable Saga does not eliminate repeated execution. It makes repeated execution consistent with actions already decided.

## Connect Packing Evidence and Saga Notifications to Real Persistence Boundaries

When bringing the SQL experiment into the application, use the following **Prisma model additions**. `OrderSagaPhase` has the same values as `Phase` above and is separate from the order status ENUM. These tables all belong to the existing order database and `BlogDatabaseModule`. `PackingResult` is an immutable result finalized once per order. `LocalOrderFact` is not a remote broker Outbox; it is the fact ledger that the local relay below will actually consume.

```prisma
enum OrderSagaPhase {
  awaiting_payment
  awaiting_packing
  awaiting_fulfillment
  awaiting_refund
  fulfilled
  superseded
  refunded
}

enum SagaIntentKind {
  packing_request     @map("packing.request")
  fulfillment_request @map("fulfillment.request")
  refund_request      @map("refund.request")
}

enum PackingOutcome {
  confirmed
  rejected
}

model OrderSaga {
  orderId  String @id
  phase    OrderSagaPhase @default(awaiting_payment)
  revision Int @default(0)
}

model SagaInbox {
  orderId String
  eventId String
  fact    String
  @@id([orderId, eventId])
}

model SagaIntent {
  id           String @id
  orderId      String
  kind         SagaIntentKind
  dispatchedAt DateTime?
  @@index([kind, dispatchedAt])
}

model PackingResult {
  orderId      String @id
  requestId    String @unique
  orderVersion Int
  outcome      PackingOutcome
  actorId      String
}

model LocalOrderFact {
  id          String @id
  orderId     String
  fact        String
  deliveredAt DateTime?
  createdAt   DateTime @default(now())
  @@index([deliveredAt, createdAt])
}
```

The following `src/orders/saga/prisma-saga-store.ts` is a **production store file**. It uses the models above and the earlier `order-saga.ts` and `decision.ts`. The lock order is order first, then Saga. Refunds and local fulfillment admission also lock the order first, avoiding inconsistent lock acquisition order. Persisted packing and acceptance facts are checked against the order and kind as well as the ID. Payment and refund facts enter only through the existing validated ledger delivery boundary, and the ledger is checked again. Do not create an API that publishes public JSON directly as `OrderFact`.

```ts
import { Inject } from '@fluojs/core';
import { PrismaService, type PrismaServiceFacade } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import { decide, type Intent } from './decision.js';
import { OrderFact, type SagaStore } from './order-saga.js';

const kinds = {
  'packing.request': 'packing_request',
  'fulfillment.request': 'fulfillment_request',
  'refund.request': 'refund_request',
} as const satisfies Record<Intent['kind'], string>;

@Inject(PrismaService)
export class PrismaSagaStore implements SagaStore {
  constructor(private readonly db: PrismaServiceFacade<PrismaClient>) {}

  async consume(event: OrderFact): Promise<void> {
    await this.db.transaction(async () => {
      const orders = await this.db.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Order" WHERE "id" = ${event.orderId} FOR UPDATE
      `;
      if (orders.length !== 1) throw new Error('ORDER_NOT_FOUND');
      await this.db.orderSaga.createMany({
        data: [{ orderId: event.orderId }], skipDuplicates: true,
      });
      await this.db.$queryRaw`
        SELECT "orderId" FROM "OrderSaga"
        WHERE "orderId" = ${event.orderId} FOR UPDATE
      `;
      const key = { orderId: event.orderId, eventId: event.eventId };
      const previous = await this.db.sagaInbox.findUnique({
        where: { orderId_eventId: key },
      });
      if (previous) {
        if (previous.fact !== event.fact) throw new Error('SAGA_FACT_CONFLICT');
        return;
      }
      if (event.fact.startsWith('packing.') ||
          event.fact.startsWith('fulfillment.')) {
        const saved = await this.db.localOrderFact.findUnique({
          where: { id: event.eventId },
        });
        if (!saved || saved.orderId !== event.orderId || saved.fact !== event.fact) {
          throw new Error('UNTRUSTED_LOCAL_FACT');
        }
      } else if (event.fact === 'payment.confirmed') {
        const paid = await this.db.orderTransition.findUnique({
          where: { orderId_version: { orderId: event.orderId, version: 1 } },
        });
        if (paid?.to !== 'paid' || paid.eventName !== 'payment_confirmed') {
          throw new Error('PAYMENT_NOT_COMMITTED');
        }
      } else if (event.fact === 'refund.confirmed') {
        const refund = await this.db.refundRequest.findUnique({
          where: { orderId: event.orderId },
        });
        if (refund?.state !== 'succeeded') throw new Error('REFUND_NOT_COMMITTED');
      }
      const current = await this.db.orderSaga.findUniqueOrThrow({
        where: { orderId: event.orderId },
      });
      const next = decide(current, event.fact);
      await this.db.orderSaga.update({
        where: { orderId: event.orderId },
        data: { phase: next.state.phase, revision: next.state.revision },
      });
      for (const intent of next.intents) {
        await this.db.sagaIntent.create({
          data: { ...intent, kind: kinds[intent.kind] },
        });
      }
      await this.db.sagaInbox.create({ data: { ...key, fact: event.fact } });
    });
  }
}
```

The following **internal command and handler file**, `src/orders/saga/record-packing-result.ts`, records the actual warehouse confirmation result. `actor` is the `OrderActor` of an authenticated warehouse worker or job executor, not a list of permissions received in an HTTP body. The existing packing task screen shows the saved order items and the shipping address snapshot from order placement, and executes this command with that order ID. Do not put a new address, SKU, or quantity in the approval command. Recording the result verifies the existence of the packing request, the order version, and even the consumed quantities in the ledger.

```ts
import { Inject } from '@fluojs/core';
import { CommandHandler, type ICommandHandler } from '@fluojs/cqrs';
import { PrismaService, type PrismaServiceFacade } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import type { OrderActor } from '../order-state.js';

export class RecordPackingResult {
  constructor(
    public readonly orderId: string,
    public readonly outcome: 'confirmed' | 'rejected',
    public readonly actor: OrderActor,
  ) {}
}

@Inject(PrismaService)
@CommandHandler(RecordPackingResult)
export class RecordPackingResultHandler
implements ICommandHandler<RecordPackingResult> {
  constructor(private readonly db: PrismaServiceFacade<PrismaClient>) {}

  async execute(command: RecordPackingResult): Promise<void> {
    if (!command.actor.scopes.includes('packing:confirm')) {
      throw new Error('PACKING_ACCESS_DENIED');
    }
    if (command.outcome !== 'confirmed' && command.outcome !== 'rejected') {
      throw new Error('INVALID_PACKING_OUTCOME');
    }
    const { orderId, outcome } = command;
    const requestId = `${orderId}:packing.request:v1`;
    await this.db.transaction(async () => {
      await this.db.$queryRaw`
        SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE
      `;
      const previous = await this.db.packingResult.findUnique({ where: { orderId } });
      if (previous) {
        if (previous.requestId !== requestId || previous.outcome !== outcome) {
          throw new Error('PACKING_RESULT_CONFLICT');
        }
        return;
      }
      const request = await this.db.sagaIntent.findUnique({ where: { id: requestId } });
      const order = await this.db.order.findUniqueOrThrow({
        where: { id: orderId }, include: { items: true, reservations: true },
      });
      if (!request || request.orderId !== orderId || request.kind !== 'packing_request' ||
          order.status !== 'paid' || order.version !== 1 ||
          order.items.length === 0 || order.items.length !== order.reservations.length ||
          order.items.some(item => !order.reservations.some(row =>
            row.sku === item.sku && row.quantity === item.quantity &&
            row.state === 'consumed'))) {
        throw new Error('PACKING_NOT_ELIGIBLE');
      }
      await this.db.packingResult.create({
        data: { orderId, requestId, outcome, orderVersion: 1, actorId: command.actor.subject },
      });
      await this.db.localOrderFact.create({
        data: { id: `${orderId}:packing.${outcome}:v1`, orderId, fact: `packing.${outcome}` },
      });
    });
  }
}
```

The actual call at the warehouse boundary is `await commands.execute(new RecordPackingResult(orderId, outcome, warehouseActor))`. Here, `commands` is the injected `CommandBusLifecycleService`, and `warehouseActor` comes from server-side authentication. Do not promote an automatic success callback or customer request to this principal. If approval and rejection arrive concurrently, keep only the first result read after locking the order and quarantine the other as a conflict.

Finally, put the following **relay file** in `src/orders/saga/local-order-fact-relay.ts`. Even if `publish()` succeeds, an application that omitted the Saga provider might not have consumed anything, so mark delivery complete only after directly verifying the `SagaInbox` commit. That check is what distinguishes this from assuming that "there is an Outbox row, so the Saga will eventually find out."

```ts
import { Inject } from '@fluojs/core';
import { CqrsEventBusService } from '@fluojs/cqrs';
import { PrismaService, type PrismaServiceFacade } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import { OrderFact } from './order-saga.js';
import type { Fact } from './decision.js';

function localFact(value: string): Fact {
  switch (value) {
    case 'packing.confirmed':
    case 'packing.rejected':
    case 'fulfillment.accepted':
    case 'fulfillment.superseded':
      return value;
    default: throw new Error('INVALID_LOCAL_FACT');
  }
}

@Inject(PrismaService, CqrsEventBusService)
export class LocalOrderFactRelay {
  constructor(
    private readonly db: PrismaServiceFacade<PrismaClient>,
    private readonly events: CqrsEventBusService,
  ) {}

  async runBatch(): Promise<number> {
    const rows = await this.db.localOrderFact.findMany({
      where: { deliveredAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 20,
    });
    for (const row of rows) {
      await this.events.publish(new OrderFact(row.id, row.orderId, localFact(row.fact)));
      const consumed = await this.db.sagaInbox.findUnique({
        where: { orderId_eventId: { orderId: row.orderId, eventId: row.id } },
      });
      if (consumed?.fact !== row.fact) throw new Error('SAGA_NOT_CONSUMED');
      await this.db.localOrderFact.updateMany({
        where: { id: row.id, deliveredAt: null }, data: { deliveredAt: new Date() },
      });
    }
    return rows.length;
  }
}
```

To register this in the existing `OrdersModule`, merge `{ provide: SAGA_STORE, useClass: PrismaSagaStore }`, `AdvanceOrderHandler`, `OrderSaga`, `RecordPackingResultHandler`, and `LocalOrderFactRelay` into providers, and export `LocalOrderFactRelay`. Import each class from the files above. Keep `MemorySagaStore` and `OrderSagaLabModule` only for isolated unit experiments. Reuse the CQRS root from Chapter 16 and the existing database registration. After bootstrap completes, the job executor runs `await localOrderFactRelay.runBatch()`, querying undelivered rows again at startup and on subsequent job executions. Do not call this relay inside a database transaction or the Saga's `handle`.

A crash after saving a packing result but before notification is recovered through the undelivered `LocalOrderFact`. A crash after the Saga commits but before marking `deliveredAt` also ends at the Inbox when the same ID is published again. Chapter 23's `FulfillmentIntentRelay` reconstructs the `${orderId}:fulfillment.request:v1` row created by consuming the packing fact into an actual command. Chapter 23 returns acceptance through the same local fact relay, so Saga completion does not depend on the presence of a remote consumer.

## Observe the Execution Order Directly

The following is the **complete test file** `src/orders/saga/order-saga.test.ts`. It uses Node24 and pnpm10 and requires the first two files above and the project's existing Vitest configuration. It does not call a real payment provider, mail service, or broker. `bootstrapApplication` expresses that this experiment does not need an HTTP listener.

```ts
import { describe, expect, it } from 'vitest';
import { bootstrapApplication } from '@fluojs/runtime';
import { CqrsEventBusService } from '@fluojs/cqrs';
import {
  MemorySagaStore, OrderFact, OrderSagaLabModule, SAGA_STORE,
} from './order-saga.js';

describe('order saga decisions', () => {
  it('requests packing before fulfillment and deduplicates facts', async () => {
    const app = await bootstrapApplication({ rootModule: OrderSagaLabModule });
    try {
      const bus = await app.container.resolve(CqrsEventBusService);
      const store = await app.container.resolve<MemorySagaStore>(SAGA_STORE);
      const paid = new OrderFact('e-1', 'order-1', 'payment.confirmed');
      await bus.publish(paid);
      await bus.publish(paid);
      expect(store.outbox.size).toBe(1);
      expect([...store.outbox.values()].map(value => value.kind))
        .toEqual(['packing.request']);
      expect(store.states.get('order-1')?.revision).toBe(1);

      const packed = new OrderFact('e-2', 'order-1', 'packing.confirmed');
      await bus.publish(packed);
      await bus.publish(packed);
      expect([...store.outbox.values()].map(value => value.kind))
        .toEqual(['packing.request', 'fulfillment.request']);
      expect(store.states.get('order-1')?.phase).toBe('awaiting_fulfillment');
      expect(store.states.get('order-1')?.revision).toBe(2);

      const accepted = new OrderFact(
        'order-1:fulfillment.accepted:v1', 'order-1', 'fulfillment.accepted',
      );
      await bus.publish(accepted);
      await bus.publish(accepted);
      expect(store.states.get('order-1')?.phase).toBe('fulfilled');
      expect(store.states.get('order-1')?.revision).toBe(3);
      expect(store.outbox.size).toBe(2);
    } finally {
      await app.close();
    }
  });

  it('requests compensation without inventing a refund result', async () => {
    const store = new MemorySagaStore();
    await store.consume(new OrderFact('e-4', 'order-2', 'payment.confirmed'));
    await store.consume(new OrderFact('e-5', 'order-2', 'packing.rejected'));
    expect([...store.outbox.values()].map(value => value.kind))
      .toEqual(['packing.request', 'refund.request']);
    expect(store.states.get('order-2')?.phase).toBe('awaiting_refund');

    await expect(store.consume(
      new OrderFact('e-6', 'order-2', 'packing.confirmed'),
    )).rejects.toThrow('Conflicting or premature packing outcome');
    expect(store.inbox.has('order-2:e-6')).toBe(false);
    expect(store.states.get('order-2')?.revision).toBe(2);

    await store.consume(new OrderFact('e-7', 'order-2', 'refund.confirmed'));
    expect(store.states.get('order-2')?.phase).toBe('refunded');
  });

  it('does not consume a result before its request', async () => {
    const store = new MemorySagaStore();
    await expect(store.consume(
      new OrderFact('e-8', 'order-3', 'packing.confirmed'),
    )).rejects.toThrow('Conflicting or premature packing outcome');
    expect(store.states.has('order-3')).toBe(false);
    expect(store.inbox.has('order-3:e-8')).toBe(false);
    expect(store.outbox.size).toBe(0);
  });

  it('hands a refund-first order back without requesting another refund', async () => {
    const store = new MemorySagaStore();
    await store.consume(new OrderFact('p-4', 'order-4', 'payment.confirmed'));
    await store.consume(new OrderFact('k-4', 'order-4', 'packing.confirmed'));
    const superseded = new OrderFact(
      'order-4:fulfillment.superseded:v1', 'order-4', 'fulfillment.superseded',
    );
    await store.consume(superseded);
    await store.consume(superseded);
    expect(store.states.get('order-4')?.phase).toBe('superseded');
    expect(store.states.get('order-4')?.revision).toBe(3);
    expect([...store.outbox.values()].map(value => value.kind))
      .toEqual(['packing.request', 'fulfillment.request']);
    await expect(store.consume(new OrderFact(
      'invalid-acceptance', 'order-4', 'fulfillment.accepted',
    ))).rejects.toThrow('Unexpected fulfillment acknowledgement');
  });
});
```

```sh
pnpm exec vitest run src/orders/saga/order-saga.test.ts
```

The expected result is one packing intent and one fulfillment handoff intent for the first order, with redelivery of the same acceptance not increasing the Saga's `revision`. The second order remains **waiting** after requesting a refund and finishes only when a confirmed refund result arrives. An order whose refund wins the admission race finishes as `superseded` without creating a new refund. `new OrderFact(...)` in this in-memory test is an experiment with the decision function's input, not evidence of production approval. Missing approval, actual database commits, and local relay recovery are verified separately in [Chapter 28's integration drills](./ch28-failure-drills.md).

In the database experiment, consume a payment confirmation event for the same order concurrently from two connections. Use a barrier so that the test releases the lock holder after both connections signal transaction entry, creating contention without arbitrary delays. After both commit, there must be one packing intent row. If an exception is deliberately thrown immediately after the Outbox write, both the Saga state change and Inbox entry must be absent. This failure must not undo the order's already committed `paid` state or its `consumed` reservations. If execution stops just before saving confirmation after delivery, the same intent ID must reappear after restart, while the packing admission record remains singular. These are distinct failure windows; do not combine them into one "retry test."

## Read the Guarantees of `await` Narrowly

`CqrsEventBusService.publish` proceeds through matching EventHandlers, Sagas, and delegated event-bus publication in that order. `publishAll` waits for each event's pipeline before starting the next event. But this is not a database transaction. If an earlier handler saves successfully and a Saga then fails, the earlier write is not automatically undone. Each durable consumption boundary must therefore be safe against duplicates.

Also, only one `handle` can be active at a time for a Saga singleton provider token. This is not a per-order lock; it is **an execution queue for the entire provider**. Waiting a long time for a slow external API in `handle` for one order also affects orders behind it. That is why this Saga executes only a short persistence command and sends external requests through the Outbox. Rather than creating arbitrary providers for every order to evade this constraint, first remove long I/O and measure the actual bottleneck.

If a Saga publishes another event handled by the same provider, the ensuing execution becomes serialized follow-up work. The return of a nested `publish` does not mean the follow-up `handle` has already completed. Dangerous cycles returning to the same path are subject to `SagaTopologyError`. Pass the received `CqrsDispatchContext` unchanged to nested `execute`, `publish`, and `publishAll` calls to preserve this protection. Do not clone this object or use it as a context for storing business data. Carry order IDs and trace IDs in event payloads or separate log fields.

During shutdown, CQRS waits for a bounded time for disposal of in-flight pipelines and Saga executions. This does not guarantee persistence through forced termination or deadline expiry. Operators need visibility into stalled Saga phases, the last progress time, retry counts, and counts by cause. Putting permanent packing-result conflicts and temporary database connection failures in the same infinite retry list hides errors that require human attention.

Orders can now request packing after confirmed payment, determine the next action from the result, and wait until fulfillment handoff or refund results are confirmed. There is no need to turn every CRUD operation into a Saga. Direct calls are easier to read for short local transactions, while a separate workflow engine may be better for business processes with many long-running stages requiring audit. For now, the small coordinator between packing, fulfillment handoff, and refunds is enough to make previously missing responsibilities explicit. In the next chapter, we deliver these confirmed facts to customers and operators. Notification failures must not undo an order's payment or fulfillment decisions.

## Evidence and Further Experiments

- [Shared implementation boundaries](../EDITORIAL.md): continuity of `BlogDatabaseModule`, the payment ledger, reservation consumption, order transition audits, and versions.
- [CQRS usage and Saga contracts](../../packages/cqrs/README.md): singleton discovery, event copying, pipeline order, and shutdown contracts.
- [Public exports](../../packages/cqrs/src/index.ts) and [message and context types](../../packages/cqrs/src/types.ts): the registration and injection surface used in this chapter.
- [CQRS event bus implementation](../../packages/cqrs/src/buses/event-bus.ts): publication order and in-flight work tracking.
- [Saga FIFO regression tests](../../packages/cqrs/src/saga-fifo-contract.test.ts): ordering of external publication and nested follow-up execution.
- [Topology regression tests](../../packages/cqrs/src/dispatch-topology-contract.test.ts): cycle detection and opaque context.
- [Shutdown deadline tests](../../packages/cqrs/src/shutdown-deadline-contract.test.ts): the actual scope of shutdown waiting. These tests were not rerun while writing this chapter.
