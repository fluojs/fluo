# Extracting Fulfillment into a Separate Service

<!-- book:volume=02-fluoshop;chapter=23 -->

[Previous: Selling to International Readers](./ch22-international-commerce.md) - [Volume 2 Contents](./toc.md) - [Next: A Lab for Choosing Message Transports](./ch24-transport-lab.md)

## The First Service Extraction Starts with Operational Evidence

Now that FluoShop can provide guidance to international readers, another problem has emerged. The batch that creates warehouse label files uses a lot of memory, and every change to the shipping integration requires redeploying the blog's HTTP process too. Post and order queries themselves are stable. Rather than splitting accounts, products, and orders into services, we now have a reason to move only the acceptance and execution of shipping work from the already modular `FulfillmentModule` into a separate process.

Even before extraction, payment confirmation and the start of fulfillment happened at different times. The Saga from Chapter 17 checks `paid` and consumed reservations before requesting packing, and creates `fulfillment.request` only after receiving confirmed packing approval. Its local receiver stores the order's `paid -> fulfilling` transition and acceptance of the fulfillment request in one DB transaction. After extraction, the order DB and fulfillment DB cannot commit together, so we retain the **boundary that durably accepts a local fulfillment request into an Outbox** and move only the work beyond it. Replacing a function call with `send()` alone does not preserve the previous guarantee.

This chapter ends when **a fulfillment request is accepted once as durable work in a separate service**. It does not issue real shipping labels or call an external carrier. The existing shipping adapter remains in the new service's job execution stage, along with the idempotency and reconciliation contracts it requires. Extraction begins by distinguishing `fulfilling` from `shipped`, rather than saying a box has been sent because an API succeeded.

## Separate Authority over Orders and Fulfillment

`AccountsModule`, `PostsModule`, `CatalogModule`, `InventoryModule`, `OrdersModule`, and `PaymentsModule` remain in the existing `fluo-blog` process. We do not duplicate user and order tables into the fulfillment DB and create two authorities. The fulfillment service owns the requests it accepts, shipment jobs, and actual dispatch results. An order ID is an identifier crossing a service boundary, not an invitation to JOIN another DB directly.

In the order DB, `fulfilling` means **local acceptance of a durable intent after verifying packing approval**. This commit records `paid/version=1 -> fulfilling/version=2`, a v2 `OrderTransition`, a shipping `FulfillmentOutbox`, and the `fulfillment.accepted` fact together. The acceptance awaited by the Saga in Chapter 17 is this local fact, not an ACK from the remote consumer. Local acceptance and Saga completion are possible even without a remote consumer, while the fulfillment DB may still contain no job. The fulfillment service's `awaiting_dispatch` is a separate state: the remote Inbox and job have committed, but external dispatch has not started. Later, when actual dispatch evidence arrives, the order service uses `OrderTransitionsService.apply()` to record the `shipment_recorded` transition and its audit together, changing the order to `shipped/version=3`. The fulfillment service does not directly UPDATE the order DB.

Do not send only "the customer's current address ID" either. Editing an address book must not change the shipping address of a paid order. This request carries the address snapshot validated and frozen at order time. Include no more account information or payment tokens than necessary, and log only `eventId`, `orderId`, and failure codes rather than the raw address. `locale` is the notification language; it does not determine the shipping country or order currency.

The following `src/fulfillment/fulfillment-request.ts` is a **complete contract file** used at the same version by both processes. It covers only the current product scope of shipping one order once. Split shipments require a new contract allowing several jobs per order, so even the unique key must change.

```ts
export const FULFILLMENT_REQUESTED = 'fulfillment.requested.v1';

export interface FulfillmentRequest {
  eventId: string;
  orderId: string;
  orderVersion: number;
  packingApprovalId: string;
  locale: 'ko' | 'en';
  items: Array<{ sku: string; quantity: number }>;
  shipTo: {
    countryCode: 'KR' | 'US';
    city: string;
    line1: string;
    postalCode: string;
  };
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Invalid fulfillment object');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
    throw new TypeError('Invalid fulfillment text');
  }
  return value;
}

export function parseFulfillmentRequest(value: unknown): FulfillmentRequest {
  const input = record(value);
  const address = record(input.shipTo);
  if (input.locale !== 'ko' && input.locale !== 'en') {
    throw new TypeError('Unsupported notification locale');
  }
  if (address.countryCode !== 'KR' && address.countryCode !== 'US') {
    throw new TypeError('Unsupported shipping country');
  }
  if (input.orderVersion !== 2) {
    throw new TypeError('Invalid order version');
  }
  const orderId = text(input.orderId, 160);
  const eventId = text(input.eventId, 240);
  const packingApprovalId = text(input.packingApprovalId, 240);
  if (eventId !== `${orderId}:fulfillment.request:v1` ||
      packingApprovalId !== `${orderId}:packing.confirmed:v1`) {
    throw new TypeError('Invalid fulfillment identity');
  }
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 20) {
    throw new TypeError('Invalid shipment items');
  }
  const items = input.items.map((value: unknown) => {
    const item = record(value);
    if (typeof item.quantity !== 'number'
      || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) {
      throw new TypeError('Invalid shipment quantity');
    }
    return { sku: text(item.sku, 80), quantity: item.quantity };
  }).sort((a, b) => a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0);
  if (new Set(items.map((item) => item.sku)).size !== items.length) {
    throw new TypeError('Duplicate shipment SKU');
  }
  return {
    eventId,
    orderId,
    orderVersion: input.orderVersion,
    packingApprovalId,
    locale: input.locale,
    items,
    shipTo: {
      countryCode: address.countryCode,
      city: text(address.city, 100),
      line1: text(address.line1, 200),
      postalCode: text(address.postalCode, 20),
    },
  };
}
```

