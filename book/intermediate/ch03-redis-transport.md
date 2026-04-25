<!-- packages: @fluojs/microservices, @fluojs/redis -->
<!-- project-state: FluoShop v1.2.0 -->

# Chapter 3. Redis Transport

This chapter introduces the first broker into FluoShop and explains how Redis Pub/Sub and Redis Streams provide different delivery semantics. Building on the direct TCP connection from Chapter 2, it lays out the criteria for moving flows that need resilience and loose coupling.

## Learning Objectives
- Understand the role differences between Redis Pub/Sub and Redis Streams.
- Learn the basic configuration of `RedisPubSubMicroserviceTransport` and `RedisStreamsMicroserviceTransport`.
- Analyze why consumer groups and delayed acknowledgment matter for durable delivery.
- Learn how to design request/response and event flows on Redis Streams.
- Explain why Redis fits the order and payment connection in FluoShop.

## Prerequisites
- Completion of Chapter 1 and Chapter 2.
- A basic understanding of broker-based messaging and event-driven communication.
- Basic knowledge of Redis data structures and connection patterns.

## 3.1 Redis Pub/Sub for Events

Redis Pub/Sub is a high-performance fire-and-forget mechanism. It fits cases where notification speed matters more than every subscriber receiving every message. Put another way, Pub/Sub works well when an event is important but not critical. For example, if the Order Service sends an `inventory.updated` signal for a real-time inventory dashboard UI, missing one update does not break the system. The next update will arrive soon and provide the accurate state. If a subscriber is offline for a moment, it may miss a few broadcasts, and the system accepts that tradeoff. This behavior is reasonable for real-time dashboards, transient analytics signals, and cache warming events. It is not appropriate for billing, settlement, or order state transitions.

### 3.1.1 Configuring Pub/Sub

To use Redis Pub/Sub, provide publisher and subscriber clients to `RedisPubSubMicroserviceTransport`.

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

Redis requires a dedicated connection for subscribe mode. For that reason, subscribers are usually separated with `duplicate()` instead of sharing the publisher client directly. Redis Pub/Sub does not support acknowledgments or response messages, so this transport is effectively suited to `emit()`-centered workflows. That constraint actually makes the semantic boundary clearer. If you need a durable request/response contract, you should not assume Pub/Sub can fill that role.

## 3.2 Redis Streams for Durable Delivery

Persistence is essential for important work such as order processing or payment coordination. `RedisStreamsMicroserviceTransport` uses Redis Streams and consumer groups to provide at-least-once delivery. In **FluoShop**, this is the right choice for the Order to Payment handoff. When an order is created, the requirement is not just a fast response. You need a guarantee that the Payment Service can eventually see that order, even if it is restarting. Streams are therefore a better fit when eventual completion matters more than immediate response time. FluoShop reaches exactly that point the moment money becomes involved. It is unacceptable for order intent to disappear silently. By contrast, it is much safer if payment events can be reclaimed and retried.

### 3.2.1 Consumer Groups and Acknowledgments

Unlike Pub/Sub, Redis Streams stores messages. A consumer group guarantees that each message is processed by at least one member of the group. If a consumer receives a message and fails before sending an acknowledgment, that message remains in the Pending Entries List (PEL), where another consumer can reclaim it.

```typescript
import { RedisStreamsMicroserviceTransport } from '@fluojs/microservices';

const transport = new RedisStreamsMicroserviceTransport({
  readerClient: redisClient,
  writerClient: redisClient,
  consumerGroup: 'payment-service-group',
});
```

fluo acknowledges a stream entry only after the handler completes successfully. This timing is one of the most important safety properties of this transport. Internally, fluo calls `xack` only after the `await handler()` promise resolves. If the handler throws an error, `xack` is not called and the message remains in the PEL. Acknowledging too early can reduce duplicate work, but it increases the risk of silent loss. Late acknowledgment accepts the possibility of redelivery in exchange for recoverability. If the payment service stops in the middle of a transaction, another instance in `payment-service-group` can take over and process the pending message. That is usually the right choice for business-critical workflows.

## 3.3 Request-Response over Streams

One of fluo's more advanced capabilities is support for the request/response pattern even on Redis Streams.

That lets you use `send()` while keeping durable delivery characteristics.

This kind of system is slower than raw TCP and has higher operational complexity. In TCP, the socket itself becomes the return path, but with Streams, the transport must create a separate "response stream" to send the response back. In return, it can tolerate situations TCP does not handle well. Even if a consumer is delayed, the request can be processed later, and if an instance stops during processing, the message remains pending and can be reclaimed. This means long-running payment verification work, such as calls to external APIs like Stripe or PayPal, can survive service restarts, and the Gateway does not lose the flow of the request. Stream-based request/response is therefore meaningful for work where completion guarantees matter more than immediacy.

### 3.3.1 Per-Consumer Response Streams

To avoid response collisions, fluo creates a temporary response stream for each consumer instance.

This gives every requester a dedicated, correlated return path, and stream names follow the `${namespace}:responses:${consumerId}` pattern. Without this isolation, multiple service instances could interfere with each other's responses. In other words, per-instance response streams let fluo keep the familiar `send()` programming model while respecting the distributed nature of Redis Streams. These details are easy to miss when you only read handler code, but this is exactly the type of transport-level concern fluo tries to encapsulate. Application code asks for a response, and the transport decides how to return it safely. By default, fluo uses `del` during `close()` to clean up these response streams, which prevents thousands of temporary keys from accumulating in Redis.

