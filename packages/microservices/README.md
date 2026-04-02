# @konekti/microservices

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Transport-driven microservice message consumers for Konekti with decorator-based handler discovery.

## Installation

```bash
npm install @konekti/microservices
```

Optional transport peers:

```bash
# gRPC transport
npm install @konekti/microservices @grpc/grpc-js @grpc/proto-loader

# MQTT transport
npm install @konekti/microservices mqtt
```

## Quick Start

```typescript
import { Module } from '@konekti/core';
import { KonektiFactory } from '@konekti/runtime';
import { createMicroservicesModule, MessagePattern, TcpMicroserviceTransport } from '@konekti/microservices';

class MathHandler {
  @MessagePattern('math.sum')
  sum(input: { a: number; b: number }) {
    return input.a + input.b;
  }
}

@Module({
  imports: [createMicroservicesModule({ transport: new TcpMicroserviceTransport({ port: 4001 }) })],
  providers: [MathHandler],
})
class AppModule {}

const microservice = await KonektiFactory.createMicroservice(AppModule);
await microservice.listen();
```

## API

- `createMicroservicesModule(options)` - registers global `MICROSERVICE` lifecycle service
- `createMicroservicesProviders(options)` - returns raw providers for manual composition
- `MICROSERVICE` - DI token for the runtime microservice service
- `@MessagePattern(pattern)` - request/reply handler registration
- `@EventPattern(pattern)` - event handler registration
- `@ServerStreamPattern(pattern)` - gRPC server-streaming handler registration
- `TcpMicroserviceTransport` - TCP transport adapter
- `RedisPubSubMicroserviceTransport` - Redis pub/sub event transport adapter
- `NatsMicroserviceTransport` - NATS transport adapter (request/reply + event)
- `KafkaMicroserviceTransport` - Kafka transport adapter (request/reply + event)
- `RabbitMqMicroserviceTransport` - RabbitMQ transport adapter (request/reply + event)
- `RedisStreamsMicroserviceTransport` - Redis Streams transport adapter (request/reply + event)
- `GrpcMicroserviceTransport` - gRPC transport adapter (unary request/reply + unary event convention + server streaming)
- `MqttMicroserviceTransport` - MQTT transport adapter (request/reply + event)

## Runtime behavior

- Handlers are discovered from providers and controllers in compiled modules.
- `@MessagePattern` matches a single handler and returns its value to the caller.
- `@MessagePattern` supports singleton, request, and transient handlers. Request/transient handlers run inside a per-message child DI scope that is disposed after the handler completes.
- If multiple `@MessagePattern` handlers match the same pattern, dispatch fails explicitly instead of picking a match silently.
- `@EventPattern` dispatches to all matching handlers.
- `@EventPattern` supports singleton, request, and transient handlers. Request/transient handlers run inside a per-event shared child DI scope that is disposed after all matching handlers complete.
- When multiple scoped handlers match the same event (fan-out), they share the same per-event scope instance, enabling shared context across handlers for that event.
- Different events receive isolated scopes, preventing state leakage between concurrent events.
- Patterns support exact string or `RegExp` matching.
- Transport lifecycle is managed through application startup and shutdown.

## Provider scopes in microservice handlers

- **Singleton** (default): one instance shared across all inbound messages and events.
- **Request**: each handler invocation gets a fresh child DI scope. For `@MessagePattern`, the scope is per-message. For `@EventPattern`, the scope is per-event and shared across all fan-out handlers for that event. The scope is disposed after the handler(s) complete.
- **Transient**: each handler invocation resolves a fresh instance graph from the same scope boundary. For `@MessagePattern`, the boundary is per-message. For `@EventPattern`, the boundary is per-event and shared across all fan-out handlers for that event.

When any scoped handler (request or transient) is used, all of its dependencies must also be request- or transient-scoped. The DI container throws `ScopeMismatchError` if a singleton depends on a request-scoped provider.

### Per-message scope (request-scoped `@MessagePattern`)

```typescript
import { Inject, Scope } from '@konekti/core';
import { MessagePattern } from '@konekti/microservices';

@Scope('request')
class CorrelationState {
  readonly id = crypto.randomUUID();
}

@Inject([CorrelationState])
@Scope('request')
class PaymentsHandler {
  constructor(private readonly state: CorrelationState) {}

  @MessagePattern('payments.capture')
  capture() {
    return { correlationId: this.state.id };
  }
}
```

