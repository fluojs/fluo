<!-- packages: @fluojs/microservices, nats -->
<!-- project-state: FluoShop v1.5.0 -->

# Chapter 6. NATS

This chapter introduces NATS into FluoShop's fast internal coordination paths and clarifies the role of control-plane messaging, which differs from durable logs or work queues. Chapter 5 covered replayable shared history. Here, the focus moves to inventory and cache coordination, where low latency and subject-based routing matter.

## Learning Objectives
- Understand why NATS occupies a different architectural position from Kafka or RabbitMQ.
- Learn how to configure the NATS transport around a caller-owned client and codec.
- Explain how subject design and request timeouts affect fast internal coordination flows.
- Analyze how to apply NATS to inventory preview and cache invalidation scenarios.
- Define the boundaries of NATS usage through logger-driven failure handling and operational signals.

## Prerequisites
- Completion of Chapter 1, Chapter 2, Chapter 3, Chapter 4, and Chapter 5.
- Basic understanding of request-reply and event fan-out patterns.
- A basic sense for separating latency requirements from durability requirements in distributed systems.

## 6.1 Why NATS in FluoShop

Every transport chapter in this part addresses the same question. What intent does this transport make clearer in the architecture? For NATS, the answer is fast control-plane communication. FluoShop uses it for two capabilities.

1. **Fast request-reply checks**: Fast coordination between the Order and Inventory services before a customer confirms a purchase.
2. **Lightweight event fan-out**: Immediate delivery of cache and policy refresh signals across the full server fleet.

These interactions are important, but they are not durable business history, and they are not warehouse work queues. They are short internal coordination steps. With **subject-based routing** (for example, `fluoshop.inventory.*`), services can subscribe to specific data substreams and receive only the signals they need for local state coordination.

## 6.2 Caller-owned client and codec setup

The package README marks an important boundary. NATS is caller-owned. `@fluojs/microservices` expects the application to provide both the NATS client and the codec, and the generated starter mentioned in the README also uses `nats` and `JSONCodec()`.

This detail shows that fluo does not hide the actual NATS contract. NATS uses `Uint8Array` for payloads, so the `codec` bridge ensures that the framework's JSON-based frames are serialized and deserialized correctly during network transport.

### 6.2.1 Subject design

`NatsMicroserviceTransport` exposes the following core options.

- `client`
- `codec`
- `eventSubject`
- `messageSubject`
- `requestTimeoutMs`

The defaults use `fluo.microservices.events` and `fluo.microservices.messages`. In FluoShop, we use subject names that reveal domain intent.

- `fluoshop.inventory.events`
- `fluoshop.inventory.messages`

The transport still carries JSON-framed packets.

Subject names make intent easier to read when inspecting the broker. With a subject such as `fluoshop.inventory.messages`, operators can monitor all inventory-related traffic in a single terminal session through NATS wildcard subscriptions (for example, `fluoshop.inventory.>`).

### 6.2.2 Module wiring

```typescript
import { Module } from '@fluojs/core';
import { MicroservicesModule, NatsMicroserviceTransport } from '@fluojs/microservices';
import { JSONCodec, connect } from 'nats';

// NATS connection logic stays in the bootstrap/main file.
const client = await connect({ servers: process.env.NATS_URL });
const codec = JSONCodec();

const transport = new NatsMicroserviceTransport({
  client,
  codec: {
    encode(value) {
      return codec.encode(value);
    },
    decode(data) {
      return codec.decode(data) as string;
    },
  },
  eventSubject: 'fluoshop.inventory.events',
  messageSubject: 'fluoshop.inventory.messages',
  requestTimeoutMs: 1_500, // Aggressive timeout for fast coordination
});

@Module({
  imports: [MicroservicesModule.forRoot({ transport })],
  providers: [InventoryCoordinationHandler],
})
export class InventoryCoordinationModule {}
```

The exact codec wrapper implementation can vary by team. But the architectural point does not change. The application explicitly owns the NATS connection and codec choice.

## 6.3 Fast request-reply for inventory control

NATS naturally supports request-reply.

The fluo transport maps `send()` to `client.request(...)` with a timeout.

This lets the path behave as quickly as a direct call while preserving the microservices abstraction. Because NATS handles **Inbox** creation and reply-to correlation, developers do not need to manage the unique response topics we saw in the Kafka chapter themselves.

