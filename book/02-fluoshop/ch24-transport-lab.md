# A Lab for Choosing Message Transports

<!-- book:volume=02-fluoshop;chapter=24 -->

[Previous: Extracting Fulfillment into a Separate Service](./ch23-extract-fulfillment.md) - [Volume 2 Contents](./toc.md) - [Next: Implementing the Same Repository Contract with Prisma and Drizzle](./ch25-drizzle-lab.md)

## Start with Failure Conditions, Not Broker Names

At a team meeting after extracting the fulfillment service, three opinions emerge: use Redis for messages because it is already in operation, use Kafka because it scales well, or use TCP because there are only two services. Each can be a starting point, but none is yet a comparison question. FluoShop needs to carry a business contract: "Do not lose or execute the same order's fulfillment request twice." Put that contract's failure conditions ahead of lists of features by brand.

This chapter is a **comparison lab**. It does not remove the previous chapter's RabbitMQ path or add every broker to the production application at once. PostgreSQL/Prisma, the order Outbox, and the fulfillment Inbox and job table remain the baseline. We compare which parts of delivery, responses, recovery, and shutdown a transport takes on between the two stores. We therefore do not conclude that whichever transport produces the shortest code in the experiment should immediately be adopted in production.

You can place the lab files in `src/transport-lab/` of the `fluo-blog` you created. This does not imply that the book repository already contains a complete transport comparison application. The execution baseline is Node24 and pnpm10, using the existing Fluo build path that transforms standard decorators. Do not assume Node's type stripping alone can execute decorator source.

## The Same Method Name Does Not Mean the Same Completion

`MICROSERVICE` is Fluo's programmatic facade, not a raw transport. Registering it with `MicroservicesModule.forRoot({ transport })` and injecting it gives access to common boundaries such as module discovery, payload cloning, and blocking new work during shutdown. It does not, however, make the transport semantics of `send()` and `emit()` identical.

`send()` waits for a correlated remote response. A timeout means that the response did not arrive within the allotted time. Whether the remote DB has already committed must be checked through separate business records. Cancelling an `AbortSignal` does not automatically roll back already-accepted remote work. A request ID connects a response to its caller, while the stable `eventId` from the previous chapter distinguishes business duplicates across restarts and redeliveries.

`emit()` completes when the transport's publication operation finishes. In RabbitMQ, that operation can be made to wait for a publisher confirm, but this does not mean the fulfillment handler has stored the job. In TCP it is a frame write; in Redis Pub/Sub it is publication to current subscribers. gRPC emit uses a remote unary acknowledgement, but that too is distinct from a domain result such as parcel dispatch completion. Many transports that can return responses still have no durable queue.

The following table describes the boundaries provided by the current Fluo adapters. Even if a broker product has broader features, do not mix features that its adapter does not expose into this table.

| Transport | Request/response | Publication and recovery essentials | Resources still owned by the application after shutdown |
| --- | --- | --- | --- |
| TCP | Supported | No storage or replay; delivers frames to a connected peer | Fluo disposes of the listener and active sockets |
| Redis Pub/Sub | Unsupported | Event-only; no replay to disconnected subscribers | Publish and subscribe clients |
| Redis Streams | Supported | Consumer groups, XACK after processing, conditional pending recovery | Reader and writer clients |
| NATS | Supported | This adapter provides no JetStream storage or replay contract | NATS client and codec |
| Kafka | Supported | Topic retention, producer ACK, offsets, and retries depend on collaborator configuration | Producer and consumer |
| RabbitMQ | Supported | Durable topology, confirms, ACK, and DLX depend on application composition | Publisher, consumer, channel, and connection |
| MQTT | Supported | Depends on QoS and retain settings; retain holds the last value, not history | A supplied client; Fluo disposes of a client created from a URL |
| gRPC | Supported | Unary and server/client/bidi streaming; no broker storage | A supplied server; Fluo disposes of the outbound client |

Also distinguish what "Streams" refers to. Redis Streams is a broker data structure, distinct from continuously exchanging RPC data through `serverStream()`, `clientStream()`, and `bidiStream()`. In the table above, gRPC provides this common streaming API. Ownership of message delivery and ownership of streaming HTTP responses are different concerns too.

## First Experiment: Separate TCP Responses from Business Duplicates

The following `src/transport-lab/tcp-probe.ts` is a **complete experiment file**. It uses a real loopback TCP listener but does not call a carrier. `ReceiptLedger` is an in-memory ledger for the experiment, not an alternative implementation of a durable Inbox. It is an observation device for distinguishing two remote calls from one business record.