### Per-event scope (request-scoped `@EventPattern`)

When multiple scoped handlers match the same event, they share a single per-event scope instance:

```typescript
import { Inject, Scope } from '@konekti/core';
import { EventPattern } from '@konekti/microservices';

@Scope('request')
class EventContext {
  readonly correlationId = crypto.randomUUID();
}

@Inject([EventContext])
@Scope('request')
class AuditHandler {
  constructor(private readonly ctx: EventContext) {}

  @EventPattern('order.placed')
  audit() {
    console.log(`Audit: ${this.ctx.correlationId}`);
  }
}

@Inject([EventContext])
@Scope('request')
class NotificationHandler {
  constructor(private readonly ctx: EventContext) {}

  @EventPattern('order.placed')
  notify() {
    console.log(`Notify: ${this.ctx.correlationId}`);
  }
}
```

In this example, `AuditHandler` and `NotificationHandler` receive the same `EventContext` instance when handling the same `order.placed` event. Different events get isolated context instances.

## Transport notes

- `TcpMicroserviceTransport` supports both `send()` (request/reply) and `emit()` (event).
- `RedisPubSubMicroserviceTransport` supports `emit()` (event) only. Request/reply `send()` is intentionally unsupported because Redis Pub/Sub does not provide safe single-consumer RPC semantics across instances.
- `NatsMicroserviceTransport` supports both `send()` and `emit()` via NATS request/reply and pub/sub subjects.
- `KafkaMicroserviceTransport` supports both `send()` (request/reply) and `emit()` (event) via dedicated message, response, and event topics with correlation-based reply routing.
- `RabbitMqMicroserviceTransport` supports both `send()` and `emit()` using request/reply correlation with dedicated message and response queues.
- `RedisStreamsMicroserviceTransport` supports both `send()` and `emit()` via Redis Streams with consumer groups for safe single-consumer request/reply and event fan-out.
- `GrpcMicroserviceTransport` supports unary `send()`, unary `emit()`, and server-streaming `serverStream()` by using `<Service>.<Method>` routing with metadata kind (`x-konekti-kind`) to distinguish message/event packets.
- `MqttMicroserviceTransport` supports `send()` and `emit()` with JSON-envelope correlation (`requestId`, `replyTopic`) and a per-instance reply topic.

### Kafka

- `KafkaMicroserviceTransport` supports both request/reply `send()` and event `emit()`.
- `send()` publishes `{ kind: 'message', pattern, payload, requestId, replyTopic }` to the configured message topic and waits for a correlated `{ kind: 'response', requestId, payload | error }` frame.
- Correlation identity is `requestId` (generated per call). Reply routing uses `replyTopic` (defaults to a per-instance topic at transport construction time).
- `send()` applies `requestTimeoutMs` (default 3 000 ms) and rejects on timeout, abort, transport close, or serialized remote handler error.
- `listen()` must run before `send()` so the response subscription is active.
- Inbound event handler failures are isolated at the transport boundary and do not round-trip back to the caller of `emit()`.
- Request/reply assumptions:
  - If you override `responseTopic` to a shared topic across instances, isolate consumption per instance (for example, dedicated consumer-group or topic strategy) to avoid unmatched response consumption.
  - Broker-level ordering, offset commit policy, consumer group recovery, and reconnect behavior remain broker/client concerns.
- When to use Kafka request/reply vs TCP/NATS:
  - Kafka request/reply is appropriate when you already operate Kafka and want request/reply semantics within Kafka-centric service topologies.
  - TCP/NATS remain the recommended path for lower-latency operationally simpler request/reply flows.
- Troubleshooting: repeated Kafka request timeouts usually indicate no active responder for the pattern, mismatched message/response topic configuration, or cross-instance response-topic/group contention.

### RabbitMQ

