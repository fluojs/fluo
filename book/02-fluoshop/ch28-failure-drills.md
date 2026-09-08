# Completing FluoShop with Failure Drills

<!-- book:volume=02-fluoshop;chapter=28 -->

[Previous: Observing a Sale Event and Finding Bottlenecks](./ch27-sale-observability.md) | [Table of Contents](./toc.md) | [Next Volume: Following One Order Request Through the Source](../03-internals/ch01-trace-an-order.md)

## The last feature is the ability to explain a failed order

Before the second sale, the operator asks, "If the fulfillment worker stops during deployment, what happens to orders that have already been paid?" If the only prepared answer is "the queue retries automatically," the shop is not finished yet. The queue knows nothing about the database commit, and the database knows nothing about the broker's ACK. A payment provider that lost a webhook response and a fulfillment job whose process died are different failures with different grounds for recovery.

This chapter completes the same application that began as FluoBlog. Accounts and posts remain, and only fulfillment has been split out of the modular shop into a separate process. Rather than adding more microservices, we test the boundaries we have. We distinguish two layers: controlling failure order with test doubles, and verifying durability and lifecycle behavior in separate real database, Redis, and RabbitMQ experiments.

The authoritative ledgers are already established. `BlogDatabaseModule` owns the single async global Prisma registration. SKU prices live in `ProductVariant`, saleable stock in `Stock.available`, and reservations in `Reservation` with the compound key `(orderId, sku)`. Payment confirmation changes a reservation to `consumed` but does not deduct stock again. Orders start at version 0, and `OrderTransitionsService.apply` saves the state, version, and `OrderTransition` audit together. Do not create a drill-specific payment path that bypasses `OrderInventoryService.confirmPayment` or `PaymentLedger.prepare/record`.

The execution baseline is Node24 and pnpm10. The files below are experimental code for the reader's `fluo-blog`; they do not mean that this repository already contains a complete application for every chapter. Make no real charges, shipping orders, or email deliveries. Replace external effects with recording adapters, then check the final state of the lab stores and the observed signals.

## Write down invariants before injecting random failures

Define success before choosing a failure injection tool. Retrying the same purchase request must point to the existing order. Two orders competing for the last item must not make saleable stock negative. Receiving the same message again after payment confirmation must not consume the reservation twice. No order may change state without an audit record.

Choose only one failure point in each experiment. Do not merge a failure before database commit and a lost response after commit into the same "payment failure." A pre-commit failure must leave no state, whereas a lost post-commit response requires finding state that already exists. This distinction explains why the same action, a retry, is safe in some cases but can cause a duplicate charge in others.

Record the initial state, the input's idempotency key, the exact boundary at which failure was injected, the observed completion signal, and the final ledger state. You need evidence on both sides of the database and delivery boundary, not just a log line. "A 500 occurred" does not prove rollback, and "message sent successfully" does not prove a fulfillment receiver committed.

These experiments test the boundaries in sequence from local admission in Chapter 17 through remote delivery in Chapter 23. `fulfilling/version=2` and the Saga's `fulfilled` mean **local durable intent admission** after validating packing approval, not acceptance by a remote consumer or completed shipment. First test missing approval and lost notification after admission against the real order database. Then test Queue worker failure separately from RabbitMQ publish and consumer completion.

## Stop immediately after local admission and restart with the same database

First apply the models from Chapters 17 and 23 to an isolated order database and register the real `PrismaSagaStore`, command handlers, and two local relays. The purchase and payment fixture must pass through the existing checkout and `PaymentLedger.prepare/record` to produce `paid/version=1`, `consumed` reservations, and a frozen shipping address. The Saga must have consumed the payment fact and reached `awaiting_packing`. Do not start automatic batches or the remote fulfillment consumer during this test. Do not share SKUs with other orders, so that unrelated sales do not affect inventory comparisons.

The following `src/fulfillment/drills/local-admission.drill.ts` is a **two-stage executable file for a database integration test**. The values in `LiveAdmission` are providers resolved from the bootstrapped real app, not mock stores. The first stage's return value is only a test observation, not input to the recovery engine. Shut down the app, create a new container against the same database, and call the second stage. `notifyBeforeStop=false` creates a stop after admission commit but before Saga notification; `true` creates one after Saga commit but before marking delivery. Run each with a fresh order fixture.

