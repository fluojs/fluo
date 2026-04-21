<!-- packages: @fluojs/microservices, @fluojs/redis -->
<!-- project-state: FluoShop v1.2.0 -->

# 3. Redis Transport

Redis is a versatile broker that supports multiple communication patterns.

In fluo, the Redis transport provides two distinct modes: **Pub/Sub** for lightweight, non-durable event broadcasting, and **Streams** for durable, at-least-once message and event delivery.

This chapter shows how Redis becomes the first real broker in **FluoShop** and why that changes the shape of the architecture.

TCP gave us a direct request path. Redis adds indirection. That indirection is not free, because it introduces more moving parts and more operational surface area. But it also unlocks decoupling, replay-friendly workflows, and better resilience for steps that should not disappear just because one service instance went down at the wrong moment.

## 3.1 Redis Pub/Sub for Events

Redis Pub/Sub is a high-performance fire-and-forget mechanism. It is ideal for scenarios where notification speed matters more than ensuring every subscriber receives the message. In other words, Pub/Sub is useful when events are informative rather than critical. If the Order Service emits an `inventory.updated` signal for a live stock-ticker UI, missing a single update is fine—the next one will arrive shortly and provide the correct state. If a subscriber is temporarily offline, the system accepts that some broadcasts may be missed, and that trade-off can be perfectly reasonable for live dashboards, transient analytics, or cache-warming signals. It is much less acceptable for billing, settlement, or order-state transitions.

### 3.1.1 Configuring Pub/Sub

To use Redis Pub/Sub, you provide a publisher client and a subscriber client to the `RedisPubSubMicroserviceTransport`.

```typescript
import { Module } from '@fluojs/core';
import { MicroservicesModule, RedisPubSubMicroserviceTransport } from '@fluojs/microservices';
import Redis from 'ioredis';

const redisClient = new Redis({ host: 'localhost', port: 6379 });

@Module({
  imports: [
    MicroservicesModule.forRoot({
      transport: new RedisPubSubMicroserviceTransport({
        publishClient: redisClient,
        subscribeClient: redisClient.duplicate(),
      }),
    }),
  ],
})
export class NotificationModule {}
```

Redis requires a dedicated connection for subscription mode. That is why the subscriber typically uses `duplicate()` instead of sharing the publishing client. Since Redis Pub/Sub does not support acknowledgments or replies, this transport is effectively restricted to `emit()` workflows. That limitation is helpful, not annoying, because it makes the semantic boundary obvious. If you need a durable request-response contract, you should not pretend Pub/Sub can provide it.

## 3.2 Redis Streams for Durable Delivery

For critical operations like order processing and payment coordination, durability is essential.

The `RedisStreamsMicroserviceTransport` uses Redis Streams and consumer groups to provide at-least-once delivery. In **FluoShop**, this is the transport of choice for the Order→Payment handoff. When an order is placed, we don't just want a fast answer; we want a guarantee that the Payment Service will eventually see that order, even if it's currently restarting.

That makes Streams a better fit when the business cares more about eventual completion than about immediate synchronous response time.

FluoShop reaches that point as soon as money enters the conversation.

An order intent that disappears silently is unacceptable.

A payment event that can be reclaimed and retried is far safer.

### 3.2.1 Consumer Groups and Acknowledgments

Unlike Pub/Sub, Redis Streams persists messages. A consumer group ensures each message is processed by at least one member of the group. If a consumer fails after receiving a message but before acknowledging it, the message remains in the Pending Entries List (PEL) and can be reclaimed.

```typescript
import { RedisStreamsMicroserviceTransport } from '@fluojs/microservices';

const transport = new RedisStreamsMicroserviceTransport({
  readerClient: redisClient,
  writerClient: redisClient,
  consumerGroup: 'payment-service-group',
});
```

fluo automatically acknowledges the stream entry only after the handler completes successfully. That timing is one of the most important safety properties in the transport. Internally, fluo calls `xack` only after the `await handler()` promise resolves. If your handler throws an error, the `xack` call never happens, and the message stays in the PEL. Early acknowledgment would reduce duplicate work but increase the risk of silent loss. Late acknowledgment accepts possible redelivery in exchange for recoverability, and if the Payment Service crashes mid-transaction, another instance in the `payment-service-group` can take over the pending message. That is usually the correct trade-off for business-critical workflows.

## 3.3 Request-Response over Streams

One of fluo's more advanced features is supporting request-response patterns over Redis Streams.

This allows you to use `send()` while still benefiting from durable delivery behavior.

The resulting system is slower and more operationally complex than raw TCP. In TCP, the socket is the return path. In Streams, we have to create a separate "response stream" to route the answer back. But it also survives conditions that TCP cannot handle well. If the consumer is delayed, the request can still be processed later, and if an instance crashes mid-flight, the message can remain pending and be reclaimed. This means a long-running payment validation (e.g., calling an external Stripe/PayPal API) can survive a service restart without the Gateway losing track of the request. That makes stream-backed request-response useful for workloads where completion matters more than strict immediacy.

### 3.3.1 Per-Consumer Response Streams

To avoid reply collisions, fluo creates a temporary response stream for each consumer instance.

That gives every requester a private return path for correlated replies, and the stream name follows the pattern `${namespace}:responses:${consumerId}`. Without that isolation, multiple service instances could interfere with each other's responses. Per-consumer response streams therefore preserve the familiar `send()` programming model while respecting the distributed nature of Redis Streams. This detail is easy to miss when reading only handler code, but it is also exactly the kind of transport-level concern that fluo is designed to encapsulate. The application code asks for a reply, and the transport decides how to route it safely. By default, fluo also cleans up these response streams during `close()` using `del`, ensuring we don't leak thousands of temporary keys in Redis.

