# @fluojs/microservices

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Transport-driven microservices for fluo. Build scalable, message-driven architectures with deep DI integration and support for multiple transport protocols including TCP, Redis, NATS, Kafka, RabbitMQ, and gRPC.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Core Capabilities](#core-capabilities)
- [Public API Overview](#public-api-overview)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
pnpm add @fluojs/microservices
```

Optional transport-specific dependencies:

- Package-managed optional peers loaded by `@fluojs/microservices`: `@grpc/grpc-js`, `@grpc/proto-loader`, `ioredis`, `mqtt`
- Caller-owned broker clients passed explicitly to transports: `nats`, `kafkajs`, `amqplib`

## When to Use

- When building a **Distributed System** where services communicate via messages or events.
- When you need a **Unified Programming Model** across different transport protocols (TCP, NATS, Kafka, etc.).
- When you require **Request-Response** or **Event-Driven** patterns between isolated services.
- When integrating with specialized protocols like **gRPC** (including streaming support).

## Quick Start

Define a message handler and bootstrap the microservice using the TCP transport.

```typescript
import { Module } from '@fluojs/core';
import { fluoFactory } from '@fluojs/runtime';
import { MicroservicesModule, MessagePattern, TcpMicroserviceTransport } from '@fluojs/microservices';

class MathHandler {
  @MessagePattern('math.sum')
  sum(data: { a: number; b: number }) {
    return data.a + data.b;
  }
}

@Module({
  imports: [
    MicroservicesModule.forRoot({
      transport: new TcpMicroserviceTransport({ port: 4000 })
    })
  ],
  providers: [MathHandler]
})
class AppModule {}

const microservice = await fluoFactory.createMicroservice(AppModule);
await microservice.listen();
```

`fluo new` treats NATS, Kafka, and RabbitMQ as explicit caller-owned bootstrap contracts rather than hidden built-ins. The generated starters wire `nats` + `JSONCodec()`, `kafkajs` producer/consumer collaborators, and `amqplib` publisher/consumer collaborators in `src/app.ts`, while still making the external broker dependency visible through `.env` and the generated README. Those packages are not loaded from `@fluojs/microservices` itself and therefore are not declared as package peers here.

## Core Capabilities

### Multi-Transport Support
Write your business logic once and deploy it across various transports. Supports TCP, Redis (Pub/Sub and Streams), NATS, Kafka, RabbitMQ, MQTT, and gRPC.

### Pattern-Based Routing
Use `@MessagePattern` for request-response flows and `@EventPattern` for fire-and-forget event broadcasting. Patterns support string matching and regular expressions.

### Advanced gRPC Streaming
First-party support for all gRPC streaming modes: Server-side, Client-side, and Bidirectional streaming using `@ServerStreamPattern`, `@ClientStreamPattern`, and `@BidiStreamPattern`.

### Request-Scoped DI
Microservice handlers fully support fluo's DI scopes. Request-scoped providers are isolated per message or per event, ensuring safe state management in concurrent processing.

### Delivery Safety Defaults
- TCP frames are bounded to 1 MiB per newline-delimited message by default; oversized frames close the socket instead of growing the request buffer without limit.
- Redis Streams acknowledges request/event entries only after handler-side processing finishes. Failed events stay pending for broker-managed recovery instead of being acknowledged early.
- RabbitMQ request/reply uses an instance-scoped response queue by default. Pass `responseQueue` explicitly only when you intentionally own and coordinate a shared reply topology.

## Public API Overview

### Root barrel (`@fluojs/microservices`)

- `MicroservicesModule`, `createMicroservicesProviders`: module registration helpers.
- `MessagePattern`, `EventPattern`, `ServerStreamPattern`, `ClientStreamPattern`, `BidiStreamPattern`: routing and streaming decorators.
- `TcpMicroserviceTransport`, `RedisPubSubMicroserviceTransport`, `RedisStreamsMicroserviceTransport`, `NatsMicroserviceTransport`, `KafkaMicroserviceTransport`, `RabbitMqMicroserviceTransport`, `GrpcMicroserviceTransport`, `MqttMicroserviceTransport`: transport adapters exported from the root barrel.
- `MicroserviceLifecycleService`, `MICROSERVICE`: programmatic runtime access and compatibility token.
- `createMicroservicePlatformStatusSnapshot`, `ServerStreamWriter`: status and TypeScript contract helpers.

### Supported transport subpaths

- `@fluojs/microservices/tcp`
- `@fluojs/microservices/redis` (Redis Pub/Sub transport)
- `@fluojs/microservices/nats`
- `@fluojs/microservices/kafka`
- `@fluojs/microservices/rabbitmq`
- `@fluojs/microservices/grpc`
- `@fluojs/microservices/mqtt`

`RedisStreamsMicroserviceTransport` is currently supported from the root barrel only; there is no dedicated `@fluojs/microservices/redis-streams` export.

## Related Packages

- `@fluojs/core`: Core DI and module system.
- `@fluojs/runtime`: Microservice bootstrap and factory.
- `@fluojs/di`: Underlying dependency injection engine.

## Example Sources

- `packages/microservices/src/module.test.ts`: Integration tests for all transports.
- `packages/microservices/src/public-api.test.ts`: Root-barrel contract coverage.
- `packages/microservices/src/public-subpaths.test.ts`: Export-map coverage for documented transport subpaths.
- `examples/microservices-tcp`: Basic TCP microservice example.
- `examples/microservices-kafka`: Distributed Kafka-based architecture example.