```ts
import assert from 'node:assert/strict';
import type { CommandBusLifecycleService, CqrsEventBusService } from '@fluojs/cqrs';
import type { PrismaServiceFacade } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import { AdmitFulfillment } from '../../orders/request-fulfillment.js';
import { OrderFact } from '../../orders/saga/order-saga.js';
import { RecordPackingResult } from '../../orders/saga/record-packing-result.js';
import { runFulfillmentHandoff } from '../../orders/saga/run-fulfillment-handoff.js';
import type { LocalOrderFactRelay } from '../../orders/saga/local-order-fact-relay.js';
import type { FulfillmentIntentRelay } from '../../orders/saga/fulfillment-intent-relay.js';
import type { OrderActor } from '../../orders/order-state.js';
import { parseFulfillmentRequest } from '../fulfillment-request.js';

export interface LiveAdmission {
  db: PrismaServiceFacade<PrismaClient>;
  commands: CommandBusLifecycleService;
  events: CqrsEventBusService;
  facts: LocalOrderFactRelay;
  intents: FulfillmentIntentRelay;
}

export async function beforeAdmissionStop(
  live: LiveAdmission,
  orderId: string,
  actor: OrderActor,
  notifyBeforeStop: boolean,
) {
  const { db, commands, events, facts } = live;
  const original = await db.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      items: { orderBy: { sku: 'asc' } },
      reservations: { orderBy: { sku: 'asc' } }, shippingSnapshot: true,
    },
  });
  assert.equal(original.status, 'paid');
  assert.equal(original.version, 1);
  assert.ok(original.shippingSnapshot);
  assert.equal((await db.orderSaga.findUniqueOrThrow({ where: { orderId } })).phase,
    'awaiting_packing');
  const stock = await db.stock.findMany({
    where: { sku: { in: original.items.map(item => item.sku) } },
    orderBy: { sku: 'asc' },
  });
  const intentId = `${orderId}:fulfillment.request:v1`;
  const acceptanceId = `${orderId}:fulfillment.accepted:v1`;
  await assert.rejects(commands.execute(new AdmitFulfillment(intentId)));
  const rollbackProbe = new Error('ROLLBACK_INVALID_FIXTURE');
  try {
    await db.transaction(async () => {
      await db.sagaIntent.create({
        data: { id: intentId, orderId, kind: 'fulfillment_request' },
      });
      await db.orderSaga.update({
        where: { orderId }, data: { phase: 'awaiting_fulfillment' },
      });
      await assert.rejects(commands.execute(new AdmitFulfillment(intentId)),
        /PACKING_APPROVAL_REQUIRED/);
      throw rollbackProbe;
    });
  } catch (error) {
    if (error !== rollbackProbe) throw error;
  }
  await assert.rejects(events.publish(new OrderFact(
    `${orderId}:packing.confirmed:v1`, orderId, 'packing.confirmed',
  )), /UNTRUSTED_LOCAL_FACT/);
  await assert.rejects(commands.execute(new RecordPackingResult(
    orderId, 'confirmed', { subject: original.customerId, scopes: [] },
  )), /PACKING_ACCESS_DENIED/);
  assert.equal(await db.packingResult.count({ where: { orderId } }), 0);
  assert.equal(await db.fulfillmentOutbox.count({ where: { orderId } }), 0);
  assert.equal(await db.localOrderFact.count({ where: { id: acceptanceId } }), 0);
  assert.equal(await db.orderTransition.count({ where: { orderId, version: 2 } }), 0);
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: orderId } })).status, 'paid');
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: orderId } })).version, 1);

  await commands.execute(new RecordPackingResult(orderId, 'confirmed', actor));
  await commands.execute(new RecordPackingResult(orderId, 'confirmed', actor));
  await facts.runBatch();
  await commands.execute(new AdmitFulfillment(intentId));
  const admitted = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  assert.equal(admitted.status, 'fulfilling');
  assert.equal(admitted.version, 2);
  assert.equal((await db.sagaIntent.findUniqueOrThrow({
    where: { id: intentId },
  })).dispatchedAt, null);
  assert.equal((await db.localOrderFact.findUniqueOrThrow({
    where: { id: acceptanceId },
  })).deliveredAt, null);
  if (notifyBeforeStop) {
    await events.publish(new OrderFact(acceptanceId, orderId, 'fulfillment.accepted'));
  }
  assert.equal((await db.orderSaga.findUniqueOrThrow({ where: { orderId } })).phase,
    notifyBeforeStop ? 'fulfilled' : 'awaiting_fulfillment');
  return { original, stock, intentId, acceptanceId };
}

export async function afterAdmissionRestart(
  live: LiveAdmission,
  before: Awaited<ReturnType<typeof beforeAdmissionStop>>,
): Promise<void> {
  const { db, commands, events, facts, intents } = live;
  const { original, stock, intentId, acceptanceId } = before;
  const orderId = original.id;
  await runFulfillmentHandoff(facts, intents);
  const saga = await db.orderSaga.findUniqueOrThrow({ where: { orderId } });
  assert.equal(saga.phase, 'fulfilled');
  await Promise.all([
    commands.execute(new AdmitFulfillment(intentId)),
    commands.execute(new AdmitFulfillment(intentId)),
  ]);
  const accepted = new OrderFact(acceptanceId, orderId, 'fulfillment.accepted');
  await events.publish(accepted);
  await events.publish(accepted);
  assert.equal((await db.orderSaga.findUniqueOrThrow({ where: { orderId } })).revision,
    saga.revision);
  assert.equal(await db.sagaIntent.count({
    where: { orderId, kind: 'fulfillment_request' },
  }), 1);
  assert.equal(await db.sagaInbox.count({ where: { orderId, eventId: acceptanceId } }), 1);
  assert.equal(await db.localOrderFact.count({ where: { id: acceptanceId } }), 1);
  assert.notEqual((await db.localOrderFact.findUniqueOrThrow({
    where: { id: acceptanceId },
  })).deliveredAt, null);
  const transition = await db.orderTransition.findUniqueOrThrow({
    where: { orderId_version: { orderId, version: 2 } },
  });
  assert.equal(transition.from, 'paid');
  assert.equal(transition.to, 'fulfilling');
  assert.equal(transition.eventName, 'fulfillment_started');
  const outbox = await db.fulfillmentOutbox.findUniqueOrThrow({ where: { id: intentId } });
  assert.equal(await db.fulfillmentOutbox.count({ where: { orderId } }), 1);
  assert.equal(outbox.publishedAt, null);
  const request = parseFulfillmentRequest(JSON.parse(outbox.payloadJson));
  assert.equal(request.orderVersion, 2);
  assert.equal(request.packingApprovalId, `${orderId}:packing.confirmed:v1`);
  assert.deepEqual(request.items, original.items.map(({ sku, quantity }) => ({ sku, quantity })));
  const snapshot = original.shippingSnapshot;
  assert.ok(snapshot);
  assert.equal(request.locale, snapshot.locale);
  assert.deepEqual(request.shipTo, {
    countryCode: snapshot.countryCode, city: snapshot.city,
    line1: snapshot.line1, postalCode: snapshot.postalCode,
  });
  const current = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  assert.equal(current.status, 'fulfilling');
  assert.equal(current.version, 2);
  assert.deepEqual(await db.reservation.findMany({
    where: { orderId }, orderBy: { sku: 'asc' },
  }), original.reservations);
  assert.deepEqual(await db.stock.findMany({
    where: { sku: { in: original.items.map(item => item.sku) } },
    orderBy: { sku: 'asc' },
  }), stock);
}
```

