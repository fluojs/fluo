<!-- packages: @fluojs/microservices, amqplib -->
<!-- project-state: FluoShop v1.3.0 -->

# Chapter 4. RabbitMQ

This chapter introduces RabbitMQ so FluoShop can move its post-payment handoff to a work queue centered model. Chapter 3 used durable streams to gain resilience. Now we look at a transport that fits fulfillment flows where queue ownership and the competing consumer model matter.

## Learning Objectives
- Understand why RabbitMQ fits work queue centered workflows.
- Learn how to wire the RabbitMQ transport with a caller-owned publisher and consumer collaborator.
- Design request/response and event flows by separating message, event, and response queues.
- See how instance-scoped response queues contribute to concurrent request safety.
- Analyze the operational signals and tradeoffs involved in moving the FluoShop fulfillment handoff to RabbitMQ.

## Prerequisites
- Complete Chapter 1, Chapter 2, and Chapter 3.
- Basic understanding of queue-based brokers and the competing consumer pattern.
- Basic concepts for asynchronous work processing and retry policies.

## 4.1 Why RabbitMQ in FluoShop

RabbitMQ is especially suitable when the topology is designed around queues rather than logs. Fulfillment Service must directly own packing work, and Notification Service must listen to fulfillment milestones without becoming the primary worker. Operators need to inspect queue depth and decide whether delay is a real bottleneck or a temporary condition. This operational model is more natural in RabbitMQ than in a normal request path.

In FluoShop, Chapter 4 adds three concrete goals.

1. Keep the customer order flow built in the previous chapters.
2. Push warehouse work after payment confirmation into broker-backed queues.
3. Keep the programming model the same even when the transport changes.

RabbitMQ doesn't replace TCP or Redis everywhere. It handles only the handoffs where explicit queue ownership gives more clarity.

When exactly one worker must pack a package, a queue gives more information than a fan-out topic. With RabbitMQ's **Competing Consumers** pattern, even if Fulfillment Service scales to 10 instances, one `payment.settled` event leads to exactly one warehouse "picking" task. This structure reduces duplicate shipping errors at the infrastructure level.

## 4.2 Bootstrapping RabbitMQ with caller-owned collaborators

The fluo transport doesn't hide RabbitMQ behind a magical connection manager. As the package README explains, the broker client remains a caller-owned collaborator. In other words, the application must create channels, declare queues, and pass publish or consume functions to the transport. This is intentional. The framework owns message routing, while the application continues to own infrastructure wiring.

This "collaborator" pattern ensures that `amqplib`, the most common RabbitMQ driver for Node.js, doesn't become a forced dependency of the framework core. It also lets FluoShop use complex connection logic such as cluster failover or custom authentication without the framework needing to know the concrete RabbitMQ configuration.

### 4.2.1 Publisher and consumer collaborators

`RabbitMqMicroserviceTransport` expects two collaborators.

- `publisher.publish(queue, message)` sends a serialized frame.
- `consumer.consume(queue, handler)` and `consumer.cancel(queue)` manage queue listeners.

This transport also provides queue-level options that matter in the book examples.

- `eventQueue`
- `messageQueue`
- `responseQueue`
- `requestTimeoutMs`

If these aren't overridden, fluo uses default values for event, message, and response queues. The response queue is especially important. By default, it is instance-scoped and includes a UUID. This prevents response collisions even when multiple service instances are alive at the same time. If Order Service instance A sends a request, only instance A's unique `responseQueue`, for example `fluo.microservices.responses.uuid-a`, receives the response. Instance B is listening to its own unique queue, so it never sees that message.

### 4.2.2 Module wiring

In FluoShop, Fulfillment Service bootstraps RabbitMQ as a dedicated microservice boundary.