### 6.3.1 Inventory reservation lookups

In FluoShop, the Order Service sometimes needs a fast answer before checkout is confirmed. For example, it can ask the Inventory Service whether a flash-sale SKU still has reserve stock in a specific zone. This is not the final durable reservation. It is a fast coordination check, and NATS fits that case well.

```typescript
@MessagePattern('inventory.reserve-preview')
async previewReservation(input: { sku: string; zoneId: string; quantity: number }) {
  // Fast look-ahead check
  return await this.inventoryPolicy.preview(input);
}
```

The Order Service gets an answer within a short latency window. If a durable business record is needed later, another transport can own that step. NATS does not need to take on every responsibility.

### 6.3.2 Timeout budgets

The transport uses a 3-second request timeout by default, and you can override this value. In FluoShop, control-plane checks use a shorter budget. If the inventory preview does not arrive quickly, the gateway should degrade gracefully instead of stopping the customer journey for too long. For advisory lookups, failing fast is operationally better than a long, uncertain wait. In v1.5.0, `requestTimeoutMs` is set to 1,500ms so the user experience stays responsive even under high load.

## 6.4 Event fan-out and logger-driven failures

NATS also supports `emit()` for lightweight event delivery. This path fits cache invalidation or policy refresh notices well. For example, when Catalog updates a restricted-item rule, several services may need to refresh local read models, and that signal needs to be fast. Not every environment needs Kafka-level historical replay.

### 6.4.1 Cache invalidation in FluoShop

A representative example is invalidating the inventory read cache.

```typescript
@EventPattern('inventory.cache.invalidate')
async invalidateCache(event: { sku: string }) {
  // Immediately remove stale data from every service instance.
  await this.inventoryCache.evict(event.sku);
}
```

The handler is still simple. Subject routing and the NATS publish mechanism remain inside the transport. This consistency means teams do not need to relearn a new handler model every time the transport changes.

### 6.4.2 No console fallback for event failures

Repository tests verify a subtle but important behavior. Event handler failures are logger-driven, and if a transport logger is configured, errors are recorded through that path. If no logger is configured, fluo does not duplicate them through a raw `console.error` fallback. This behavior matters for production hygiene. It avoids duplicate noise and keeps the observability policy explicit.

In FluoShop, if the NATS event path is operationally important, the platform team must connect a structured logger. The transport uses the `logTransportEventHandlerFailure` utility so cache invalidation failures are recorded in service telemetry.

## 6.5 Operations and trade-offs

NATS looks simple because it really is simple in the way many teams want. That simplicity is a strength, but it is also a warning not to force it into roles that need richer durability or replay semantics. FluoShop uses NATS for fast coordination, not as the canonical timeline or the main queueing system.

From an operations perspective, teams should watch the following signals.

- **Timeout rates**: High timeout rates suggest the target service is overloaded.
- **Burst volume**: Sudden increases in fan-out volume can affect internal network latency.
- **Connection churn**: Frequent reconnections can indicate unstable NATS server configuration or network issues.
- **Handler error logs**: Monitor failed policy updates or cache evictions.

If these signals are stable, NATS remains a clear internal coordination layer. If the business starts requiring replay or long-term retention, another transport should take on that responsibility.

## 6.6 FluoShop v1.5.0 progression

By the end of this chapter, FluoShop has a fast control plane. The architecture's division of responsibility is also clearer.

- Kafka is for durable shared history.
- RabbitMQ is for queue-owned warehouse work.
- Redis Streams still handles some durable workflows.
- NATS is for low-latency internal coordination.

This is not overengineering. It is explicit role assignment. Systems become easier to read when each transport owns one primary responsibility.

## 6.7 Summary

- NATS fits low-latency control-plane messaging and lightweight event fan-out well.
- fluo expects a caller-owned NATS client and codec, keeping infrastructure wiring explicit.
- `send()` maps naturally to NATS request-reply for fast coordination checks.
- Event handler failures are handled in a logger-driven way and do not use a raw `console.error` fallback when no logger is present.
- FluoShop now uses NATS for inventory and cache coordination paths where speed matters more than replay.

NATS is not a tool that tries to win every transport contest. It is strong in one role: fast, understandable coordination. That is why FluoShop needs NATS. It fills a gap in the communication choices by adding a high-speed lane for internal signals.