The test caller receives the result of `await beforeAdmissionStop(live, orderId, warehouseActor, false)` from the first app, closes the app, and calls `await afterAdmissionRestart(live, before)` with `live` resolved from the new app. For the next fixture, change the final argument to `true`. Do not reset the database between apps or reuse the previous `MemorySagaStore` object. To test forced termination itself, the parent test harness must **subscribe before startup** to an IPC signal indicating completion of the first stage, then terminate the child process immediately after the signal. Do not sleep for a few seconds and assume a commit has happened.

Because this test starts neither the remote consumer nor the broker relay, the local Saga must finish even with `publishedAt=null`. In the real RabbitMQ experiment, continue by running only `FulfillmentRelay.runBatch()` to receive a confirm, then verify that `FulfillmentInbox` and `ShipmentJob` both remain at 0 in the fulfillment database, where there is still no consumer. Start the worker afterward and observe ACK occurring after both rows commit together, at the same boundary used in the delivery experiment below.

## Share one fulfillment request across two delivery paths

The complete file `src/fulfillment/drills/shipment-contract.ts` below **reuses the actual wire DTO and parser from Chapter 23**. Do not create a separate drill contract that leaves out the address, items, or packing approval ID. `ShipmentJob` is an experimental class that carries this request through Queue, distinct from the Prisma model of the same name in the fulfillment database.

```ts
import type { FulfillmentRequest } from '../fulfillment-request.js';
export {
  FULFILLMENT_REQUESTED as SHIPMENT_PATTERN,
  parseFulfillmentRequest as parseShipmentRequest,
} from '../fulfillment-request.js';

export const SHIPMENT_INBOX = Symbol('shop.drill.shipment-inbox');
export type ShipmentRequest = FulfillmentRequest;
export interface ShipmentInbox {
  accept(request: ShipmentRequest): Promise<'applied' | 'duplicate'>;
}

export class ShipmentJob {
  constructor(public readonly request: ShipmentRequest) {}
}
```

The pattern's `v1` is the wire schema version, while `orderVersion=2` is the version after the local admission transition from `paid/version=1`. A correctly spelled approval ID does not create real approval. Producer-side store validation and permission to publish to the queue retain the contracts from Chapter 23. Receiver-side DTO validation does not replace them.

The complete file `src/fulfillment/drills/shipment-handlers.ts` invokes the same receiver operation from Queue and RabbitMQ. Register the exact `ShipmentJob` constructor on the Queue class. Propagate exceptions to the caller instead of turning them into success. This setup lets us test the same failure contract on each path; it is not a recommendation to run both delivery paths in production at once.