This validates the structure and ranges of service input. `orderVersion=2` is the version at which local acceptance has already committed in this single-shipment flow, while `v1` in the pattern is the message contract version. The shape of an approval ID alone does not prove packing. The producer below checks the actual approval row, and only that producer receives publish permission on the remote queue. This contract does not hold if arbitrary customer or warehouse payloads can be written directly to the remote queue. Actual address validity and permission to sell belong to the order-creation boundary, while normalizing SKU order stabilizes the hash of the same request.

## Read the Approved Order Snapshot, Not the Caller's Address

The `Order` from Chapter 6 had no address fields. Add the following **model addition** for storing the shipping address and the inverse relation `Order.shippingSnapshot OrderShippingSnapshot?` to the order Prisma schema. Do not join current product or account values. `OrderItem` continues to use the SKU and quantity already frozen in earlier chapters.

```prisma
model OrderShippingSnapshot {
  orderId     String @id
  order       Order @relation(fields: [orderId], references: [id], onDelete: Restrict)
  locale      String
  countryCode String
  city        String
  line1       String
  postalCode  String
}
```

The following **storage fragment** goes inside the existing order-creation transaction. `tx` is that transaction's client; `order` is the order created after the server recalculates prices; and `verifiedShipping` is the value after server-side address validation, checks on permitted sales countries, and notification locale normalization. Its fields are the model's `locale`, `countryCode`, `city`, `line1`, and `postalCode`, not a customer's `orderId` or items. Commit it together with the order, items, and reservations, and provide no path that edits this snapshot. If existing address snapshot fields are already present, apply an explicit mapping from those values to this model at creation. Do not fill gaps for already-paid orders from the current address book.

```ts
await tx.orderShippingSnapshot.create({
  data: {
    orderId: order.id,
    locale: verifiedShipping.locale,
    countryCode: verifiedShipping.countryCode,
    city: verifiedShipping.city,
    line1: verifiedShipping.line1,
    postalCode: verifiedShipping.postalCode,
  },
});
```

The warehouse screen from Chapter 17 also queries this snapshot and `OrderItem`. The actual additional method for the approval screen's internal query is the following **provider method fragment**. `this.db` is the existing shared `PrismaService`, and only an authenticated warehouse-only boundary calls it. The approval command carries only the queried `orderId` and the outcome; it does not accept the query data back as input to overwrite it. Because the address and items remain immutable during packing, the approval result's `orderVersion=1` can be matched to the paid source order.

```ts
async packingView(orderId: string) {
  const order = await this.db.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { items: { orderBy: { sku: 'asc' } }, shippingSnapshot: true },
  });
  if (order.status !== 'paid' || order.version !== 1 || !order.shippingSnapshot) {
    throw new Error('PACKING_SNAPSHOT_UNAVAILABLE');
  }
  return { orderId: order.id, items: order.items, shipTo: order.shippingSnapshot };
}
```

## Leave an Outbox Between the Order Commit and Publication

Instead of the direct call used before extraction, write a fulfillment request Outbox in the order DB. The following **model fragment** is added to the existing Prisma schema. The existing `Order` fields `id`, `customerId`, `status`, `currency`, `totalMinor`, and `version` remain unchanged. This example uses a string `order.id`. A Fluo package does not install this table.

```prisma
model FulfillmentOutbox {
  id          String    @id
  orderId     String    @unique
  payloadJson String
  publishedAt DateTime?
  createdAt   DateTime  @default(now())

  @@index([publishedAt, createdAt])
}
```