```ts
import assert from 'node:assert/strict';
import { Inject, Module } from '@fluojs/core';
import {
  MessagePattern,
  MicroservicesModule,
  TcpMicroserviceTransport,
} from '@fluojs/microservices';
import { fluoFactory } from '@fluojs/runtime';

class ReceiptLedger {
  calls = 0;
  readonly orders = new Set<string>();

  accept(orderId: string) {
    this.calls += 1;
    this.orders.add(orderId);
    return { orderId, accepted: true };
  }
}

@Inject(ReceiptLedger)
class ReceiptHandler {
  constructor(private readonly ledger: ReceiptLedger) {}

  @MessagePattern('fulfillment.acceptance-probe.v1')
  accept(value: unknown) {
    if (typeof value !== 'object' || value === null
      || !('orderId' in value) || typeof value.orderId !== 'string'
      || value.orderId.length === 0) {
      throw new TypeError('Invalid receipt probe');
    }
    return this.ledger.accept(value.orderId);
  }
}

export async function tcpProbe(): Promise<void> {
  const ledger = new ReceiptLedger();
  const transport = new TcpMicroserviceTransport({
    host: '127.0.0.1',
    port: 0,
    requestTimeoutMs: 1_000,
  });

  @Module({
    imports: [MicroservicesModule.forRoot({ transport })],
    providers: [
      { provide: ReceiptLedger, useValue: ledger },
      ReceiptHandler,
    ],
  })
  class ProbeModule {}

  const application = await fluoFactory.createMicroservice(ProbeModule);
  try {
    await application.listen();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const reply = await application.send('fulfillment.acceptance-probe.v1', {
        orderId: 'order-1042',
      });
      assert.deepEqual(reply, { orderId: 'order-1042', accepted: true });
    }
    assert.equal(ledger.calls, 2);
    assert.equal(ledger.orders.size, 1);

    const abort = new AbortController();
    abort.abort();
    await assert.rejects(application.send(
      'fulfillment.acceptance-probe.v1',
      { orderId: 'order-aborted' },
      abort.signal,
    ));
    assert.equal(ledger.calls, 2);
  } finally {
    await application.close();
  }
  await assert.rejects(application.send('fulfillment.acceptance-probe.v1', {
    orderId: 'order-after-close',
  }));
}
```

`port: 0` lets the OS assign a free port. After listening, the current TCP adapter can send outbound calls to that port, enabling a self-round-trip experiment without port collisions. This verifies the path from module discovery to frame round trips on loopback, not firewalls, DNS, or TLS between two machines. The helper explicitly registers `ReceiptHandler`, which uses standard decorators, and makes the class-level `@Inject` token match the actual provider.

The expected result is two handler calls and one in-memory order record. The record count is one not because TCP provides exactly-once delivery, but because the ledger's set operation merges the same order. In a new process, that set disappears. This difference explains why the previous chapter's DB Inbox is needed. The cancelled request is already aborted before publication, so it must not increase the handler call count, and a new send after shutdown must be rejected. Cancelling after the remote handler has already started is a separate experiment question.

## Second Experiment: Do Not Mistake RabbitMQ Publication for Processing Completion

Many test doubles invoke the consumer handler directly inside `publish()` and await its Promise. Such a double makes `await emit()` appear to wait for remote completion. The test has invented a guarantee that does not hold in production. The following `src/transport-lab/rabbit-completion-probe.ts` is a **complete source experiment file** that deliberately separates publication from delivery.

```ts
import assert from 'node:assert/strict';
import { RabbitMqMicroserviceTransport } from '@fluojs/microservices';

export async function rabbitCompletionProbe(): Promise<void> {
  const callbacks = new Map<string, (message: string) => Promise<void> | void>();
  const publications: Array<{ queue: string; message: string }> = [];
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let completed = false;
  let acknowledged = false;
  let closedResources = 0;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<never>((_, reject) => {
    deadline = setTimeout(() => reject(new Error('Probe timed out')), 1_000);
  });
  const publisher = {
    async publish(queue: string, message: string) {
      publications.push({ queue, message });
    },
    async close() {
      closedResources += 1;
    },
  };
  const consumer = {
    async consume(queue: string, handler: (message: string) => Promise<void> | void) {
      callbacks.set(queue, handler);
    },
    async cancel(queue: string) {
      callbacks.delete(queue);
    },
    async close() {
      closedResources += 1;
    },
  };
  const transport = new RabbitMqMicroserviceTransport({
    eventQueue: 'lab.fulfillment.events',
    publisher,
    consumer,
  });

  try {
    await transport.listen(async (packet) => {
      if (packet.pattern === 'fulfillment.fail-probe.v1') {
        throw new Error('Rejected delivery');
      }
      entered.resolve();
      await release.promise;
      completed = true;
    });
    await transport.emit('fulfillment.requested.v1', { orderId: 'order-1042' });
    assert.equal(publications.length, 1);
    assert.equal(completed, false);

    const published = publications[0];
    assert.ok(published);
    const deliver = callbacks.get(published.queue);
    assert.ok(deliver);
    const delivery = Promise.resolve(deliver(published.message)).then(() => {
      acknowledged = true;
    });
    await Promise.race([entered.promise, bound]);
    assert.equal(acknowledged, false);
    release.resolve();
    await delivery;
    assert.equal(completed, true);
    assert.equal(acknowledged, true);

    await transport.emit('fulfillment.fail-probe.v1', { orderId: 'order-failed' });
    const failed = publications[1];
    assert.ok(failed);
    await assert.rejects(Promise.resolve().then(() => deliver(failed.message)));
  } finally {
    clearTimeout(deadline);
    release.resolve();
    await transport.close();
    assert.equal(callbacks.size, 0);
    assert.equal(closedResources, 0);
    await consumer.close();
    await publisher.close();
  }
  assert.equal(closedResources, 2);
}
```