## 3.4 Deep Dive into Delivery Safety

fluo's Redis transport implementation prioritizes safety through a few core principles.

- **Late Acknowledgment**: Stream entries are only acknowledged after handler-side processing finishes. If the service crashes during execution, the message stays pending for recovery.
- **Conservative Trimming**: By default, fluo disables `messageRetentionMaxLen` and `eventRetentionMaxLen`. While Redis supports trimming streams to a maximum length (e.g., `MAXLEN ~ 1000`), doing this at publish-time could delete a pending message that hasn't been processed yet. fluo prefers to let the stream grow until manual or policy-based cleanup occurs, ensuring no data is lost prematurely.
- **Bounded Response Retention**: Unlike requests, response streams have a default `responseRetentionMaxLen` of `1,000`. Since responses are usually consumed immediately by the waiting `send()` caller, we can safely bound their retention to prevent memory pressure.
- **Automatic Cleanup**: Temporary response streams used for request-reply flows are removed during `close()` so they do not pollute the Redis namespace forever.

These choices reveal the framework's stance on distributed failure. It prefers duplicate processing risk over silent message disappearance, and that preference is usually the right one, provided the application is designed with idempotency in mind. For FluoShop, payment handling must assume that a message can be seen more than once. That means order IDs, payment intents, and reconciliation logic should all be stable enough to absorb replay. If the Payment Service receives the same `order.placed` event twice, it should check if a transaction for that order ID already exists before attempting another charge. The transport helps, but the domain still carries responsibility.

## 3.5 Operational Considerations

Running Redis as a microservice transport is not just a coding concern. It is an operational commitment. Teams need to watch stream lengths, consumer lag, pending entry counts, and reclaim behavior. In Redis, you can use `XPENDING` to inspect messages that have been delivered but not yet acknowledged. If those metrics drift in the wrong direction, the transport may remain technically healthy while business latency quietly degrades. Useful operational questions include the following.

- Are stream keys growing without bound? (Check `XLEN`).
- Is one consumer group accumulating an unhealthy PEL? (Check `XPENDING`).
- Are reclaim attempts increasing after deploys?
- Are temporary response streams being cleaned up on shutdown?

fluo can expose the hooks needed for monitoring, but teams still need alerting and runbooks.

Redis is lightweight compared with many brokers.

It is not maintenance-free.

## 3.6 Choosing between Pub/Sub and Streams

The choice between Pub/Sub and Streams is not about which feature looks more impressive.

It is about whether the event must survive subscriber absence and process failure.

| Feature | Redis Pub/Sub | Redis Streams |
|---------|---------------|---------------|
| Durability | No | Yes |
| Delivery Guarantee | At most once | At least once |
| Patterns | Events only | Messages & Events |
| Complexity | Low | Medium |

A simple rule works well. Use Pub/Sub when missed messages are acceptable and low latency matters. Use Streams when the business expects recovery, replay, or shared consumer-group processing. In FluoShop, that means notifications or ephemeral analytics may fit Pub/Sub, but order placement and payment coordination belong on Streams.

## 3.7 FluoShop Implementation: Order and Payment

In FluoShop, we use Redis Streams for the critical link between the Order Service and the Payment Service.

1. **Order Service**: Emits an `order.placed` event via Redis Streams after validating the order request. It uses the `emit()` method on the stream-backed microservice client.
2. **Payment Service**: A member of the `payment-service-group` consumes the event, attempts the transaction, and emits `payment.success` or `payment.failed` based on the result.

This design changes the system in an important way. The Order Service no longer needs the Payment Service to be synchronously reachable at the exact moment the order is created. If the Payment Service is busy or down, the `order.placed` event simply waits in the Redis Stream. What matters is that the broker path preserves the work. That increases resilience at the cost of immediacy. The customer-facing flow must now communicate that some work is in progress rather than already final, so the Gateway might return a `202 Accepted` status with an order ID, and the client-side UI will poll or listen for a WebSocket notification of the final payment result. This is the first place in the intermediate book where FluoShop starts behaving like a genuinely asynchronous system. The Notification Service can later react to payment outcomes without becoming part of the critical order path, and that decoupling is the architectural win Redis introduces.

## 3.8 Summary

- **Pub/Sub**: Best for non-critical, high-throughput event broadcasting where fire-and-forget is acceptable.
- **Streams**: Essential for durable, reliable communication requiring at-least-once delivery and consumer-group scaling.
- **Consumer Groups**: Allow multiple service instances to share work and recover from failure via the Pending Entries List (PEL).
- **Durability**: Use Redis Streams for critical inter-service flows like orders and payments where loss is not an option.
- **Decoupling**: Unlike TCP, Redis allows services to interact without direct network connectivity, providing a buffer for bursts and downtime.
- **Progression**: In FluoShop, Redis Streams enables the transition from a synchronous request-response catalog lookup to an asynchronous, reliable order-to-payment workflow.

The deeper lesson is architectural.

Redis is not replacing TCP everywhere.

It is taking over the links where the business benefits from delayed completion, replay, and loose coupling.

Distributed systems improve when each connection uses the transport that matches its failure budget.

## 3.9 Next Part Preview

In the next part, we will explore brokers such as RabbitMQ and Kafka to handle more demanding messaging requirements.

Those transports build on the concepts introduced here.

By the time we reach them, FluoShop will already have one synchronous request path and one durable event path.

That contrast makes it much easier to evaluate when a heavier broker is justified and when it is unnecessary complexity.