The following `src/orders/request-fulfillment.ts` is a **complete local command and handler file**. It continues to inject the `PrismaService` provided by the existing root's `BlogDatabaseModule` and `OrderTransitionsService`. `AdmitFulfillment` contains only a stored Saga intent ID. Remove the old entry point that lets a caller start fulfillment by submitting a paid order ID along with a new address, items, and authority. Accept the request only when the loaded intent, packing approval, consumed reservations, and frozen snapshot all agree.

```ts
import { Inject } from '@fluojs/core';
import { CommandHandler, type ICommandHandler } from '@fluojs/cqrs';
import { PrismaService, type PrismaServiceFacade } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import { parseFulfillmentRequest } from '../fulfillment/fulfillment-request.js';
import { OrderTransitionsService } from './order-transitions.service.js';

export class AdmitFulfillment {
  constructor(public readonly intentId: string) {}
}

@Inject(PrismaService, OrderTransitionsService)
@CommandHandler(AdmitFulfillment)
export class RequestFulfillment implements ICommandHandler<AdmitFulfillment> {
  constructor(
    private readonly prisma: PrismaServiceFacade<PrismaClient>,
    private readonly transitions: OrderTransitionsService,
  ) {}

  async execute(command: AdmitFulfillment): Promise<void> {
    await this.prisma.transaction(async () => {
      const intent = await this.prisma.sagaIntent.findUniqueOrThrow({
        where: { id: command.intentId },
      });
      const { orderId } = intent;
      if (intent.kind !== 'fulfillment_request' ||
          intent.id !== `${orderId}:fulfillment.request:v1`) {
        throw new Error('INVALID_FULFILLMENT_INTENT');
      }
      await this.prisma.$queryRaw`
        SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE
      `;
      const approval = await this.prisma.packingResult.findUnique({ where: { orderId } });
      const saga = await this.prisma.orderSaga.findUniqueOrThrow({ where: { orderId } });
      if (!approval || approval.outcome !== 'confirmed' ||
          approval.requestId !== `${orderId}:packing.request:v1` ||
          approval.orderVersion !== 1 ||
          !['awaiting_fulfillment', 'fulfilled', 'superseded'].includes(saga.phase)) {
        throw new Error('PACKING_APPROVAL_REQUIRED');
      }
      const order = await this.prisma.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { items: true, reservations: true, shippingSnapshot: true },
      });
      const snapshot = order.shippingSnapshot;
      if (!snapshot || order.items.length === 0 ||
          order.items.length !== order.reservations.length ||
          order.items.some(item => !order.reservations.some(row =>
            row.sku === item.sku && row.quantity === item.quantity &&
            row.state === 'consumed'))) {
        throw new Error('FULFILLMENT_SNAPSHOT_CONFLICT');
      }
      const request = parseFulfillmentRequest({
        eventId: intent.id, orderId, orderVersion: 2,
        packingApprovalId: `${orderId}:packing.confirmed:v1`,
        locale: snapshot.locale,
        shipTo: {
          countryCode: snapshot.countryCode, city: snapshot.city,
          line1: snapshot.line1, postalCode: snapshot.postalCode,
        },
        items: order.items.map(({ sku, quantity }) => ({ sku, quantity })),
      });
      const payloadJson = JSON.stringify(request);
      const previous = await this.prisma.fulfillmentOutbox.findUnique({
        where: { id: request.eventId },
      });
      if (previous) {
        if (previous.payloadJson !== payloadJson) {
          throw new Error('FULFILLMENT_REQUEST_CONFLICT');
        }
        return;
      }
      if (order.status === 'refund_pending' || order.status === 'refunded') {
        const refund = await this.prisma.refundRequest.findUnique({ where: { orderId } });
        if (!refund) throw new Error('REFUND_INTENT_MISSING');
        await this.prisma.localOrderFact.upsert({
          where: { id: `${orderId}:fulfillment.superseded:v1` },
          create: {
            id: `${orderId}:fulfillment.superseded:v1`,
            orderId, fact: 'fulfillment.superseded',
          },
          update: {},
        });
        return;
      }
      if (order.status !== 'paid' || order.version !== 1) {
        throw new Error('ORDER_NOT_ADMISSIBLE');
      }
      await this.transitions.apply(
        orderId,
        1,
        { type: 'fulfillment_started' },
        { subject: 'system:packing-approved-admission', scopes: ['orders:fulfill'] },
      );
      await this.prisma.fulfillmentOutbox.create({
        data: { id: request.eventId, orderId: request.orderId, payloadJson },
      });
      await this.prisma.localOrderFact.create({
        data: {
          id: `${orderId}:fulfillment.accepted:v1`,
          orderId, fact: 'fulfillment.accepted',
        },
      });
    });
  }
}
```