Here, `acknowledged` represents **the point when a collaborator can decide to ACK**, not a real AMQP ACK. The double has no broker storage, redelivery, or prefetch. Even with those limits acknowledged, it proves something useful. `emit()` finishes immediately after publication is recorded, before delivery starts; even after delivery starts, the consumer callback does not complete until the handler finishes. A failed event handler rejects that callback.

`entered` and `release` control the event ordering. The one-second deadline is an upper bound that prevents the experiment from hanging forever on failure, not a sleep used to obtain a successful result. This differs from a test that guesses an ACK must have happened after roughly 300 milliseconds in a slow real environment. During resource shutdown, the transport cancels the consumer but does not call `close()` on the supplied publisher or consumer. The final two calls reproduce the disposal the application must perform.

With real RabbitMQ, the confirm channel and ACK/failed-queue wiring from the previous chapter implement this collaborator contract. The next step is an integration experiment that breaks the connection immediately after DB commit. Do not report that durable queues or DLX are configured correctly merely because this source experiment passes.

## Third Experiment: Do Not Choose Request/Response Based Only on the Redis Name

Treating Redis Pub/Sub and Redis Streams as the same option leads to the mistake of entrusting purchase completion confirmation to Pub/Sub. The following `src/transport-lab/pubsub-capability-probe.ts` is a **complete contract experiment file**. Without a Redis server, it checks the current adapter's unsupported operation and publication boundary. Each double satisfies the client shape of the public options, but is not a real Redis store.

```ts
import assert from 'node:assert/strict';
import {
  RedisPubSubMicroserviceTransport,
  type RedisPubSubMicroserviceTransportOptions,
} from '@fluojs/microservices';

export async function pubSubCapabilityProbe(): Promise<void> {
  let published = 0;
  const makeClient = (): RedisPubSubMicroserviceTransportOptions['publishClient'] => ({
    on() {},
    off() {},
    async subscribe() {},
    async unsubscribe() {},
    async publish() {
      published += 1;
      return 0;
    },
  });
  const transport = new RedisPubSubMicroserviceTransport({
    namespace: 'lab:fulfillment',
    publishClient: makeClient(),
    subscribeClient: makeClient(),
  });
  try {
    await assert.rejects(transport.send('fulfillment.acceptance-probe.v1', {
      orderId: 'order-1042',
    }));
    assert.equal(published, 0);
    await transport.emit('fulfillment.requested.v1', { orderId: 'order-1042' });
    assert.equal(published, 1);
  } finally {
    await transport.close();
  }
}
```

The expected result is that `send()` rejects without publication and that a publication with 0 subscribers is still compatible with `emit()` completing. The latter count is returned by the double, so we do not claim it as an actual Redis observation. We only verify the boundary that the adapter does not turn that value into proof of fulfillment completion.

Redis Pub/Sub can send refresh hints to currently connected screens because a screen that misses a hint can reread the source. It does not meet the requirement to deliver jobs later to offline fulfillment workers. The two Redis clients are separate because real Redis subscribe mode differs from ordinary command use. Do not turn a lifecycle-managed cache connection into a subscriber and break existing product GETs.

Redis Streams provides consumer groups and late `XACK`. But pending recovery does not work the same way everywhere. If the reader provides `xautoclaim`, it can reclaim idle pending requests in a shared request group. Event groups are separated by instance UUID to preserve broadcast semantics, so you cannot assume a new listener inherits a dead listener's event PEL. Options that trim messages still being processed through publish-time trimming also weaken recovery guarantees. The reasoning that "we already have Redis" is not complete until you review the kind used to send fulfillment requests and who owns the consumer group.

## Narrow Down Real Candidates with the Same Failure Table

Convergence of business state matters more than types matching in an experiment. Use the same `eventId` and `orderId` for each candidate and record the following boundaries. Enter measurements or verified configuration in the comparison table. Do not fill unexecuted candidates with estimated throughput.

