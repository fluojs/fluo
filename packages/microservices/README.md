# @konekti/microservices

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Transport-driven microservice message consumers for Konekti with decorator-based handler discovery.

## Installation

```bash
npm install @konekti/microservices
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

const microservice = await KonektiFactory.createMicroservice(AppModule, { mode: 'prod' });
await microservice.listen();
```

## API

- `createMicroservicesModule(options)` - registers global `MICROSERVICE` lifecycle service
- `createMicroservicesProviders(options)` - returns raw providers for manual composition
- `MICROSERVICE` - DI token for the runtime microservice service
- `@MessagePattern(pattern)` - request/reply handler registration
- `@EventPattern(pattern)` - event handler registration
- `TcpMicroserviceTransport` - TCP transport adapter
- `RedisPubSubMicroserviceTransport` - Redis pub/sub event transport adapter
- `NatsMicroserviceTransport` - NATS transport adapter (request/reply + event)
- `KafkaMicroserviceTransport` - Kafka transport adapter (event, inbound message dispatch)
- `RabbitMqMicroserviceTransport` - RabbitMQ transport adapter (event, inbound message dispatch)

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
- `RedisPubSubMicroserviceTransport` supports `emit()` fan-out only. Use TCP transport for request/reply `send()` semantics.
- `NatsMicroserviceTransport` supports both `send()` and `emit()` via NATS request/reply and pub/sub subjects.
- `KafkaMicroserviceTransport` and `RabbitMqMicroserviceTransport` are event-only transports: they support `emit()` plus inbound event dispatch. For request/reply `send()`, use TCP or NATS transport.

### Kafka

- `KafkaMicroserviceTransport` is event-only in the current adapter contract. `send()` always rejects, so request/reply flows should use TCP or NATS instead.
- Inbound handler failures are isolated at the transport boundary and do not round-trip back to the caller of `emit()`.
- Ordering, offset commit policy, consumer group recovery, and broker-specific reconnect semantics are not guaranteed by Konekti itself; treat them as broker/client concerns unless a future guide says otherwise.

### RabbitMQ

- `RabbitMqMicroserviceTransport` is event-only in the current adapter contract. `send()` always rejects, so request/reply flows should use TCP or NATS instead.
- Inbound handler failures are isolated at the transport boundary and do not round-trip back to the caller of `emit()`.
- Ack/nack, requeue, dead-letter, and channel recovery policies are not configured by this adapter today. Treat them as broker/client concerns unless a future guide says otherwise.

### NATS

- `NatsMicroserviceTransport` supports both `send()` and `emit()` by using separate request/reply and event subjects.
- `send()` applies `requestTimeoutMs` and only propagates handler failures that the transport can serialize back as an error message.
- Reconnect behavior, buffering, and responder availability remain client/server concerns; if request/reply guarantees matter operationally, validate them against your chosen NATS client/runtime setup.

## Hybrid mode

Use runtime app bootstrap and resolve the microservice runtime from the same container:

```typescript
const app = await KonektiFactory.create(AppModule, { mode: 'prod' });
const microservice = await app.container.resolve(MICROSERVICE);

await Promise.all([app.listen(), microservice.listen()]);
```

The app and microservice runtime resolve handlers from the same container in this composition, so singleton providers are shared across HTTP and microservice flows.