Add `RequestFulfillment` to the existing `OrdersModule.providers`. Do not duplicate the `OrderTransitionsService` already provided by that module. The outer `prisma.transaction()` and the nested transaction in `apply()` share the **ALS context of the same PrismaService**. If any write to the order state, version, audit, fulfillment Outbox, or local acceptance fact fails, they all roll back. Do not publish CQRS events or broker messages inside the handler.

After acquiring the order lock, a duplicate command compares the existing Outbox with the source snapshot. Even if the order is already `fulfilling` or `shipped`, it reuses the same acceptance without creating a new version. The per-order unique key also prevents a second request. Reservations are only checked; the handler does not call `settle('consumed')` or deduct more inventory. Payments continue through `PaymentLedger.prepare/record` and `OrderInventoryService.confirmPayment()`.

`RefundService.request` from Chapter 11 also locks the same order row first. If a refund commits `refund_pending` and `RefundRequest` first, no fulfillment Outbox or acceptance is created, and `fulfillment.superseded` ends the Saga. The existing refund executor completes that refund without creating a new refund intent. If acceptance commits first, the refund request returns 409 and external refund execution does not start either. An absent consumer, the failed queue, or a lost ACK is not grounds for reversing this decision. There is no path that reverts `fulfilling -> paid/refund_pending` or deletes the Outbox to issue an automatic refund.

## Who Executes the Stored Command and Acceptance?

The following **complete provider file**, `src/orders/saga/fulfillment-intent-relay.ts`, actually consumes the intent from Chapter 17. Instead of inventing a new kind of queue payload, it reconstructs the CQRS command from the stored ID.

```ts
import { Inject } from '@fluojs/core';
import { CommandBusLifecycleService } from '@fluojs/cqrs';
import { PrismaService, type PrismaServiceFacade } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import { AdmitFulfillment } from '../request-fulfillment.js';

@Inject(PrismaService, CommandBusLifecycleService)
export class FulfillmentIntentRelay {
  constructor(
    private readonly db: PrismaServiceFacade<PrismaClient>,
    private readonly commands: CommandBusLifecycleService,
  ) {}

  async runBatch(): Promise<number> {
    const rows = await this.db.sagaIntent.findMany({
      where: { kind: 'fulfillment_request', dispatchedAt: null },
      orderBy: { id: 'asc' }, take: 20,
    });
    for (const row of rows) {
      await this.commands.execute(new AdmitFulfillment(row.id));
      await this.db.sagaIntent.updateMany({
        where: { id: row.id, dispatchedAt: null },
        data: { dispatchedAt: new Date() },
      });
    }
    return rows.length;
  }
}
```

Import `FulfillmentIntentRelay` into the existing `OrdersModule` and add it to both providers and exports. Keep the Chapter 17 `PrismaSagaStore` registration and `LocalOrderFactRelay` in that same module. The following **batch entry file**, `src/orders/saga/run-fulfillment-handoff.ts`, defines the call order for the actual job executor. Its two arguments are the relays injected from that module. After bootstrap, the existing executor awaits this function during startup recovery and repeated batches; failures propagate to the existing rescheduling boundary. On shutdown, it does not start a new batch and waits for the in-flight call.

```ts
import type { LocalOrderFactRelay } from './local-order-fact-relay.js';
import type { FulfillmentIntentRelay } from './fulfillment-intent-relay.js';

export async function runFulfillmentHandoff(
  facts: LocalOrderFactRelay,
  intents: FulfillmentIntentRelay,
): Promise<void> {
  await facts.runBatch();
  await intents.runBatch();
  await facts.runBatch();
}
```

The first call consumes packing facts through `OrderFact -> OrderSaga -> AdvanceOrderHandler -> PrismaSagaStore` to create the command, the second commits local acceptance, and the third sends stored acceptance back through the same Saga path. There is no guarantee that one pass exhausts the whole batch of work, so the next batch also reads the store. Recovery does not use a "next step" retained in process memory.

If the process dies immediately after the acceptance commit, `${orderId}:fulfillment.accepted:v1` remains with `deliveredAt=null`. The new process's facts batch consumes it, and rerunning the unmarked command finds the original Outbox and finishes. If the process dies immediately after Saga consumption, redelivery of the same acceptance stops at `SagaInbox` without increasing `revision` or intents. If no Saga consumer is registered, the Chapter 17 relay raises `SAGA_NOT_CONSUMED` and keeps the row undelivered. This recovery does not require a remote RabbitMQ consumer.

This batch and the broker relay below are **job entry points outside an active transaction**. Do not mistake the return of a nested `transaction()` on the same facade for the outermost commit. Wrapping the batch in a request-wide transaction or calling it again from the Saga's `handle` can publish uncommitted facts or wait on its own lock.