```typescript
import { Module } from '@fluojs/core';
import { MicroservicesModule, RabbitMqMicroserviceTransport } from '@fluojs/microservices';

const transport = new RabbitMqMicroserviceTransport({
  consumer: rabbitConsumer, // Passed from the main bootstrap
  publisher: rabbitPublisher, // Passed from the main bootstrap
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

This code should now look very familiar. The handler model stays the same. Only the transport bootstrap changes. That continuity is what makes the intermediate book cumulative learning rather than repetition. Whether you use the `TcpMicroserviceTransport` from Chapter 2 or this RabbitMQ transport, a `@MessagePattern` handler doesn't need a single code change to receive data.

## 4.3 Queue topology for request and event traffic

RabbitMQ pushes you to design queue names explicitly because queues aren't just simple pipes. A queue is an operational object, and teams observe it, redrive it, and define ownership for it.

In FluoShop, queues are separated for command-like messages and event-like broadcasts. This distinction matters for **SLA management** because an important customer request in the "message" queue can receive higher priority or more workers than a background notification in the "event" queue.

### 4.3.1 Message, event, and response queues

Internally, this transport models three frame kinds.

- `message`: Used for request/response commands.
- `event`: Used for fire-and-forget broadcasts.
- `response`: Used for correlated responses.

This becomes the RabbitMQ topology.

- `fluoshop.fulfillment.messages` carries request/reply commands such as `fulfillment.reserve-packers`.
- `fluoshop.fulfillment.events` carries fire-and-forget signals such as `payment.settled`.
- `fluoshop.fulfillment.responses.<instance>` returns responses to the sender.

This separation makes intent easy to read. When operators see backlog in the message queue, they immediately know request-like work is delayed, and event queue volume shows how active broadcast-style side effects are. This topology also simplifies security. Order Service only needs write permission for Fulfillment's event/message queues and read permission only for its own unique response queue.

### 4.3.2 Instance-scoped response queues

The repository's RabbitMQ tests verify an important safety property. Concurrent instances must not intercept each other's responses. That is why the default `responseQueue` includes `crypto.randomUUID()`. In FluoShop, this lets each Order Service instance safely receive the fulfillment reply it is waiting for even when Order Service scales horizontally. This is implemented with the **Direct Reply-to** concept, or temporary queues, where the `replyTo` field in the request header tells the consumer exactly where to send the result. Overriding `responseQueue` yourself means you are taking ownership of a shared reply topology. That choice isn't wrong, but you must also own correlation and lifecycle policies yourself. The safe default is to keep instance-scoped response queues as they are.

## 4.4 Request-response workflows on RabbitMQ

RabbitMQ is often introduced only as a tool for background jobs. fluo supports a broader model than that. You can use `send()` and receive a correlated response. The transport serializes the request frame, sends it with `requestId` and `replyTo`, then resolves or rejects the caller when the response frame arrives. Internally, the transport maintains a `Map` of pending requests keyed by `requestId`, ensuring that even if thousands of responses arrive in the same minute, each one reaches the correct `async/await` caller.

### 4.4.1 FluoShop packer reservation

In FluoShop, Order Service sometimes needs a broker-backed quick answer from Fulfillment. For example, before promising same-day shipping, it may ask whether the warehouse wave has enough packer capacity.

```typescript
import { Inject } from '@fluojs/core';
import { MICROSERVICE, type Microservice } from '@fluojs/microservices';

@Inject(MICROSERVICE)
export class FulfillmentClient {
  constructor(private readonly microservice: Microservice) {}

