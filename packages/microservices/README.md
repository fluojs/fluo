# @konekti/microservices

<p><strong><kbd>English</kbd></strong></p>

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

## Runtime behavior

- handlers are discovered from providers/controllers in compiled modules
- only singleton-scoped handlers are registered
- `@MessagePattern` matches one handler and returns its value to the caller
- `@EventPattern` dispatches to all matching handlers
- pattern supports exact string or `RegExp` matching
- transport lifecycle is managed through app startup/shutdown

## Transport notes

- `TcpMicroserviceTransport` supports both `send()` (request/reply) and `emit()` (event).
- `RedisPubSubMicroserviceTransport` supports `emit()` fan-out only. Use TCP transport for request/reply `send()` semantics.

## Hybrid mode

Use runtime app bootstrap and resolve the microservice runtime from the same container:

```typescript
const app = await KonektiFactory.create(AppModule, { mode: 'prod' });
const microservice = await app.container.resolve(MICROSERVICE);

await Promise.all([app.listen(), microservice.listen()]);
```