```ts
import { Inject } from '@fluojs/core';
import { EventPattern, MICROSERVICE, type Microservice } from '@fluojs/microservices';
import { QueueLifecycleService, QueueWorker } from '@fluojs/queue';
import {
  parseShipmentRequest,
  SHIPMENT_INBOX,
  SHIPMENT_PATTERN,
  ShipmentJob,
  type ShipmentInbox,
  type ShipmentRequest,
} from './shipment-contract.js';

@Inject(SHIPMENT_INBOX)
@QueueWorker(ShipmentJob, {
  jobName: 'shop-drill-shipments-v1',
  attempts: 3,
  backoff: { type: 'exponential', delayMs: 100 },
  concurrency: 1,
})
export class ShipmentWorker {
  constructor(private readonly inbox: ShipmentInbox) {}

  async handle(job: ShipmentJob) {
    return this.inbox.accept(parseShipmentRequest(job.request));
  }
}

@Inject(SHIPMENT_INBOX)
export class ShipmentEventHandler {
  constructor(private readonly inbox: ShipmentInbox) {}

  @EventPattern(SHIPMENT_PATTERN)
  async handle(payload: unknown) {
    return this.inbox.accept(parseShipmentRequest(payload));
  }
}

@Inject(QueueLifecycleService)
export class ShipmentQueuePublisher {
  constructor(private readonly queue: QueueLifecycleService) {}

  async publish(request: ShipmentRequest) {
    const value = parseShipmentRequest(request);
    return this.queue.enqueue(
      new ShipmentJob(value),
      { deduplicationKey: value.eventId },
    );
  }
}

@Inject(MICROSERVICE)
export class ShipmentEventPublisher {
  constructor(private readonly microservice: Microservice) {}

  async publish(request: ShipmentRequest) {
    await this.microservice.emit(SHIPMENT_PATTERN, parseShipmentRequest(request));
  }
}
```

Queue uses `enqueue(jobInstance, options?)`, not `enqueue(name, payload)`. An object literal with the same fields or a class redeclared in another file differs from the registered constructor and is rejected. Serialization requires a JSON object, and the worker restores the registered prototype. Opening network connections or computing secret fields in a constructor is not suitable for the message reconstruction contract.

`deduplicationKey` makes the backing job ID stable for repeated enqueue calls. It does not replace permanent business idempotency across job retention policies and data lifetimes. To guard against RabbitMQ redelivery, operator reruns, and duplicate input from another producer too, the receiver ledger must store the event ID together with its effect. Understand Queue deduplication and Inbox as duplicate prevention at different points.

## A receiver and broker with controllable failure points

The complete file `src/fulfillment/drills/doubles.ts` below is a **test-only implementation**. `DrillInbox` provides a signal immediately before commit and does not expose staged values in public state on failure. `ControlledBroker` separates publishing from actual delivery. A fake that immediately invokes a handler on publish can make the test reinforce the false assumption that `emit()` waits for remote completion.

```ts
import type { RabbitMqMicroserviceTransportOptions } from '@fluojs/microservices';
import type { ShipmentInbox, ShipmentRequest } from './shipment-contract.js';

export class DrillInbox implements ShipmentInbox {
  readonly events = new Map<string, ShipmentRequest>();
  readonly effects = new Map<string, ShipmentRequest>();
  beforeCommit: () => Promise<void> = async () => {};

  async accept(request: ShipmentRequest): Promise<'applied' | 'duplicate'> {
    const existing = this.events.get(request.eventId);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(request)) {
        throw new Error('Event identity was reused with a different payload.');
      }
      return 'duplicate';
    }
    const previous = this.effects.get(request.orderId);
    if (previous && previous.eventId !== request.eventId) {
      throw new Error('A different shipment request already exists for this order.');
    }
    const staged = structuredClone(request);
    await this.beforeCommit();
    this.effects.set(staged.orderId, staged);
    this.events.set(staged.eventId, staged);
    return 'applied';
  }
}

type DeliveryHandler = (message: string) => Promise<void> | void;

export class ControlledBroker {
  readonly published: Array<{ queue: string; message: string }> = [];
  readonly accepted: number[] = [];
  readonly rejected: number[] = [];
  readonly cancelled: string[] = [];
  private readonly handlers = new Map<string, DeliveryHandler>();

  readonly publisher: RabbitMqMicroserviceTransportOptions['publisher'] = {
    publish: async (queue, message) => {
      this.published.push({ queue, message });
    },
  };

  readonly consumer: RabbitMqMicroserviceTransportOptions['consumer'] = {
    consume: async (queue, handler) => {
      this.handlers.set(queue, handler);
    },
    cancel: async (queue) => {
      this.handlers.delete(queue);
      this.cancelled.push(queue);
    },
  };

  async deliver(index: number): Promise<void> {
    const record = this.published[index];
    if (!record) throw new Error('No published delivery at this index.');
    const handler = this.handlers.get(record.queue);
    if (!handler) throw new Error('No consumer for this queue.');
    try {
      await handler(record.message);
      this.accepted.push(index);
    } catch (error) {
      this.rejected.push(index);
      throw error;
    }
  }
}
```