A separate fulfillment Outbox relay calls `emit()` on the `MICROSERVICE` facade and writes `publishedAt` only for successful records. `src/fulfillment/fulfillment-relay.ts` is a **complete provider file** that uses the same global `PrismaService`. Completion of this relay means broker publication confirmation, distinct even from local `fulfillment.accepted`.

```ts
import { Inject } from '@fluojs/core';
import { MICROSERVICE, type Microservice } from '@fluojs/microservices';
import { PrismaService, type PrismaServiceFacade } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import { FULFILLMENT_REQUESTED, parseFulfillmentRequest } from './fulfillment-request.js';

@Inject(PrismaService, MICROSERVICE)
export class FulfillmentRelay {
  constructor(
    private readonly prisma: PrismaServiceFacade<PrismaClient>,
    private readonly microservice: Microservice,
  ) {}

  async runBatch(): Promise<number> {
    const rows = await this.prisma.fulfillmentOutbox.findMany({
      where: { publishedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 20,
    });
    for (const row of rows) {
      const payload = parseFulfillmentRequest(JSON.parse(row.payloadJson));
      await this.microservice.emit(FULFILLMENT_REQUESTED, payload);
      await this.prisma.fulfillmentOutbox.updateMany({
        where: { id: row.id, publishedAt: null },
        data: { publishedAt: new Date() },
      });
    }
    return rows.length;
  }
}
```

The existing job executor calls `runBatch()` and reschedules failed batches. Do not hide infinite retries or sleeps inside this function. If the process dies immediately after successful publication, the DB marker is absent, so the same event is sent again. Two relays reading the same batch can also produce duplicates. You can add claims and leases for higher throughput, but final responsibility for deduplication remains with the receiving Inbox. `publishedAt` is not the shipping completion time.

## Store the Inbox and Job Together in the Fulfillment DB

Place the following **model fragments** in the fulfillment process's Prisma schema. This is a different DB from the Outbox above. `FULFILLMENT_DB` below is a raw client token used only by this separate process, not a second wrapper alongside the monolith's `BlogDatabaseModule`. The primary key on `ShipmentJob.orderId` expresses the current "one order, one shipment job" policy. Do not create a DB foreign key to the external `Order`.

```prisma
model FulfillmentInbox {
  eventId     String   @id
  payloadHash String
  receivedAt  DateTime @default(now())
}

model ShipmentJob {
  orderId      String   @id
  eventId      String   @unique
  orderVersion Int
  payloadJson  String
  status       String   @default("awaiting_dispatch")
  createdAt    DateTime @default(now())
}
```

`src/fulfillment/fulfillment-handler.ts` is a **complete file** using the client generated from the fulfillment models above. Each process generates its own `@prisma/client` from its own schema. This does not mean one monolith client automatically connects to both DBs.

```ts
import { createHash } from 'node:crypto';
import { Inject } from '@fluojs/core';
import { EventPattern } from '@fluojs/microservices';
import type { PrismaClient } from '@prisma/client';
import { FULFILLMENT_REQUESTED, parseFulfillmentRequest } from './fulfillment-request.js';

export const FULFILLMENT_DB = Symbol('shop.fulfillment-db');

@Inject(FULFILLMENT_DB)
export class FulfillmentHandler {
  constructor(private readonly db: PrismaClient) {}

  @EventPattern(FULFILLMENT_REQUESTED)
  async accept(value: unknown): Promise<void> {
    const request = parseFulfillmentRequest(value);
    const payloadJson = JSON.stringify(request);
    const payloadHash = createHash('sha256').update(payloadJson).digest('hex');

    await this.db.$transaction(async (tx) => {
      await tx.fulfillmentInbox.createMany({
        data: [{ eventId: request.eventId, payloadHash }],
        skipDuplicates: true,
      });
      const inbox = await tx.fulfillmentInbox.findUniqueOrThrow({
        where: { eventId: request.eventId },
      });
      if (inbox.payloadHash !== payloadHash) {
        throw new Error('FULFILLMENT_EVENT_CONFLICT');
      }

      await tx.shipmentJob.createMany({
        data: [{
          orderId: request.orderId,
          eventId: request.eventId,
          orderVersion: request.orderVersion,
          payloadJson,
        }],
        skipDuplicates: true,
      });
      const job = await tx.shipmentJob.findUniqueOrThrow({
        where: { orderId: request.orderId },
      });
      if (job.eventId !== request.eventId || job.payloadJson !== payloadJson) {
        throw new Error('FULFILLMENT_ORDER_CONFLICT');
      }
    });
  }
}
```