## 3.4 Deep Dive into Delivery Safety

fluo's Redis transport implementation prioritizes safety through several core principles.

- **Late Acknowledgment**: Stream entries are acknowledged only after handler-side processing finishes. If a service stops during execution, the message remains pending for recovery.
- **Conservative Trimming**: By default, fluo disables `messageRetentionMaxLen` and `eventRetentionMaxLen`. Redis supports trimming streams to a maximum length, such as `MAXLEN ~ 1000`, but applying that at publish time can delete pending messages that have not yet been processed. fluo lets streams grow until manual or policy-based cleanup happens so data is not lost too early.
- **Bounded Response Retention**: Unlike requests, response streams have a default `responseRetentionMaxLen` of `1,000`. Responses are usually consumed immediately by the waiting `send()` caller, so limiting retention is safe and helps prevent memory pressure.
- **Automatic Cleanup**: Temporary response streams used for request/response flows are removed during `close()` so they do not keep polluting the Redis namespace.

These choices show how the framework views distributed failure. fluo treats the risk of duplicate processing as a more acceptable cost than silent message loss. That judgment is usually correct when the application is designed with idempotency in mind. In FluoShop, payment processing must assume it can see the same message twice. Order IDs, payment intent, and settlement logic all need to be stable enough to absorb replay. If the payment service receives the same `order.placed` event twice, it must check whether a transaction already exists for that order ID before attempting payment again. The transport helps, but final responsibility still belongs to the domain.

## 3.5 Operational Considerations

Running Redis as a microservice transport is not just a coding problem. It is also an operational commitment. Teams must observe stream length, consumer lag, pending entry counts, and reclaim behavior. In Redis, the `XPENDING` command lets you inspect messages that were delivered but have not yet been acknowledged. If these metrics move in the wrong direction, the transport may look technically alive while business latency quietly gets worse. Useful operational questions include the following.

- Are stream keys growing without bound? Check `XLEN`.
- Is the PEL for a particular consumer group growing abnormally? Check `XPENDING`.
- Are reclaim attempts increasing after deploys?
- Are temporary response streams actually being cleaned up during shutdown?

fluo can provide the hooks needed for monitoring, but the team must prepare its own alerting system and runbooks. Redis is lighter than many brokers. That does not mean it needs no maintenance.

## 3.6 Choosing between Pub/Sub and Streams

Choosing between Pub/Sub and Streams is not about picking the feature that looks more impressive. It is about asking whether events must survive absent subscribers and process failures.

| Feature | Redis Pub/Sub | Redis Streams |
|---------|---------------|---------------|
| Durability | No | Yes |
| Delivery Guarantee | At most once | At least once |
| Patterns | Events only | Messages & Events |
| Complexity | Low | Medium |

One simple rule is enough. If it is acceptable to miss messages and low latency matters, use Pub/Sub. If you need recovery, replay, and consumer-group-based distributed processing, use Streams. In FluoShop, notifications or transient analytics events may fit Pub/Sub, but order creation and payment coordination belong on Streams.

## 3.7 FluoShop Implementation: Order and Payment

In FluoShop, Redis Streams is used for the critical connection between the Order Service and the Payment Service.

1. **Order Service**: After validating an order request, it publishes the `order.placed` event through Redis Streams. It uses the `emit()` method of the stream-based microservice client.
2. **Payment Service**: A member of `payment-service-group` consumes the event, attempts payment, and publishes `payment.success` or `payment.failed` depending on the result.

This design changes the system in an important way. The Order Service no longer requires the Payment Service to be synchronously alive at the exact moment an order is created. If the Payment Service is busy or down, the `order.placed` event waits in the Redis Stream, and the broker path preserves the work. Immediacy decreases, but resilience increases. The customer-facing flow must now communicate that something is in progress rather than claiming that the work has already finished. The Gateway returns `202 Accepted` with an order ID, and the client UI either polls for the final payment result or waits for a WebSocket notification. From this point on, the FluoShop built in the intermediate book starts behaving like a real asynchronous system. The Notification Service can later react to payment results without being placed directly in the core order path. That loose coupling is the architectural benefit Redis brings.

## 3.8 Summary

- **Pub/Sub**: Best for non-critical, high-throughput event broadcasts where fire-and-forget is acceptable.
- **Streams**: Essential for durable, reliable communication that needs at-least-once delivery and consumer group scaling.
- **Consumer Groups**: Let multiple service instances split work and recover from failure through the Pending Entries List (PEL).
- **Durability**: Use Redis Streams for critical service-to-service flows such as orders and payments, where loss is not acceptable.
- **Decoupling**: Unlike TCP, Redis allows services to interact without a direct network connection and provides a buffer against traffic spikes and downtime.
- **Progression**: In FluoShop, Redis Streams enables the move from synchronous request/response catalog lookup to an asynchronous, reliable order-payment workflow.

The deeper lesson is architectural. Redis does not replace TCP everywhere. Redis handles only the connections where the business benefits from delayed completion, replay, and loose coupling. Distributed systems improve when each connection uses a transport that matches its own failure budget.

## 3.9 Next Part Preview

In the next part, we will look at brokers such as RabbitMQ and Kafka to handle heavier messaging requirements. Those transports build on the concepts introduced here. By then, FluoShop will already have one synchronous request path and one durable event path. That contrast makes it easier to judge when a heavier broker is justified and when it is unnecessary complexity.
