<!-- packages: @fluojs/microservices, amqplib -->
<!-- project-state: FluoShop v1.3.0 -->

# 4. RabbitMQ

RabbitMQ is the first broker in this part that feels unapologetically queue-centric. Redis Streams already gave FluoShop durable delivery, but RabbitMQ changes the conversation by making queue topology itself the primary design tool. That matters when one service must own work, another service must retry it, and a third service must stay out of the way until the broker decides delivery is ready. In FluoShop v1.3.0, we move the post-payment fulfillment handoff onto RabbitMQ. The Order Service still accepts customer traffic through the earlier transports, but the new RabbitMQ path begins after payment succeeds. At that point the business no longer needs immediate user-facing latency; it needs dependable work queues for picking, packing, and downstream notification.

Architecture-wise, this represents the transition from **stream logs** (where everyone sees everything and decides their own offset) to **task queues** (where work is explicitly pushed to a consumer's mailbox). In a warehouse environment, where physical resources like packers and shelf-space are finite, the task-queue model is significantly safer for resource coordination than a shared broadcast.

## 4.1 Why RabbitMQ in FluoShop

RabbitMQ is a strong fit when the topology is about queues rather than logs. The Fulfillment Service should own packaging work, the Notification Service should hear about fulfillment milestones without becoming the main worker, and operations should be able to inspect queue depth and know whether a delay is real or only transient. That style is more natural in RabbitMQ than in a generic request path.

For FluoShop, Chapter 4 adds three concrete goals.

1. Preserve the customer-facing order flow from the previous chapters.
2. Push warehouse work into broker-backed queues after payment confirmation.
3. Keep the programming model identical to earlier handlers even though the transport is different.

RabbitMQ is not replacing TCP or Redis everywhere.

It is taking over the handoff where explicit queue ownership improves clarity.

The moment a package must be packed by exactly one worker, queues become more informative than fan-out topics. By using RabbitMQ's **Competing Consumers** pattern, we ensure that even if we scale the Fulfillment Service to ten instances, a single `payment.settled` event results in exactly one warehouse "picking" task, preventing double-shipping errors at the infrastructure level.

## 4.2 Bootstrapping RabbitMQ with caller-owned collaborators

The fluo transport does not hide RabbitMQ behind a magical connection manager. Like the package README describes, broker clients remain caller-owned collaborators, which means the application is responsible for creating channels, declaring queues, and passing publish or consume functions into the transport. This is a deliberate design choice. The framework owns message routing, and the application still owns infrastructure wiring.

This "collaborator" pattern ensures that `amqplib`—the most common Node.js RabbitMQ driver—is not a forced dependency of the framework core. It also allows FluoShop to use custom connection logic, such as cluster failover or custom authentication, without the framework needing to know about those specific RabbitMQ configurations.

### 4.2.1 Publisher and consumer collaborators

`RabbitMqMicroserviceTransport` expects two collaborators.

- `publisher.publish(queue, message)` sends a serialized frame.
- `consumer.consume(queue, handler)` and `consumer.cancel(queue)` manage queue listeners.

The transport also exposes queue-level options that matter to book examples.

- `eventQueue`
- `messageQueue`
- `responseQueue`
- `requestTimeoutMs`

If you do not override them, fluo uses defaults for the event, message, and response queues.

The response queue is especially important.

By default it is instance-scoped and includes a random UUID.

That prevents reply collisions when multiple service instances are active at the same time. If the Order Service instance A sends a request, only instance A's `responseQueue` (e.g., `fluo.microservices.responses.uuid-a`) will receive the answer. Instance B never even sees the message, because it is listening on its own unique response queue.

### 4.2.2 Module wiring

In FluoShop, the Fulfillment Service boots RabbitMQ as a dedicated microservice boundary.

```typescript
import { Module } from '@fluojs/core';
import { MicroservicesModule, RabbitMqMicroserviceTransport } from '@fluojs/microservices';

const transport = new RabbitMqMicroserviceTransport({
  consumer: rabbitConsumer, // Passed from main bootstrap
  publisher: rabbitPublisher, // Passed from main bootstrap
  eventQueue: 'fluoshop.fulfillment.events',
  messageQueue: 'fluoshop.fulfillment.messages',
  requestTimeoutMs: 8_000,
});

@Module({
  imports: [
    MicroservicesModule.forRoot({
      transport,
    }),
  ],
  providers: [FulfillmentHandler],
})
export class FulfillmentModule {}
```

This code should look familiar by now.

The handler model remains steady.

Only the transport bootstrap changes.

That continuity is what makes the intermediate book cumulative instead of repetitive. Whether you are using `TcpMicroserviceTransport` from Chapter 2 or this RabbitMQ transport, your `@MessagePattern` handlers require zero code changes to receive data.

## 4.3 Queue topology for request and event traffic

RabbitMQ encourages explicit queue names because queues are not just pipes. They are operational objects: teams inspect them, redrive them, and decide who owns them.

In FluoShop we use separate queues for command-like messages and event-like broadcasts. This distinction is critical for **SLA management**: we can give the "message" queue (critical customer requests) higher priority or more workers than the "event" queue (background notifications).

### 4.3.1 Message, event, and response queues

The transport models three frame kinds internally.

- `message`: Used for request-response (commands).
- `event`: Used for fire-and-forget (broadcasts).
- `response`: Used for correlated replies.

That leads to a practical RabbitMQ topology.

- `fluoshop.fulfillment.messages` carries request-reply commands such as `fulfillment.reserve-packers`.
- `fluoshop.fulfillment.events` carries fire-and-forget signals such as `payment.settled`.
- `fluoshop.fulfillment.responses.<instance>` carries replies back to the sender.

This split keeps intent readable.

When operators see a backlog in the message queue, they know request-style work is waiting.

When they see volume in the event queue, they know broadcast-style side effects are active. This topology also simplifies security; the Order Service needs "write" access to the Fulfillment event/message queues, but only "read" access to its own unique response queue.

### 4.3.2 Instance-scoped response queues

The RabbitMQ tests in the repository verify an important safety detail. Concurrent instances should not steal each other's replies. That is why the default `responseQueue` includes `crypto.randomUUID()`. For FluoShop, this means we can safely scale the Order Service horizontally while still allowing each instance to await its own fulfillment reply. This is implemented using the **Direct Reply-to** concept (or a temporary queue), where the `replyTo` field in the request header tells the consumer exactly where to send the result. If you override `responseQueue`, you are explicitly taking ownership of a shared reply topology. That can be valid, but it also means you must coordinate correlation and lifecycle policies yourself. The safe default is to leave the response queue instance-scoped.

## 4.4 Request-response workflows on RabbitMQ

RabbitMQ is often introduced as if it were only for background jobs.

fluo supports more than that.

You can still use `send()` and receive a correlated response.

The transport serializes a request frame, includes `requestId` and `replyTo`, then resolves or rejects the caller when a response frame arrives. Internally, the transport maintains a `Map` of pending requests, keyed by `requestId`, ensuring that even if thousands of responses arrive in the same minute, they are routed to the correct `async/await` caller.

### 4.4.1 FluoShop packer reservation

In FluoShop, the Order Service sometimes needs a quick broker-backed answer from Fulfillment. For example, it may ask whether a warehouse wave has enough packer capacity before promising same-day dispatch.

```typescript
import { Inject } from '@fluojs/core';
import { MICROSERVICE, type Microservice } from '@fluojs/microservices';

export class FulfillmentClient {
  constructor(@Inject(MICROSERVICE) private readonly microservice: Microservice) {}

  async reservePackers(orderId: string, warehouseId: string) {
    // This uses RabbitMqMicroserviceTransport.send()
    return await this.microservice.send('fulfillment.reserve-packers', {
      orderId,
      warehouseId,
    });
  }
}
```

The business benefit is subtle. The Order Service does not need a direct TCP socket into warehouse internals.

It needs a transport that still supports replies while fitting the queue-oriented operational model the warehouse team already uses.

RabbitMQ provides that bridge.

### 4.4.2 Timeouts, correlation, and handler failures

The transport rejects if a response does not arrive before `requestTimeoutMs`.

It also round-trips handler errors back to the caller.

That means FluoShop can distinguish three conditions.

1. Fulfillment accepted and answered the request.
2. Fulfillment handled the request but rejected it with a domain error.
3. No reply arrived before the timeout budget expired.

Those states should not be collapsed into one generic failure.

If the warehouse actively rejects same-day dispatch, the API can explain that policy choice.

If the broker path times out, the API should surface a transient dependency error instead. This distinction is made possible by the `error` property in the `RabbitMqTransportMessage` frame; if the handler throws, the transport catches it, serializes the message, and sends it back to the `replyTo` queue with the `kind: 'response'` and `error: string` set.

## 4.5 Event-driven workflows on RabbitMQ

RabbitMQ also supports fire-and-forget event delivery through `emit()`.

This is where FluoShop v1.3.0 becomes more realistic.

After Payment emits `payment.settled`, the event can drive multiple reactions. Fulfillment schedules picking, Notification prepares customer messaging, and risk systems can record a checkpoint. The payment path no longer needs to wait for every downstream side effect.

### 4.5.1 Payment settled to fulfillment requested

The simplest version of the handoff looks like this.

```typescript
@EventPattern('payment.settled')
async onPaymentSettled(event: { orderId: string; warehouseId: string }) {
  // Logic to prepare the warehouse picking wave
  await this.fulfillmentPlanner.enqueuePickWave(event.orderId, event.warehouseId);
}
```

Notice what does not change. The handler is still just a provider method, the transport owns the queue frame, and the domain service owns the business decision.

This is the recurring fluo pattern throughout the book. Even though the "wire" changed from a TCP socket to a RabbitMQ queue, the `@EventPattern` allows the developer to focus purely on the side effect logic.

### 4.5.2 Dead-letter and redrive policy

The transport intentionally stays focused on frame routing.

Queue declaration policy belongs to the caller-owned RabbitMQ setup.

That means dead-letter exchanges, TTLs, max delivery attempts, and redrive tooling should be configured alongside the application's `amqplib` channels.

For FluoShop, warehouse events are a good place to define those policies.

If `pickwave.created` fails repeatedly, operators should be able to quarantine the poisoned message without losing the original order context. This is the "poison pill" safety net: rather than crashing the consumer or losing the message, RabbitMQ moves the message to a **Dead Letter Exchange (DLX)** after N failed attempts, where it can be manually inspected and fixed.

RabbitMQ shines when those recovery mechanics are explicit.

## 4.6 Delivery safety and operations

The repository tests document several behaviors worth carrying into production guidance.

- `send()` requires `listen()` first (to ensure a response queue exists).
- timeouts reject the caller clearly with a descriptive error string.
- concurrent requests stay correlated by `requestId` UUIDs.
- instance-scoped response queues prevent reply theft.

That gives us a stable mental model for FluoShop.

RabbitMQ is not magical durability.

It is durable enough only when topology, retries, and queue ownership are defined responsibly. Because fluo uses **JSON serialization** for the transport frames, it is also highly interoperable; a legacy Java service can send a message to FluoShop's RabbitMQ queue as long as it follows the simple `RabbitMqTransportMessage` schema.

### 4.6.1 Operational signals to watch

For the fulfillment queues, the team should watch:

- **Ready message count**: Backlog of work waiting to be picked up.
- **Unacked or in-flight work**: Messages currently being processed by a worker.
- **Redeliveries after deploys**: How many messages were put back in the queue because a worker crashed or timed out.
- **Response queue churn**: How many unique reply queues are being created/destroyed.
- **Growth in dead-letter queues**: The count of "failed" business processes.

Those metrics tell different stories.

A rising ready count suggests workers are under-provisioned.

A rising redelivery count suggests unstable handlers.

Rapid response queue churn may indicate instances are restarting too often.

### 4.6.2 FluoShop rollout plan

In v1.3.0, only the fulfillment handoff moves to RabbitMQ.

The rest of FluoShop remains intentionally mixed.

- API reads can stay on TCP for lowest latency.
- Payment durability can stay on Redis Streams for append-only log safety.
- Warehouse work moves onto RabbitMQ queues for task-based ownership.

That hybrid state is healthy.

Architectures usually evolve one boundary at a time.

The practical lesson is to move the link that benefits most from a queue-owned operational model.

Do not migrate every transport merely for symmetry. Symmetry is a developer preference; reliability is a business requirement.

## 4.7 Summary

- RabbitMQ fits queue-oriented ownership better than direct request paths.
- fluo keeps RabbitMQ bootstrap explicit through caller-owned publisher and consumer collaborators.
- request-reply flows remain available through `send()` with `requestId` and `replyTo` correlation.
- instance-scoped response queues are the safe default for concurrent service instances.
- FluoShop now routes post-payment fulfillment work through RabbitMQ, giving warehouse operations a clearer queue model.

At this point in the book, FluoShop has three distinct communication styles. TCP handles simple direct reads, Redis Streams protects money-sensitive durability, and RabbitMQ owns warehouse queues where work assignment matters more than stream replay.

That transport diversity is a strength, not a mess. It proves that a single framework can unify different operational needs under a single, consistent programming interface.