| Injection point | What to observe | Expected fulfillment-contract result |
| --- | --- | --- |
| Publish before the consumer starts | Publication completion and remaining queue/log entries | If durable delivery was chosen, work can be accepted after the consumer starts |
| Handler fails before DB commit | Callback result and ACK/offset | Unfinished work is not confirmed as successful |
| Confirmation is lost after DB commit | Redelivery of the same eventId and job count | One durable job even after redelivery |
| Cancel send during remote processing | Caller error and remote storage state | Call cancellation is not taken as proof of remote non-execution |
| Shut down while a handler is running | New ingress, drain, and resource close | Observe the completion boundary of accepted work after blocking new work |
| Invalid contract version | Isolation records and retry count | Infinite retries do not starve valid work |

If considering Kafka, check when the consumer offset is committed in the collaborator code you supply. Fluo keeps the callback pending until the event handler and response publication finish, but it does not undo a collaborator's choice to commit offsets earlier. Sufficient topic retention alone does not establish that an order executes once.

If considering NATS, start from the fact that the current adapter connects request/reply and publish but adds no JetStream durability or replay contract. gRPC streaming can be useful for large label-generation results or incremental data flows, but recovering work after a disconnection remains a matter of durable application records. Using MQTT retained messages as a fulfillment event history can overwrite an earlier order on the same topic with a new value.

Network load also needs a fair comparison. Fix the payload size, number of concurrent requests, storage work, and confirm/ACK settings, and measure publication latency separately from final job acceptance latency. Do not change batch size to favor one candidate, or call one "faster" when one measurement waits for DB commit and the other measures only a socket write. This chapter's small experiments are not throughput benchmarks and offer no performance ranking.

## Record the Guarantees You Give Up Too

For now, FluoShop retains the previous chapter's RabbitMQ event path. The reason is not that RabbitMQ is superior for every system, but that it suits current fulfillment operations: keeping work in a queue while making caller-owned confirm, ACK, and isolation policies explicit. We accept Outbox publication lag and the cost of operating a failed queue, and make redeliveries converge through the Inbox. Notifications within a single process remain on event-bus, and existing background jobs remain on the Redis queue. We do not unify them all at once merely because they offer similar APIs.

At small scale without a need for separate deployment, function calls and module boundaries have the fewest failure points. Even when a separate process is needed, Pub/Sub may be sufficient for refresh hints that can tolerate loss. TCP or gRPC can suit queries whose results are needed immediately and can be recomputed from the source. Choose by product event rather than lumping orders, payments, and fulfillment together as one "messaging system."

We can now distinguish the contracts to preserve when changing transports from the boundaries to verify again. The next chapter compares storage in the same way. When changing Prisma to Drizzle, we first ask whether order snapshots, uniqueness, and transaction results remain intact, rather than focusing on method names or code length.

## Evidence and Verification Scope

The three experiments use real loopback TCP, RabbitMQ collaborator doubles, and Redis Pub/Sub client doubles, respectively. The latter two do not start external brokers. This manuscript does not claim to have executed real connectivity, failure recovery, or throughput checks for Kafka, NATS, Redis Streams, MQTT, or gRPC.

- [Transport Capability, Completion, and Ownership Matrix](../../packages/microservices/README.md)
- [Public Facade and Transport Types](../../packages/microservices/src/types.ts)
- [TCP Implementation](../../packages/microservices/src/transports/tcp-transport.ts) - [Tests Supporting the TCP Experiment](../../packages/microservices/src/transports/tcp-transport.test.ts)
- [RabbitMQ Implementation](../../packages/microservices/src/transports/rabbitmq-transport.ts) - [RabbitMQ Completion and Shutdown Tests](../../packages/microservices/src/transports/rabbitmq-transport.test.ts)
- [Redis Pub/Sub Implementation](../../packages/microservices/src/transports/redis-transport.ts) - [Pub/Sub Tests](../../packages/microservices/src/transports/redis-transport.test.ts)
- [Redis Streams Recovery and Retention Implementation](../../packages/microservices/src/transports/redis-streams-transport.ts)
- [NATS Implementation](../../packages/microservices/src/transports/nats-transport.ts) - [Kafka Implementation](../../packages/microservices/src/transports/kafka-transport.ts)
- [MQTT Implementation](../../packages/microservices/src/transports/mqtt-transport.ts) - [gRPC Implementation](../../packages/microservices/src/transports/grpc-transport.ts)
- [Microservice Lifecycle Regression Tests](../../packages/microservices/src/lifecycle-regression.test.ts)

[Previous Chapter](./ch23-extract-fulfillment.md) - [Volume 2 Contents](./toc.md) - [Next Chapter](./ch25-drizzle-lab.md)