  async reservePackers(orderId: string, warehouseId: string) {
    // Use RabbitMqMicroserviceTransport.send().
    return await this.microservice.send('fulfillment.reserve-packers', {
      orderId,
      warehouseId,
    });
  }
}
```

The business benefit here is subtle but clear. Order Service doesn't need a direct TCP socket into the warehouse. It needs a transport that supports responses while fitting the queue-centered operational model the warehouse team has already adopted. RabbitMQ provides exactly that bridge.

### 4.4.2 Timeouts, correlation, and handler failures

If a response doesn't arrive within `requestTimeoutMs`, the transport rejects the caller. Handler errors also round-trip back to the caller as they are. That lets FluoShop distinguish three states.

1. Fulfillment received the request and responded successfully.
2. Fulfillment processed the request but rejected it with a domain error.
3. No response arrived within the timeout budget.

These states must not be flattened into one generic failure. If the warehouse rejects same-day shipping as a policy decision, the API should be able to explain why. But if the broker path itself timed out, it should be shown as a temporary dependency error. This distinction is possible because of the `error` property in the `RabbitMqTransportMessage` frame. When a handler throws an error, the transport catches it, serializes the message, sets `kind: 'response'` and `error: string`, and returns it to the `replyTo` queue.

## 4.5 Event-driven workflows on RabbitMQ

RabbitMQ also supports fire-and-forget event delivery through `emit()`.

Here, FluoShop v1.3.0 evolves into a more realistic system.

When Payment publishes `payment.settled`, several reactions can follow. Fulfillment schedules picking, Notification prepares a customer message, and the risk system can leave a checkpoint. The payment path no longer has to wait for every downstream side effect.

### 4.5.1 Payment settled to fulfillment requested

The simplest handoff looks like this.

```typescript
@EventPattern('payment.settled')
async onPaymentSettled(event: { orderId: string; warehouseId: string }) {
  // Logic that prepares the warehouse picking wave
  await this.fulfillmentPlanner.enqueuePickWave(event.orderId, event.warehouseId);
}
```

What doesn't change here is important. The handler is still a simple Provider method, the transport owns queue frames, and the domain service owns business decisions.

This is the fluo pattern repeated throughout the book. Even when "wiring" changes from TCP sockets to RabbitMQ queues, `@EventPattern` lets developers focus on side-effect logic.

### 4.5.2 Dead-letter and redrive policy

The transport intentionally focuses on frame routing. Queue declaration policy belongs to the caller-owned RabbitMQ setup. That means the dead-letter exchange, TTL, maximum redelivery count, and redrive tooling must be defined with the application's `amqplib` channel setup. In FluoShop, warehouse events are a good place for exactly that policy. If `pickwave.created` repeatedly fails, operators should be able to isolate the poison message while preserving the original order context. This is the "poison pill" safety net. Instead of stopping consumers or losing the message, RabbitMQ can move the message to a **Dead Letter Exchange (DLX)** after N failures so operators can inspect and fix it manually later. The more explicit these recovery mechanisms are, the more RabbitMQ's strengths show.

## 4.6 Delivery safety and operations

The repository tests document several behaviors that should become operational guidance.

- `send()` must be called after `listen()` so the response queue is guaranteed to exist.
- timeout clearly rejects the caller with a detailed error string.
- Concurrent requests are safely correlated through `requestId` UUIDs.
- Instance-scoped response queues prevent reply theft.

This gives FluoShop a stable mental model. RabbitMQ isn't magical durability, and it becomes sufficiently safe durability only when topology, retries, and queue ownership are responsibly defined. fluo uses **JSON serialization** for transport frames, so compatibility is strong. Even a legacy Java service can send messages to FluoShop's RabbitMQ queues as long as it follows the `RabbitMqTransportMessage` schema.

### 4.6.1 Operational signals to watch

For fulfillment queues, the team should watch these metrics.

- **Ready message count**: The number of backlog tasks waiting to be processed.
- **Unacked or in-flight work**: The number of messages currently being processed by workers.
- **Whether redelivery increases after deployment**: The number of messages returned to the queue because of worker crashes or timeouts.
- **Per-instance response queue churn**: How often unique response queues are created and deleted.
- **Dead-letter queue growth**: The number of failed business processes.

These metrics tell different stories. If ready count rises, worker shortage is the likely cause. If redelivery count rises, handler stability may be dropping. If response queue churn is too fast, it may signal that instances are restarting too often.

### 4.6.2 FluoShop rollout plan

In v1.3.0, only the fulfillment handoff moves to RabbitMQ. The rest of FluoShop intentionally stays mixed.

- API reads can stay on TCP for the lowest latency.
- Payment durability can stay on Redis Streams for append-only log safety.
- Only warehouse work moves to RabbitMQ queues for task-based ownership.

This hybrid state is healthy. Architectures usually evolve one boundary at a time. The practical lesson is to move the link that benefits most from a queue-owned operational model first. You don't need to move every transport at once for symmetry. Symmetry is a developer preference. Stability is a business requirement.

## 4.7 Summary

- RabbitMQ fits queue-oriented ownership better than direct request paths.
- fluo keeps RabbitMQ bootstrap explicit through caller-owned publisher and consumer collaborators.
- request/reply flows remain available through `requestId` and `replyTo` correlation.
- Instance-scoped response queues are the safe default for concurrently running service instances.
- FluoShop now routes post-payment fulfillment work through RabbitMQ, giving warehouse operations a clearer queue model.

At this point, FluoShop has three different communication styles. TCP handles simple direct lookups, Redis Streams protects money-related durability, and RabbitMQ owns warehouse queues where work assignment matters more than stream replay.

This transport diversity isn't confusion. It's a strength. It proves that one framework can unify different operational requirements under a consistent programming interface.