The two Maps in this fake are not a durable implementation replacing PostgreSQL. They express only the boundary at which the effect and Inbox become visible together in this sequential failure and redelivery experiment. They do not prove concurrent consumption across processes, database isolation levels, or restart recovery. A real receiver must record the unique event key and fulfillment request in the same atomic database transaction. Do not register these in-memory Maps as production providers.

`accepted` and `rejected` are also completion outcomes observed by the collaborator, not real AMQP ACK/NACK commands. Fluo's RabbitMQ adapter provides the consumer callback completion boundary, but durable queues, publisher confirms, ACK policy, retry queues, and DLX are the responsibility of the application-supplied broker collaborator. Verify separately whether this experiment tests that boundary correctly and how the actual RabbitMQ configuration handles its results.

## A delivery experiment through the module graph

The complete file `src/fulfillment/drills/delivery.slice.test.ts` below compiles the real module graph with `@fluojs/testing`. Unlike a test that calls a transport class directly, it connects `@EventPattern` discovery, class-level DI, the `MICROSERVICE` facade, and consumer completion together. Because `overrideProvider` is applied before compilation, the handler receives the same replacement inbox.

```ts
import { Module } from '@fluojs/core';
import {
  MICROSERVICE,
  MicroservicesModule,
  RabbitMqMicroserviceTransport,
  type Microservice,
} from '@fluojs/microservices';
import { createTestingModule } from '@fluojs/testing';
import { expect, it } from 'vitest';
import { ControlledBroker, DrillInbox } from './doubles.js';
import { SHIPMENT_INBOX, SHIPMENT_PATTERN } from './shipment-contract.js';
import { ShipmentEventHandler } from './shipment-handlers.js';

it('separates publish, failed delivery, and duplicate-safe application', async () => {
  const broker = new ControlledBroker();
  const inbox = new DrillInbox();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  inbox.beforeCommit = async () => {
    entered.resolve();
    await release.promise;
    throw new Error('Injected write failure.');
  };

  @Module({
    imports: [MicroservicesModule.forRoot({
      transport: new RabbitMqMicroserviceTransport({
        publisher: broker.publisher,
        consumer: broker.consumer,
        eventQueue: 'shop.drill.events',
        messageQueue: 'shop.drill.requests',
        responseQueue: 'shop.drill.responses',
      }),
    })],
    providers: [
      { provide: SHIPMENT_INBOX, useValue: new DrillInbox() },
      ShipmentEventHandler,
    ],
  })
  class DeliveryDrillModule {}

  const module = await createTestingModule({ rootModule: DeliveryDrillModule })
    .overrideProvider(SHIPMENT_INBOX, inbox)
    .compile();
  let delivery: Promise<void> | undefined;
  try {
    const microservice = await module.resolve<Microservice>(MICROSERVICE);
    await microservice.listen();
    const request = {
      eventId: 'order-1:fulfillment.request:v1',
      orderId: 'order-1',
      orderVersion: 2,
      packingApprovalId: 'order-1:packing.confirmed:v1',
      locale: 'ko',
      items: [{ sku: 'FLUO-TEE-BLK-M', quantity: 1 }],
      shipTo: {
        countryCode: 'KR', city: 'Seoul', line1: '1 Example Road', postalCode: '04524',
      },
    };
    await microservice.emit(SHIPMENT_PATTERN, request);
    expect(broker.published).toHaveLength(1);
    expect(inbox.effects.size).toBe(0);

    delivery = broker.deliver(0);
    const rejected = expect(delivery).rejects.toThrow('Injected write failure.');
    await entered.promise;
    expect(broker.accepted).toHaveLength(0);
    expect(inbox.effects.size).toBe(0);
    release.resolve();
    await rejected;
    expect(broker.rejected).toEqual([0]);
    expect(inbox.events.size).toBe(0);

    inbox.beforeCommit = async () => {};
    await broker.deliver(0);
    await broker.deliver(0);
    expect(broker.accepted).toEqual([0, 0]);
    expect(inbox.effects.size).toBe(1);
    expect(inbox.events.size).toBe(1);
    await microservice.emit(SHIPMENT_PATTERN, {
      ...request, items: [{ sku: 'FLUO-TEE-BLK-M', quantity: 2 }],
    });
    await expect(broker.deliver(1)).rejects.toThrow(
      'Event identity was reused with a different payload.',
    );
    expect(inbox.effects.get('order-1')?.items[0]?.quantity).toBe(1);
    await microservice.close();
    await expect(microservice.emit(SHIPMENT_PATTERN, {})).rejects.toThrow();
    expect(broker.published).toHaveLength(2);
    expect(broker.cancelled).toHaveLength(3);
  } finally {
    release.resolve();
    await delivery?.catch(() => {});
    await module.container.dispose();
  }
}, 2_000);
```