PostgreSQL uniqueness constraints and transactions coordinate concurrent duplicates. We must compare the existing records after `createMany(..., skipDuplicates: true)` because "already exists" does not mean "has the same meaning." A changed address under the same event ID, or a new event ID for the same order, surfaces as a conflict. If the Inbox is written but job creation fails, both roll back. Redelivery after successful processing verifies the same stored result and finishes.

This handler accepts only remote work and does not publish `fulfillment.accepted`. That name already denotes the local acceptance fact in the producer DB. Evidence of remote storage is this DB's Inbox and `ShipmentJob`; final shipping evidence is the actual shipping result. Do not use their names interchangeably.

There is no process-memory `Set` or Redis TTL key here. An idempotency retention period shorter than the shipment job's lifetime would make a late redelivery look like new work. Decide Inbox retention and deletion together with the retention policy for order and shipping records. Do not call the actual carrier API inside this DB transaction. Separate that call into the job execution stage so a long-lived transaction does not wait for external delays, and handle duplicate shipping-label creation using that stage's stable request key and reconciliation.

## We Wire the RabbitMQ ACK Policy

`RabbitMqMicroserviceTransport` does not automatically create an `amqplib` connection. The application supplies `publisher.publish(queue, message)` and `consumer.consume(queue, handler)`/`cancel(queue)`. Specifying a queue name alone does not automatically provide a durable queue, publisher confirms, failure retries, or a DLX.

The following `src/fulfillment/rabbit-events.ts` is an **event-only composition file**. It receives a prepared `ConfirmChannel` and consumer channel; the existing configuration and bootstrap boundary owns actual connection creation. Running this file can create the declared lab queues, so it is not run as part of reviewing the chapter. Connect it only in an isolated RabbitMQ lab environment, not arbitrarily against existing production queues.

```ts
import type { Channel, ConfirmChannel } from 'amqplib';
import type { RabbitMqMicroserviceTransportOptions } from '@fluojs/microservices';

const eventQueue = 'shop.fulfillment.requests.v1';
const failedQueue = 'shop.fulfillment.failed.v1';

export async function rabbitEventOptions(
  publisherChannel: ConfirmChannel,
  consumerChannel: Channel,
  role: 'producer' | 'worker',
  reportChannelError: (error: unknown) => void,
): Promise<RabbitMqMicroserviceTransportOptions> {
  await publisherChannel.assertQueue(failedQueue, { durable: true });
  await publisherChannel.assertQueue(eventQueue, {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': '',
      'x-dead-letter-routing-key': failedQueue,
    },
  });
  await consumerChannel.prefetch(8);
  const tags = new Map<string, string>();

  return {
    eventQueue,
    messageQueue: 'shop.fulfillment.unused-rpc.v1',
    publisher: {
      publish(queue, message) {
        return new Promise<void>((resolve, reject) => {
          publisherChannel.sendToQueue(queue, Buffer.from(message), {
            persistent: true,
            contentType: 'application/json',
          }, (error: unknown) => {
            if (error) reject(error);
            else resolve();
          });
        });
      },
    },
    consumer: {
      async consume(queue, handler) {
        if (role !== 'worker' || queue !== eventQueue) return;
        const reply = await consumerChannel.consume(queue, (message) => {
          if (message === null) return;
          void Promise.resolve()
            .then(() => handler(message.content.toString('utf8')))
            .then(
              () => consumerChannel.ack(message),
              () => consumerChannel.nack(message, false, false),
            )
            .catch(reportChannelError);
        }, { noAck: false });
        tags.set(queue, reply.consumerTag);
      },
      async cancel(queue) {
        const tag = tags.get(queue);
        if (tag === undefined) return;
        await consumerChannel.cancel(tag);
        tags.delete(queue);
      },
    },
  };
}
```

This composition deliberately does not subscribe to a reply queue for `send()`. A producer consuming its own outbound event queue could intercept messages intended for the fulfillment worker. Only the worker subscribes to the fulfillment queue; the producer makes the consume calls issued during registration no-ops. If RPC is needed, implement a separate role-specific request/reply topology. Do not call this file a general-purpose RabbitMQ adapter.

The publisher's Promise waits for the confirm callback. This is evidence of broker acceptance, not of remote handler completion. Because it publishes small batches sequentially, the example does not buffer without limit. To increase throughput, also manage channel backpressure and a cap on outstanding confirms. Declared durable queues and persistent messages do not replace the actual broker's replication, disk, and operational settings.

The consumer ACKs after the handler Promise finishes. On failure, it isolates the message in the declared failed queue instead of immediately requeuing forever. `reportChannelError` must be an application instrumentation callback that does not throw. This initial policy isolates both transient DB outages and schema errors. After correcting the cause, the operator redelivers with the same event ID. If automatic delayed retries become necessary, build a separate retry path with explicit attempt counts and isolation limits.