- `RabbitMqMicroserviceTransport` supports both `send()` and `emit()` using dedicated event (`eventQueue`), request (`messageQueue`), and response (`responseQueue`) queues.
- `send()` publishes `{ kind: 'message', pattern, payload, requestId, replyTo }` to `messageQueue` and waits for `{ kind: 'response', requestId, payload | error }` on `responseQueue`.
- Correlation is `requestId`-based. Unknown, late, or duplicate responses are ignored once a request is settled.
- `send()` applies `requestTimeoutMs` (default 3 000 ms). On timeout, abort, or transport close, pending request promises reject deterministically.
- Handler failures are serialized back as response `error` strings and rejected at the caller side.
- Lifecycle behavior: startup subscribes event/request/response queues; reconnect is supported by calling `listen()` again after `close()`; shutdown cancels queue consumers and rejects in-flight pending requests.
- Ack/nack, requeue, dead-letter, and broker-managed channel recovery remain broker/client concerns unless a future guide says otherwise.
- Troubleshooting: repeated RabbitMQ request timeouts usually mean no active responder on `messageQueue`, mismatched `responseQueue` names across services, or missing consumer resubscription after broker reconnect.

### NATS

- `NatsMicroserviceTransport` supports both `send()` and `emit()` by using separate request/reply and event subjects.
- `send()` applies `requestTimeoutMs` and only propagates handler failures that the transport can serialize back as an error message.
- `close()` rejects in-flight pending requests deterministically before returning control to the caller.
- Reconnect behavior, buffering, and responder availability remain client/server concerns; if request/reply guarantees matter operationally, validate them against your chosen NATS client/runtime setup.

### Redis

- `RedisPubSubMicroserviceTransport` is **event-only** in the public contract.
- `emit()` publishes event frames to the configured namespace event channel.
- `send()` intentionally throws immediately because Redis Pub/Sub does not provide safe single-consumer request/reply ownership across multiple subscribers.
- On `close()`, the transport removes its event subscription and message listener cleanly.
- If you need request/reply semantics with Redis, use `RedisStreamsMicroserviceTransport` instead. For other transports with request/reply support, see TCP, NATS, Kafka, or RabbitMQ.

### Redis Streams

- `RedisStreamsMicroserviceTransport` supports both request/reply `send()` and event `emit()` using Redis Streams with consumer groups.
- Unlike Redis Pub/Sub, Redis Streams provides safe single-consumer delivery per consumer group, making request/reply semantics reliable across multiple instances.
- Stream topology uses three streams per namespace:
  - `{namespace}:messages` — shared consumer group for load-balanced request handling across instances.
  - `{namespace}:events` — per-instance consumer group for event fan-out to all instances.
  - `{namespace}:responses:{consumerId}` — per-instance stream for reply isolation.
