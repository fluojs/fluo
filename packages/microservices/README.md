# @fluojs/microservices

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Transport-driven microservices for fluo. Build scalable, message-driven architectures with deep DI integration and support for multiple transport protocols including TCP, Redis, NATS, Kafka, RabbitMQ, MQTT, and gRPC.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Core Capabilities](#core-capabilities)
- [Common Patterns](#common-patterns)
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

The gRPC transport requires `@grpc/grpc-js@^1.14.4` and `@grpc/proto-loader@^0.8.0`. Consumers using an older `@grpc/grpc-js` release must upgrade the peer and refresh their lockfile before adopting this major `@fluojs/microservices` release. A refreshed install must resolve the proto-loader chain to `protobufjs@7.6.5` or newer so its patched UTF-8 helper is included; the fluo transport API is unchanged.

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

### Transport Capability Matrix

Choose by behavior before choosing a starter. The table describes the guarantees that the fluo adapter itself exposes; broker retention, acknowledgements, retries, and topology remain caller configuration unless a row states otherwise. `Streaming` means the `serverStream()`, `clientStream()`, and `bidiStream()` APIs, not a broker data structure named “stream.”

| Transport | `send()` | `emit()` | Streaming | Durability | Resource ownership | Detail |
| --- | --- | --- | --- | --- | --- | --- |
| TCP | Yes — correlated response | Yes — frame write | No | None — no broker storage or replay | fluo owns the listener and active sockets | [TCP chapter](../../book/intermediate/ch02-tcp.md) |
| Redis Pub/Sub | **No — always rejects; event-only** | Yes — Redis publication | No | None — live subscribers only; no ACK or replay | Caller owns the publish/subscribe clients; the adapter only unsubscribes | [Redis chapter](../../book/intermediate/ch03-redis-transport.md) |
| Redis Streams | Yes — correlated response stream | Yes — `XADD` completion | No — Redis Streams is not RPC streaming | Built in — consumer groups, late `XACK`, and recoverable pending entries; opt-in trimming can weaken recovery | Caller owns reader/writer clients; the adapter manages its consumer-group and response-stream artifacts and conservatively retains a shared request group when ownership is uncertain | [Redis chapter](../../book/intermediate/ch03-redis-transport.md) |
| NATS | Yes — NATS request/reply | Yes — client publish | No | None in this adapter — no JetStream persistence or replay contract | Caller owns the client and codec; the adapter unsubscribes only | [NATS chapter](../../book/intermediate/ch06-nats.md) |
| Kafka | Yes — correlated response topic | Yes — producer publish | No | Broker/config dependent — topic retention, producer ACKs, consumer offsets, and retries belong to the caller-owned collaborators | Caller owns the producer and consumer; the adapter unsubscribes only | [Kafka chapter](../../book/intermediate/ch05-kafka.md) |
| RabbitMQ | Yes — correlated response queue | Yes — publisher publish | No | Topology/collaborator dependent — durable queues, confirms, ACK/retry, and DLX policy remain application-owned | Caller owns publisher, consumer, channel, and connection resources; the adapter cancels its consumers | [RabbitMQ chapter](../../book/intermediate/ch04-rabbitmq.md) |
| MQTT | Yes — correlated reply topic | Yes — client publish callback | No | QoS/retain dependent — retained messages are last-known values, not history, and fluo adds no handler-completion guarantee | fluo closes a URL-created client; a supplied client stays caller-owned | [MQTT chapter](../../book/intermediate/ch07-mqtt.md) |
| gRPC | Yes — unary response | Yes — remote unary acknowledgement | Server, client, and bidirectional | None — point-to-point RPC without broker persistence or replay | fluo closes cached outbound clients and a server it creates; a supplied server stays caller-owned | [gRPC chapter](../../book/intermediate/ch08-grpc.md) |

Redis Pub/Sub implements the common transport shape so it can be registered uniformly, but its `send()` method intentionally throws. Use [the package chooser](../../docs/reference/package-chooser.md#build-a-microservice-starter) for generated starter availability or [the book transport chooser](../../book/intermediate/ch01-microservices-intro.md#123-transport-capability-chooser) for a learning-path decision.

The capability claims above are grounded in the public [transport type](./src/types.ts) and the implementations for [TCP](./src/transports/tcp-transport.ts), [Redis Pub/Sub](./src/transports/redis-transport.ts), [Redis Streams](./src/transports/redis-streams-transport.ts), [NATS](./src/transports/nats-transport.ts), [Kafka](./src/transports/kafka-transport.ts), [RabbitMQ](./src/transports/rabbitmq-transport.ts), [MQTT](./src/transports/mqtt-transport.ts), and [gRPC](./src/transports/grpc-transport.ts).

### Pattern-Based Routing
Use `@MessagePattern` for request-response flows and `@EventPattern` for fire-and-forget event broadcasting. Patterns support string matching and regular expressions.

### Handler Discovery and Decorator Model

`@MessagePattern`, `@EventPattern`, and the streaming pattern decorators are TC39 standard method decorators. They write routing data through the standard decorator context; they do not consume `reflect-metadata`, `experimentalDecorators`, or `emitDecoratorMetadata` output.

A decorated method becomes discoverable only when its owning class is explicitly listed in a compiled module's `providers` or `controllers`. Discovery resolves that registered token as an instance and invokes the decorated public instance method. Private and static targets are rejected, while importing or decorating a class without module registration does not register a handler.

### Advanced gRPC Streaming
First-party support for all gRPC streaming modes: Server-side, Client-side, and Bidirectional streaming using `@ServerStreamPattern`, `@ClientStreamPattern`, and `@BidiStreamPattern`.

### Request-Scoped DI
Microservice handlers fully support fluo's DI scopes. Request-scoped providers are isolated per message or per event, ensuring safe state management in concurrent processing.

### Completion and Ownership Boundaries

Keep application registration and programmatic calls on the root facade: register the adapter with `MicroservicesModule.forRoot({ transport })`, then inject `MICROSERVICE` as a `Microservice`. `MICROSERVICE` is not the raw transport. Transport-specific imports such as `@fluojs/microservices/nats`, `@fluojs/microservices/kafka`, and `@fluojs/microservices/rabbitmq` expose the adapters while leaving module and facade ownership on the root package.

| Operation | Completion boundary |
| --- | --- |
| `await microservice.send(...)` | Settles when the transport returns the correlated remote response, or rejects for a remote error, abort, timeout, or shutdown. |
| `await microservice.emit(...)` | Settles when the transport's publish operation accepts/completes the outbound event. It does not wait for remote event handlers or add delivery/redelivery guarantees beyond the collaborator's publish contract. |
| `await microservice.close()` | Waits for transport-owned listener/subscription teardown and pending-request cleanup. For caller-owned NATS, Kafka, and RabbitMQ collaborators, it does not close or disconnect the supplied broker resources. |

Kafka and RabbitMQ keep each inbound consumer callback pending until the matched handler and any request response publication settle. That consumer-side completion boundary lets a broker adapter decide whether to acknowledge or retry delivery, but it does not turn the producer-side `emit()` promise into an end-to-end handler completion signal. During application shutdown, close the `Microservice` facade first so it can detach transport callbacks, then close or drain caller-owned clients, producers, consumers, publishers, channels, and connections from the application bootstrap layer.

### Delivery Safety Defaults
- TCP frames are bounded to 1 MiB per newline-delimited message by default; oversized frames close the socket instead of growing the request buffer without limit.
- Redis Streams acknowledges request/event entries only after handler-side processing finishes. Failed events stay pending for broker-managed recovery instead of being acknowledged early.
- Kafka and RabbitMQ keep consumer delivery completion pending until inbound event/request handling and response publication settle. Event-handler and response-publish failures reject the consumer callback so broker adapters can withhold acknowledgement or retry; request-handler errors still round-trip as error responses when that response can be published.
- Redis Streams does not apply publish-time trimming to live request/event streams by default, so pending entries remain recoverable until `xack` or consumer-group recovery completes. Acked request/reply entries are cleaned up, each per-consumer response stream keeps bounded retention by default (`responseRetentionMaxLen: 1_000`), and each response stream is deleted during `close()`.
- Redis Streams always deletes each per-consumer response stream during `close()`, but it retains the shared request consumer group conservatively once ownership cannot be proven across the active fleet. Lease-capable listeners clean up only their coordination metadata, and mixed or fallback listener fleets keep the shared request group in place so one peer cannot destroy a group that another live listener still needs.
- `messageRetentionMaxLen` and `eventRetentionMaxLen` remain available as advanced opt-in knobs. Enabling them can trade away broker-managed recovery guarantees because Redis may trim pending live-stream entries before they are acknowledged.
- RabbitMQ request/reply uses an instance-scoped response queue by default. Pass `responseQueue` explicitly only when you intentionally own and coordinate a shared reply topology.
- Caller-owned broker collaborators stay caller-owned during shutdown. NATS, Kafka, and RabbitMQ transports detach their subscriptions/consumers and reject in-flight requests, but they do not close or disconnect the client, producer, consumer, publisher, or external connection objects supplied by the application.
- If NATS subscription setup fails during `listen()`, the transport unsubscribes subscriptions created by that attempt in reverse setup order while leaving the caller-owned NATS client open.
- Request-response transports that accept `AbortSignal` reject already-aborted sends before publishing, re-check cancellation immediately before deferred broker/RPC dispatch, and reject in-flight sends on later abort. Once `close()` starts, a terminal ingress gate on the programmatic `Microservice` facade and runtime shell rejects new `send()`/`emit()` calls before transport handoff, including while `listen()` is still pending; transport adapters retain their own shutdown guards, and concurrent `listen()` calls cannot reset a shutdown that is still in progress.
- The programmatic `Microservice` facade accepts `close(signal?: string)` so runtime shutdown hooks can report the signal that initiated shutdown. `MicroserviceLifecycleService.close(signal)` preserves that lifecycle-compatible facade contract while continuing to call the configured transport's current `close(): Promise<void>` contract; individual transports remain no-argument shutdown adapters unless their own documentation explicitly says they consume a shutdown signal.
- Importing the root `@fluojs/microservices` barrel and constructing `TcpMicroserviceTransport` do not load `node:net`; TCP loads Node networking only when `listen()` starts a server or an outbound `send()`/`emit()` constructs a socket. If startup fails while `close()` is waiting on an in-flight listen attempt, microservice shutdown still attempts transport cleanup before surfacing the captured listen error.
- TCP accepts `port: 0` for tests and ephemeral listeners, then routes outbound `send()`/`emit()` calls through the OS-assigned port while the transport is listening.
- Platform status snapshots report transport resource ownership: TCP and internally-created gRPC servers report framework-owned listener/client resources, MQTT reports framework ownership only when it creates the client, caller-supplied gRPC servers report caller ownership, and caller-owned broker collaborator transports remain externally managed.
- gRPC shutdown uses server-level `tryShutdown()` when the transport created the server, and falls back to `forceShutdown()` only for runtimes without graceful shutdown support. Caller-supplied `GrpcMicroserviceTransportOptions.server` instances remain caller-owned during `close()`; fluo closes cached outbound clients but does not shut down that server. AbortSignal cancellation for active unary or streaming calls uses the call-level `cancel()`/stream end path. fluo removes each `AbortSignal` abort listener after a unary call settles and when a streaming call ends or errors, including terminal events before reader iteration starts, or when its reader returns early. Cleanup runs only once when terminal, cancellation, and iterator-return paths overlap.
- MQTT closes internally-created clients when subscription setup fails during `listen()` or when `close()` unwinds a failed in-flight listen attempt, while preserving the original startup error for callers. Caller-supplied MQTT clients remain caller-owned.
- Event-handler failures that flow through the transport logger (`RedisPubSubMicroserviceTransport`, `RedisStreamsMicroserviceTransport`, `NatsMicroserviceTransport`, `MqttMicroserviceTransport`, and gRPC event emits) remain logger-driven. If you do not inject a transport logger, fluo does not mirror those failures through a raw `console.error` fallback.

## Common Patterns

### Custom module registration

Use `MicroservicesModule.forRoot({ transport, module: { ... } })` when you want custom providers, exports, or non-global registration without dropping back to raw provider arrays.

```typescript
import { Module } from '@fluojs/core';
import { MicroservicesModule, MicroserviceLifecycleService, MICROSERVICE } from '@fluojs/microservices';

const EXTRA_MICROSERVICE_EXPORT = Symbol('extra-microservice-export');

@Module({
  imports: [
    MicroservicesModule.forRoot({
      transport: customTransport,
      module: {
        global: false,
        providers: [{ provide: EXTRA_MICROSERVICE_EXPORT, useValue: 'custom-module-value' }],
        additionalExports: [EXTRA_MICROSERVICE_EXPORT],
      },
    }),
  ],
})
class FeatureModule {}
```

Behavioral contract notes:

- The module path still installs the same built-in `MICROSERVICE_OPTIONS`, `MicroserviceLifecycleService`, and `MICROSERVICE` wiring as the default `MicroservicesModule.forRoot(...)` call.
- Top-level `MicroservicesModule.forRoot({ global })` controls the built-in module visibility; `module.global` applies the same visibility choice when using the module customization object.
- `module.providers` appends extra providers after the built-in runtime wiring, while `module.additionalExports` extends the default exported tokens instead of replacing them.
- `module.global` lets advanced callers keep the registration local.

### Provider-array helper

Use `createMicroservicesProviders(...)` only when you need the low-level provider array itself for custom module assembly. Prefer `MicroservicesModule.forRoot({ transport, module: { ... } })` for custom providers, exports, or non-global registration because that path keeps the built-in lifecycle wiring and exported tokens intact.

```typescript
import { Module } from '@fluojs/core';
import { createMicroservicesProviders } from '@fluojs/microservices';

@Module({
  providers: [...createMicroservicesProviders({ transport: customTransport })],
})
class ManualMicroserviceProvidersModule {}
```

## Public API Overview

### Root barrel (`@fluojs/microservices`)

- `MicroservicesModule`, `createMicroservicesProviders`: module registration helpers.
- `MicroservicesModule.forRoot(...)`: Configures a transport plus optional module customization via `module: { global, providers, additionalExports }`.
- `createMicroservicesProviders(...)`: Builds provider arrays for custom module assembly.
- `MessagePattern`, `EventPattern`, `ServerStreamPattern`, `ClientStreamPattern`, `BidiStreamPattern`: routing and streaming decorators.
- `TcpMicroserviceTransport`, `RedisPubSubMicroserviceTransport`, `RedisStreamsMicroserviceTransport`, `NatsMicroserviceTransport`, `KafkaMicroserviceTransport`, `RabbitMqMicroserviceTransport`, `GrpcMicroserviceTransport`, `MqttMicroserviceTransport`: transport adapters exported from the root barrel.
- `MicroserviceLifecycleService`, `MICROSERVICE`: programmatic runtime access token and service.
- `createMicroservicePlatformStatusSnapshot`, `ServerStreamWriter`: status and TypeScript contract helpers.

### Programmatic runtime

`MicroserviceLifecycleService` exposes `listen()`, `close(signal?: string)`, `send()`, `emit()`, `serverStream()`, `clientStream()`, `bidiStream()`, and `createPlatformStatusSnapshot()` for programmatic runtime access. The `MICROSERVICE` token resolves to the same programmatic `Microservice` facade rather than the raw transport instance.

### Type exports

The root barrel exports `Microservice`, `MicroserviceLifecycleState`, `MicroserviceHandlerCounts`, `MicroserviceModuleOptions`, `MicroserviceModuleRegistrationOptions`, `MicroservicePlatformStatusSnapshot`, `MicroserviceStatusAdapterInput`, `MicroserviceTransport`, `MicroserviceTransportCapabilities`, `Pattern`, `ServerStreamWriter`, and transport option types such as `GrpcMicroserviceTransportOptions`, `KafkaMicroserviceTransportOptions`, `MqttMicroserviceTransportOptions`, `NatsMicroserviceTransportOptions`, `RabbitMqMicroserviceTransportOptions`, `RedisPubSubMicroserviceTransportOptions`, `RedisStreamsMicroserviceTransportOptions`, `RedisStreamClientLike`, and `TcpMicroserviceTransportOptions`.

### Behavioral contracts

Payloads are cloned before dispatch, concurrent `listen()` calls are deduped, request-scoped providers are disposed after success and failure, event fan-out shares one scope per event dispatch, and duplicate message matches fail deterministically.

### Supported transport subpaths

- `@fluojs/microservices/tcp`
- `@fluojs/microservices/redis` (Redis Pub/Sub transport)
- `@fluojs/microservices/nats`
- `@fluojs/microservices/kafka`
- `@fluojs/microservices/rabbitmq`
- `@fluojs/microservices/grpc`
- `@fluojs/microservices/mqtt`

`RedisStreamsMicroserviceTransport` is currently supported from the root barrel only; there is no dedicated `@fluojs/microservices/redis-streams` export.

Canonical transport learning material lives in the book chapters for [TCP](../../book/intermediate/ch02-tcp.md), [RabbitMQ](../../book/intermediate/ch04-rabbitmq.md), and [gRPC](../../book/intermediate/ch08-grpc.md), while this README remains the package-level behavioral contract reference.

## Related Packages

- `@fluojs/core`: Core DI and module system.
- `@fluojs/core/internal`: First-party package-integration seam used by this package for decorator metadata and clone helpers; it is not an application-facing import surface.
- `@fluojs/runtime`: Microservice bootstrap and factory.
- `@fluojs/di`: Underlying dependency injection engine.

## Example Sources

- `packages/microservices/src/module.test.ts`: Integration tests for all transports.
- `packages/microservices/src/public-api.test.ts`: Root-barrel export coverage, including module registration overrides and `createMicroservicesProviders(...)`.
- `packages/microservices/src/public-surface.test.ts`: Root-barrel snapshot coverage for the documented public surface.
- `packages/microservices/src/public-subpaths.test.ts`: Export-map coverage for documented transport subpaths.
- Runnable starter examples are generated with `fluo new --shape microservice --transport <transport> --runtime node --platform none` for the supported TCP, Redis Streams, NATS, Kafka, RabbitMQ, MQTT, and gRPC transport variants.