Create the signal objects before starting delivery. Check intermediate state only after confirming callback entry, then release it explicitly, so the experiment does not depend on how fast or slow the computer is. The final two seconds are not a fixed delay waiting for success; they are a bound that fails the test if the whole test gets stuck. There is no reason to insert `sleep(100)` into an experiment that is not testing real queue backoff timing.

When the first `emit()` finishes, the effect count is 0. That is the producer completion boundary. If the first delivery fails, the callback rejects and neither an Inbox record nor an effect exists. The second delivery applies the event, and the third completes as a duplicate of the same event. A real collaborator can treat a successful duplicate here as an ACK-eligible outcome too. Automatically retrying every duplicate as an error can keep an already-processed event circulating forever.

Finally, verify that a new emit after closing the facade never reaches the publisher. The cancel count represents subscription disposal for the three queues configured in this experiment: event, request, and response. It is not evidence that Fluo closed a caller-owned connection or channel. In actual shutdown, first finish disposal of handlers accepted by the facade and detach subscriptions, then let the application close the broker resources it created.

This test also makes failures easier to narrow down. If an effect appears immediately after emit, first check whether the broker double merged publish and delivery. If the first failure appears in accepted, consumer completion was not awaited. If effects grow after the third delivery, receiver idempotency is broken. If published grows after shutdown, the terminal ingress gate failed to block new work.

## Verify Queue retries in a separate Redis experiment

The preceding test did not start Queue. Reading the `ShipmentWorker` decorator or calling `handle()` directly three times does not verify BullMQ retries. Verify real retries, serialization, processor startup after bootstrap, and dead-letter records in a separate experiment with Redis-backed Queue configured.

The complete file `src/fulfillment/drills/queue-drill.module.ts` below is an independent root for that experiment. It does not add duplicate default Redis or Queue registrations to the existing shop app. `redisPort` is the port of an isolated local Redis prepared in advance, and the drill inbox can be the preceding `DrillInbox`. Do not use this module for production fulfillment.

```ts
import { Module } from '@fluojs/core';
import { QueueModule } from '@fluojs/queue';
import { RedisModule } from '@fluojs/redis';
import { SHIPMENT_INBOX, type ShipmentInbox } from './shipment-contract.js';
import { ShipmentQueuePublisher, ShipmentWorker } from './shipment-handlers.js';

export function createQueueDrillModule(redisPort: number, inbox: ShipmentInbox) {
  @Module({
    imports: [
      RedisModule.forRoot({ host: '127.0.0.1', port: redisPort }),
      QueueModule.forRoot({
        ownershipNamespace: 'shop-drill-local-redis-db0',
        ownershipEnforcement: 'reject',
        workerShutdownTimeoutMs: 2_000,
        defaultDeadLetterMaxEntries: 100,
      }),
    ],
    providers: [
      { provide: SHIPMENT_INBOX, useValue: inbox },
      ShipmentWorker,
      ShipmentQueuePublisher,
    ],
    exports: [ShipmentQueuePublisher],
  })
  class QueueDrillModule {}
  return QueueDrillModule;
}
```

`ownershipNamespace` does not change the prefix of Redis keys. It identifies registrations for ownership collision checks when they use the same backend and BullMQ prefix. Actual isolation comes from a separate Redis environment and a unique `jobName`. Do not assume that changing only a name while using the same namespace automatically separates the data. A job class and its actual jobName must have only one owning worker, explicitly registered as a singleton provider in the module.

For the first Queue experiment, make `beforeCommit` throw only on the first two attempts and complete on the third. Prepare an array recording attempt entry and a promise signaling the third completion **before enqueueing**. Call `ShipmentQueuePublisher.publish()` from an app that has completed bootstrap and await that signal. The expected result is three attempts, one effect, and one Inbox record. The job ID returned by the producer identifies the stored job; it is not a fulfillment completion response.

In the second experiment, fail all three attempts. The package's public read path is shown below. `queue` is a `QueueLifecycleService` or `Queue` facade injected from the initialized app. This code is a **partial operational investigation implementation**; it does not start or rerun a worker.

```ts
import type { Queue } from '@fluojs/queue';

export async function inspectShipmentFailures(queue: Queue) {
  const result = await queue.inspectDeadLetters('shop-drill-shipments-v1', { limit: 25 });
  return {
    malformedRecordCount: result.malformedRecordCount,
    failures: result.records.map((record) => ({
      jobId: record.jobId,
      attemptsMade: record.attemptsMade,
      failedAt: record.failedAt,
      errorMessage: record.errorMessage,
    })),
  };
}
```

Worker failure and dead-letter storage may not happen at the same moment. Package regression tests that can observe the actual storage-completion signal perform inspection after that completion. In operational experiments, use a broker event or a separate observer's record-completion signal instead of sleeping briefly and asserting that the list exists. Public inspection is a query API, not an API that "waits until this job's dead-letter record has been stored."