Fluo keeps the consumer callback pending until a RabbitMQ event handler completes and returns event handler failures as callback rejections. That makes this ACK policy possible. A request handler failure, in contrast, can complete the callback normally if publishing the error response succeeds. Do not generalize this into a rule that "all handler errors cause redelivery."

## Complete Module Registration and the Process Boundary

The fulfillment process's `src/app.ts` is the following **complete module composition file**. The caller finishes creating and connecting `PrismaClient` and creating the RabbitMQ channels before passing them in.

```ts
import { Module } from '@fluojs/core';
import {
  MicroservicesModule,
  RabbitMqMicroserviceTransport,
  type RabbitMqMicroserviceTransportOptions,
} from '@fluojs/microservices';
import type { PrismaClient } from '@prisma/client';
import { FULFILLMENT_DB, FulfillmentHandler } from './fulfillment/fulfillment-handler.js';

export function createFulfillmentModule(
  db: PrismaClient,
  options: RabbitMqMicroserviceTransportOptions,
) {
  @Module({
    imports: [
      MicroservicesModule.forRoot({
        transport: new RabbitMqMicroserviceTransport(options),
      }),
    ],
    providers: [
      { provide: FULFILLMENT_DB, useValue: db },
      FulfillmentHandler,
    ],
  })
  class FulfillmentModule {}

  return FulfillmentModule;
}
```

Registering a prepared client with `useValue` does not automatically transfer ownership of `$disconnect()`. Connect the consumer through an explicit token and class-level `@Inject`; the creator remains responsible for resource disposal. A class decorated with `@EventPattern` is not discovered unless it is also in `providers`.

In the order process, place the following **complete composition file** at `src/fulfillment/fulfillment-publisher.module.ts`. The existing `OrdersModule` imports the returned module, and the job executor receives `FulfillmentRelay` through injection. The root `src/app.ts` already imports `BlogDatabaseModule`, so do not register the DB again here. `producerOptions` is the result of the earlier function with `role: 'producer'`. If the process already has a microservice registration, compose the publication path in its owning module rather than duplicating an independent root registration.

```ts
import { Module } from '@fluojs/core';
import {
  MicroservicesModule,
  RabbitMqMicroserviceTransport,
  type RabbitMqMicroserviceTransportOptions,
} from '@fluojs/microservices';
import { FulfillmentRelay } from './fulfillment-relay.js';

export function createFulfillmentPublisherModule(
  producerOptions: RabbitMqMicroserviceTransportOptions,
) {
  @Module({
    imports: [
      MicroservicesModule.forRoot({
        transport: new RabbitMqMicroserviceTransport(producerOptions),
      }),
    ],
    providers: [FulfillmentRelay],
    exports: [FulfillmentRelay],
  })
  class FulfillmentPublisherModule {}

  return FulfillmentPublisherModule;
}
```

The beginning of the fulfillment `src/main.ts` is the following **application fragment**. `db` is the connected fulfillment client, and `workerOptions` is the `role: 'worker'` options built from two connected channels. These are resource inputs owned by the existing bootstrap, not omitted variables hiding business processing.

```ts
import { FluoFactory } from '@fluojs/runtime';
import { createFulfillmentModule } from './app.js';

const application = await FluoFactory.createMicroservice(
  createFulfillmentModule(db, workerOptions),
);
await application.listen();
```

On shutdown, stop accepting new work, await `application.close()`, then close the caller-owned consumer channel, publisher channel, connection, and Prisma client. The Fluo facade disposes of transport subscriptions after already-accepted inbound handlers settle, but does not close the supplied RabbitMQ resources for you. Retain the existing lifecycle boundary that attempts disposal of every resource even on bootstrap or close failure and reports both the original and disposal errors. If a DB call stalls forever, drain cannot finish either, so include DB timeouts and the host's shutdown grace period in operational settings.

## Inject Failures and Inspect Stored Results

Verify DB rows and ACK ordering, not logs saying an event "arrived." Using two isolated PostgreSQL DBs and RabbitMQ, prepare an order through the earlier purchase and payment boundaries with `paid/version=1`, consumed reservations, and a shipping-address snapshot. Even after `payment.confirmed` reaches the Saga, no fulfillment intent should exist before packing approval. Send `AdmitFulfillment` with a nonexistent intent ID, or run a negative fixture that injects a fulfillment intent without stored approval: acceptance, the v2 audit, and the acceptance fact must all be absent.

