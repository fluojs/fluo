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
- Only singleton-scoped handlers are registered.
- `@MessagePattern` matches a single handler and returns its value to the caller.
- If multiple `@MessagePattern` handlers match the same pattern, dispatch fails explicitly instead of picking a match silently.
- `@EventPattern` dispatches to all matching handlers.
- Patterns support exact string or `RegExp` matching.
- Transport lifecycle is managed through application startup and shutdown.

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