Dead-letter handling does not move a BullMQ job to another queue. It appends a separate Redis record for a job that has exhausted its retries. Default retention is the latest 1,000 entries per job; this experiment reduces it to 100. Inspection returns valid records newest first and reports the count of malformed entries separately. Do not treat it as an eternal audit ledger that preserves records beyond the retention limit or records whose writes could not finish during shutdown.

Do not implement recovery as a button that reenqueues the entire list unchanged. First check the current order and fulfillment ledgers, then validate the event ID and message schema. Close an already-successful effect as a duplicate, and resubmit only reprocessable transient failures with the same business identity. Queue deduplication can leave an existing failed job ID in place, so design job retention and rerun policies alongside the business Inbox. A raw dead-letter payload is `unknown`, not a trusted constructor instance.

## A drill matrix connecting the full purchase flow

After testing the delivery boundary, connect the following cases in the existing product implementation. This table does not ask for different storage models; it states the final conditions to observe in the ledgers from earlier chapters. Start each experiment with a fresh fixture, without reusing another experiment's pending work or idempotency keys.

| Failure point | Event to inject | Final result that must be observed |
| --- | --- | --- |
| Price revalidation | Change the `ProductVariant` price or sale status after adding it to the cart | Revalidate against the server's source; historical order snapshots remain immutable |
| Stock reservation | Two orders request the last unit concurrently | `Stock.available` is not negative, with only one successful reservation |
| Payment confirmation | Record the same successful result twice | The reservation becomes `consumed` only once, with no additional stock deduction |
| State transition | Fail at `OrderTransition` insertion | Order state and version roll back too; neither audit-only nor state-only data remains |
| Lost charge response | Fail the response boundary after charging with the stored attempt ID | Query and reconcile using evidence for the same attempt, without creating a new unrelated attempt |
| Missing packing approval | Run `AdmitFulfillment` on a paid order with a nonexistent intent ID or a `fulfillment_request` row without approval | `paid/version=1`; v2 audit, fulfillment Outbox, and acceptance counts are 0; the latter case yields `PACKING_APPROVAL_REQUIRED` |
| Conflicting packing results | Record rejected after confirmed for the same request | `PACKING_RESULT_CONFLICT`; the original approval and local fact remain |
| Local admission rollback | Inject a database failure when inserting `FulfillmentOutbox` or acceptance | `paid/version=1`; v2 audit, Outbox, and acceptance counts are all 0; stock is unchanged |
| Duplicate local admission | Execute the same stored intent ID on two connections | `fulfilling/version=2`; one admission audit, one Outbox record, and one acceptance |
| Stop after local commit | Recover in a new app after `beforeAdmissionStop(..., false)` | Consume the original acceptance ID; Saga is `fulfilled`; there is one fulfillment intent |
| Stop after Saga notification | Recover in a new app after `beforeAdmissionStop(..., true)` | One acceptance Inbox record, with no additional increase in Saga revision |
| No local consumer | Run `LocalOrderFactRelay.runBatch()` without the `OrderSaga` provider | `SAGA_NOT_CONSUMED`, `deliveredAt=null`; consume the same fact after restoring registration |
| No remote consumer | Run only through packing approval, local batches, and broker confirm | Order is `fulfilling/version=2`, Saga is `fulfilled`, remote Inbox and job counts are 0; not `shipped` |
| Refund admitted first | Commit `RefundService.request` under the order lock first, then execute the fulfillment command | `refund_pending`, one refund request, fulfillment Outbox and acceptance counts are 0, Saga is `superseded` |
| Fulfillment admitted first | Execute `RefundService.request` after local admission commit | `fulfilling/version=2`, refund returns 409, refund request and external refund call counts are 0 |
| Event publishing | Publish fails after the order commits | Outbox remains pending; the receiver effect occurs once after republishing |
| Fulfillment application | Lose the connection after the receiver database commits but before ACK | Redelivery is possible, but Inbox and fulfillment effects are not duplicated |
| Shutdown | Send a new request after shutdown begins while a handler is running | New work is rejected; accepted work is disposed or redelivered according to its contract |

The quantity to check in the inventory experiment is `Stock.available`. It was already reduced on reservation, so reducing it again at payment confirmation consumes the same T-shirt twice. A cancellation returns stock once only for a reservation transitioned to `released` before payment; a post-payment refund follows a separate durable compensation record. Adding a different `onHand - reserved` calculation to drill code would make the product and tests validate different ledgers.

In the state transition experiment, examine the order version and audit row together. A new order is version 0, incremented according to the rules for each successful transition. An Outbox row does not prove that the audit for every state transition has been preserved. Event distribution records and `OrderTransition` serve different purposes. Do not check one as a substitute for the other.

Test the HTTP boundary with the real application's `createTestApp({ rootModule })`. Supply an explicit test principal for authenticated requests, then reread the created order at `/orders/:id` to verify that the same user sees the same state. `principal()` injects a synthetic principal; it does not test JWT signature verification. To test the JWT boundary, send a token issued and verified through the real verification path, and keep the evidence for these two tests separate.