- `send()` publishes `{ kind: 'message', pattern, payload, requestId, replyStream }` to the message stream and waits for a correlated `{ kind: 'response', requestId, payload | error }` frame on the per-instance response stream.
- Correlation identity is `requestId` (generated per call). Reply routing uses `replyStream` (auto-derived from the transport's `consumerId`).
- `send()` applies `requestTimeoutMs` (default 3 000 ms) and rejects on timeout, abort, transport close, or serialized remote handler error.
- `listen()` must run before `send()` so the response consumer group is active.
- Inbound event handler failures are isolated at the transport boundary and do not round-trip back to the caller of `emit()`.
- The transport requires two `RedisStreamClientLike` clients: `readerClient` for blocking `XREADGROUP` poll loops and `writerClient` for `XADD` and group management. Sharing a single connection for both may cause head-of-line blocking depending on your Redis client library.
- Poll-based consumption: the transport owns internal poll loops (configurable via `pollBlockMs`, default 500 ms) that process entries from all three streams.
- On `close()`, the transport stops poll loops, destroys per-instance consumer groups (event and response groups), and rejects all pending requests. The shared message consumer group is intentionally preserved across shutdown/reconnect cycles.
- When to use Redis Streams vs Redis Pub/Sub:
  - Redis Streams: use when you need request/reply semantics or durable single-consumer message handling with Redis.
  - Redis Pub/Sub: use for fire-and-forget event broadcasting where all subscribers should receive every event.
- Troubleshooting: repeated Redis Streams request timeouts usually indicate no active responder consuming from the message stream, misconfigured namespace, or consumer group contention.

### gRPC

- `GrpcMicroserviceTransport` lazily loads `@grpc/grpc-js` and `@grpc/proto-loader` at runtime. These are optional peers and are only required when you use this transport.
- Pattern format is strictly `<Service>.<Method>` and must match proto service/method names under the configured `packageName`.
- `listen()` loads the proto package and registers unary handlers and server-streaming handlers for discovered services. Client-streaming and bidirectional-streaming methods are not registered. If startup fails during bind, partial startup is rolled back via server shutdown.
- Inbound packets use metadata key `x-konekti-kind` (`message` or `event`) to map into `TransportPacket.kind` without changing payload schemas.
- `send()` uses unary RPC request/reply, applies timeout via deadline, supports abort via call cancellation, and rejects deterministically on close.
- `emit()` is a Konekti convention implemented as best-effort unary call: response payload is discarded, transport-level call failures are still surfaced.
- `serverStream()` returns an `AsyncIterable<unknown>` that yields each message from the server. Supports abort via `AbortSignal`. The iterator's `return()` cancels the underlying gRPC call.

#### Server streaming

Server-streaming support allows a gRPC method to send a sequence of response messages for a single request. Use `@ServerStreamPattern` to register a server-streaming handler and `serverStream()` to consume the stream from the client side.

**Server-side handler:**

```typescript
import { Module } from '@konekti/core';
import { KonektiFactory } from '@konekti/runtime';
import {
  createMicroservicesModule,
  ServerStreamPattern,
  GrpcMicroserviceTransport,
} from '@konekti/microservices';
import type { ServerStreamWriter } from '@konekti/microservices';

class MetricsHandler {
  @ServerStreamPattern('Metrics.StreamCpuUsage')
  async streamCpu(payload: { intervalMs: number }, writer: ServerStreamWriter) {
    for (let i = 0; i < 5; i++) {
      writer.write({ cpu: Math.random() * 100, tick: i });
    }
    writer.end();
  }
}

const transport = new GrpcMicroserviceTransport({
  url: '0.0.0.0:50051',
  packageName: 'monitoring',
  protoPath: './monitoring.proto',
});

@Module({
  imports: [createMicroservicesModule({ transport })],
  providers: [MetricsHandler],
})
class ServerModule {}

const microservice = await KonektiFactory.createMicroservice(ServerModule);
await microservice.listen();
```

**Client-side consumption:**

```typescript
const transport = new GrpcMicroserviceTransport({
  url: 'localhost:50051',
  packageName: 'monitoring',
  protoPath: './monitoring.proto',
});
await transport.listen(async () => {});

for await (const message of transport.serverStream('Metrics.StreamCpuUsage', { intervalMs: 1000 })) {
  console.log('cpu sample:', message);
}
```

- The handler receives `(payload, writer)` where `writer` provides `write(data)`, `end()`, and `error(err)` methods.
- `serverStream()` requires the transport to be listening. It rejects if the transport is closed or not yet started.
- Client-streaming and bidirectional-streaming methods are deferred to a future release (see issue #620).

### MQTT

- `MqttMicroserviceTransport` lazily loads `mqtt` at runtime when it must create a client internally (`options.client` not provided).
- Transport contract uses a JSON envelope:
  `{ kind, pattern, payload, requestId?, replyTopic?, error? }`.
- `emit()` publishes event envelopes (fire-and-forget semantics).
- `send()` publishes message envelopes and waits for correlated response envelopes on a per-instance reply topic.
- Default reply topic is per-transport-instance: `konekti.microservices.responses.<uuid>` (or your configured namespace/topic override).
- Default QoS/retain behavior is conservative and configurable: request/reply QoS 1, event QoS 0, retain disabled unless explicitly enabled.
- Correlation correctness in v1 relies on the JSON envelope (`requestId` + `replyTopic`), not MQTT v5 response-topic/correlationData properties.
- Lifecycle guarantees:
  - `listen()` has reentrancy guards and rolls back already-subscribed topics if a later subscription fails.
  - `close()` always rejects pending requests deterministically.
  - If the transport created the MQTT client internally, `close()` ends it. If a client is provided, subscriptions/listeners are cleaned up but client ownership remains with the caller.

## Hybrid mode

Use runtime app bootstrap and resolve the microservice runtime from the same container:

```typescript
const app = await KonektiFactory.create(AppModule);
const microservice = await app.container.resolve(MICROSERVICE);

await Promise.all([app.listen(), microservice.listen()]);
```

The app and microservice runtime resolve handlers from the same container in this composition, so singleton providers are shared across HTTP and microservice flows.