After passing through trusted `RecordPackingResult` and `runFulfillmentHandoff`, there should be one each of `fulfilling/version=2`, the v2 audit, the fulfillment Outbox, local acceptance, and its SagaInbox. The Saga becomes `fulfilled` even without starting an external consumer, but the fulfillment DB contains 0 Inbox rows and jobs. Remote storage can still remain at 0 even after the broker relay runs and receives a confirm. If you inject an Outbox or acceptance insert failure, the v2 transition and audit must roll back together, leaving `paid/version=1` and inventory unchanged.

Stop the order process immediately after the acceptance command completes, before calling the fact relay. After restart, read unmarked intents and acceptance from the same DB and run the batch: it must finish the Saga with the original intent and acceptance IDs. In a separate experiment, interrupt after the SagaInbox commit but before marking `deliveredAt`. After republication, the Saga revision, acceptance audit, and fulfillment intents must not increase. Remove the local Saga provider and run only the relay: it must return `SAGA_NOT_CONSUMED` without leaving a delivery marker.

For the refund race, force each ordering with two order fixtures. After a signal that the order lock has been acquired, start `RefundService.request` or `AdmitFulfillment` on another connection, then commit the lock holder. If the refund wins, only `refund_pending`, one refund request, and the `superseded` fact remain; fulfillment Outbox and acceptance counts are 0. If fulfillment wins, the order is `fulfilling/version=2`, the refund returns 409, and refund request and external refund call counts are 0. Do not use the mere presence of a fulfillment command in a Queue as the criterion for blocking refunds.

Deliver the same event twice, and concurrently on separate consumer connections. The final Inbox and `ShipmentJob` counts must each be one. A request changing only the quantity under the same `eventId` must be isolated as a conflict without modifying the original job. A request assigning a new `eventId` to the same order must not create a second shipment either. These checks require two DB connections; passing with an in-memory `Set` substitute is not a replacement.

If the consumer connection is broken immediately after the DB transaction commits but before ACK, the broker may redeliver the unacknowledged delivery. Accepting the same request in a new process must not increase the job count. Conversely, injecting a failure at job creation must leave no Inbox row either. A delivery that fails before ACK appears in the failed queue; after removing the cause and putting the same payload back, it must be accepted normally. Use handler completion signals, transaction commit signals, and consumer ACK callbacks as failure-injection points. A test that kills a process after sleeping a few seconds has an ambiguous boundary.

When rolling back a deployment after an interruption, also prevent the old monolith and new worker from executing shipment jobs simultaneously. Deploy the new consumer first but keep publication switching disabled; check the contract, permissions, and DB readiness before switching the target path on the order side. Record ownership of existing unfinished shipment jobs to decide which executor will finish each one. Switching back must follow that record too. Sending the same order to two systems for real shipment and comparing the results is not a comparison experiment.

## Extract Only as Much as Needed

Fulfillment extraction buys independent deployment and resource isolation. Its costs are contract versions, Outbox lag, Inbox retention, broker operations, and reconciliation during failures. If shipment volume is small and the monolith's job executor is enough, it is better not to pay those costs. The modular design before this chapter is a valid operational choice, not an unfinished stage.

The order service now creates fulfillment requests durably, and the fulfillment service makes duplicate requests converge on the same job. We have also established the boundary that keeps `emit()` completion from being mistaken for `shipped`. In the next chapter, we compare transports while retaining this contract. Rather than introducing every broker, we use small experiments to decide what completion, recovery, and ownership we need.

## Evidence and Verification Scope

This chapter defines application-owned Outbox and Inbox implementations, Prisma models, and connection composition. It does not claim that the repository contains a complete deployment of two services. Actual broker queue creation, DB migrations, and carrier requests have not been executed; the expected results of the failure injections above must be checked in an independent integration environment.

- [microservices README: Completion Boundaries and Caller-Owned Resources](../../packages/microservices/README.md)
- [Public Transport and Facade Contracts](../../packages/microservices/src/types.ts)
- [RabbitMQ Transport: Consumer Completion, Responses, and Shutdown](../../packages/microservices/src/transports/rabbitmq-transport.ts)
- [RabbitMQ Adapter Tests](../../packages/microservices/src/transports/rabbitmq-transport.test.ts)
- [MICROSERVICE Registration and Alias Composition](../../packages/microservices/src/module.ts)
- [Handler Discovery, Cloning, and Inbound Drain](../../packages/microservices/src/service.ts)
- [Handler Discovery Regression Tests by Provider Token](../../packages/microservices/src/handler-discovery-provider-token.test.ts)
- [Prisma README: Nested Transaction Context on the Same Facade](../../packages/prisma/README.md)

[Previous Chapter](./ch22-international-commerce.md) - [Volume 2 Contents](./toc.md) - [Next Chapter](./ch24-transport-lab.md)