Even when `createTestingModule(...).overrideProvider(...)` replaces the payment adapter with a recording implementation, do not replace `PaymentLedger` or `OrderInventoryService` themselves with success mocks. That would remove the idempotency, reservation consumption, and state audit behavior this chapter intends to verify. An integration test must replace only external effects while running internal transactions against the real lab database.

## Shutdown is another state transition after the last request

Queue starts its worker processor only after the full bootstrap-ready handoff. Being able to enqueue during module initialization does not mean a worker is already processing jobs. If startup fails, verify that an unready worker did not process messages and that the failure state remains observable. A normal startup in development alone does not guarantee safe deployment startup.

Once shutdown begins, Queue rejects new enqueue calls. If graceful worker close fails or exceeds its budget, it attempts force-close, with a `workerShutdownTimeoutMs` budget applied to each stage. Setting two seconds therefore does not guarantee that the entire application exits within two seconds. Dead-letter write cleanup also has a separate bound, and shutdown can continue without a record having reached Redis. Do not erase failures from shutdown logs; retain them alongside evidence for reconciliation on the next startup.

Also distinguish the raw RabbitMQ adapter from the programmatic `Microservice` facade. The application injects and uses `MICROSERVICE`. Facade close coordinates disposal of already-accepted handlers and rejection of new ingress, then detaches transport subscriptions. The application then closes caller-owned publishers, consumers, channels, and connections. Disconnecting the connection first is not a basis for concluding that handlers finished cleanly.

A shutdown experiment needs two observation signals. The first marks handler entry; the second marks the operation ending in commit, rollback, or explicit failure. Start shutdown after the first signal and check that new work is rejected. Judge the actual database connection disposal order only after the second signal. Also avoid a deadlock where the test awaiting shutdown never releases the handler itself.

## Close Volume 2 with a retrospective

After the drills, retain records that explain failures rather than merely a count of successful scenarios. Write down which inputs created which durable state, how to find that state again if a response is lost, who owns retries, and which cases require manual reconciliation. Comparing the preceding chapter's HTTP latency, payment outcomes, and Outbox age with final ledger state over the same time window also lets you evaluate whether the metrics reveal the product's real problems.

No new Redis or RabbitMQ server was created and no failures were injected into a real order database while writing this manuscript. The code's module and delivery experiments and the external infrastructure experiments are separate reproduction procedures, not claims of passing execution. After moving the source experiment files into your app, run the relevant files with the existing Vitest standard decorator configuration, and verify real stores separately in an isolated environment. Public package regression tests are evidence for Fluo's contracts, not for a complete FluoShop deployment.

Completion does not declare that failures never happen. It means the state of inventory and money remains explainable after failure, a repeated request can distinguish work already done, and the operator can decide the next recovery action. Blog readers read posts and buy products with the same accounts. We did not abandon the blog for the shop, and separated only the necessary fulfillment boundary. That is the continuity of the product developed throughout this volume.

The next volume does not start with another app or a new package list. It follows the order request we just built through the actual Fluo source: decorator metadata, module compilation, DI resolution, runtime dispatch, and shutdown boundaries. Asking where the promise we just tested - "consumption does not complete before the handler finishes" - is upheld in code gives us a reason to read the internals.

## Evidence and further source reading

- [Testing module, request, and override contracts](../../packages/testing/README.md), [public exports](../../packages/testing/src/index.ts), [public builder types](../../packages/testing/src/types.ts), [test layer contracts](../../docs/contracts/testing-guide.md)
- [Queue retry, serialization, and shutdown contracts](../../packages/queue/README.md), [public exports](../../packages/queue/src/index.ts), [option and inspection types](../../packages/queue/src/types.ts), [worker decorator](../../packages/queue/src/decorators.ts), [module registration](../../packages/queue/src/module.ts)
- [Queue lifecycle and dispatch regression tests](../../packages/queue/src/module.test.ts), [dead-letter disposal tests](../../packages/queue/src/dead-letter-manager.test.ts), [inspection lifecycle tests](../../packages/queue/src/service.inspection-lifecycle.test.ts)
- [Microservices completion and ownership contracts](../../packages/microservices/README.md), [public exports](../../packages/microservices/src/index.ts), [transport and facade types](../../packages/microservices/src/types.ts), [RabbitMQ completion boundary](../../packages/microservices/src/transports/rabbitmq-transport.ts)
- [RabbitMQ regression tests](../../packages/microservices/src/transports/rabbitmq-transport.test.ts), [event failure signal tests](../../packages/microservices/src/transports/event-failure-signal.test.ts), [handler discovery by provider token](../../packages/microservices/src/handler-discovery-provider-token.test.ts)

[Previous](./ch27-sale-observability.md) | [Table of Contents](./toc.md) | [Next Volume](../03-internals/ch01-trace-an-order.md)
