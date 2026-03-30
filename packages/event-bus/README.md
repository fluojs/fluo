# @konekti/event-bus

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>


In-process event publishing for Konekti applications with decorator-based handler discovery across singleton providers and controllers. Supports optional external transport adapters (e.g. Redis Pub/Sub) for cross-process fan-out.

## Installation

```bash
npm install @konekti/event-bus
```

## Quick Start

```typescript
import { Inject, Module } from '@konekti/core';
import { createEventBusModule, EVENT_BUS, EventBus, OnEvent } from '@konekti/event-bus';

class UserRegisteredEvent {
  constructor(public readonly userId: string) {}
}

class WelcomeEmailService {
  @OnEvent(UserRegisteredEvent)
  async sendWelcomeEmail(event: UserRegisteredEvent) {
    // send email
  }
}

@Inject([EVENT_BUS])
class UserService {
  constructor(private readonly eventBus: EventBus) {}

  async registerUser(userId: string) {
    await this.eventBus.publish(new UserRegisteredEvent(userId));
  }
}

@Module({
  imports: [createEventBusModule()],
  providers: [WelcomeEmailService, UserService],
})
export class AppModule {}
```

## API

- `createEventBusModule()` - registers global `EVENT_BUS` and lifecycle discovery service
- `createEventBusProviders()` - returns raw providers for manual composition
- `EVENT_BUS` - DI token for the application event bus instance
- `EventBus` - interface with `publish(event, options?)`
- `EventBusTransport` - interface for external transport adapters
- `@OnEvent(EventClass)` - marks provider/controller methods as event handlers

### Module options

`createEventBusModule(options)` and `createEventBusProviders(options)` accept:

- `publish.timeoutMs` - per-handler wait bound used when `publish()` waits for handlers (`waitForHandlers: true`)
- `publish.waitForHandlers` - default waiting mode (`true` waits and applies timeout bounds, `false` dispatches fire-and-forget)
- `transport` - optional `EventBusTransport` adapter for cross-process fan-out

### Transport interface

```typescript
interface EventBusTransport {
  publish(channel: string, payload: unknown): Promise<void>;
  subscribe(channel: string, handler: (payload: unknown) => Promise<void>): Promise<void>;
  close(): Promise<void>;
}
```

Implement this interface to connect any external pub/sub system.

### Event key convention

Transport channels are resolved from event classes by the following rule:

1. If the event class defines `static eventKey = 'domain.event.v1'`, that string is used.
2. Otherwise, the fallback is the class constructor name (for backward compatibility).

For multi-process deployments, prefer explicit, versioned keys:

```typescript
class UserRegisteredEvent {
  static readonly eventKey = 'user.registered.v1';

  constructor(public readonly userId: string) {}
}
```

This avoids coupling transport contracts to class renames/minification and makes schema evolution explicit.

### Redis Pub/Sub adapter

```bash
npm install ioredis
```

```typescript
import Redis from 'ioredis';
import { createEventBusModule } from '@konekti/event-bus';
import { RedisEventBusTransport } from '@konekti/event-bus/redis';

const publishClient = new Redis();
const subscribeClient = new Redis();

@Module({
  imports: [
    createEventBusModule({
      transport: new RedisEventBusTransport({ publishClient, subscribeClient }),
    }),
  ],
})
export class AppModule {}
```

Two separate Redis clients are required because a client in subscribe mode cannot issue other commands.

`RedisEventBusTransport` does not own the lifecycle of injected Redis clients. On `close()`, it unsubscribes the channels it registered and detaches its message listener, but it does not call `quit()` or `disconnect()` on caller-provided clients.

## Runtime behavior

- Handler discovery runs during application bootstrap via `COMPILED_MODULES`.
- Handler instances are pre-resolved from `RUNTIME_CONTAINER` during bootstrap and reused on publish.
- Events are matched by class using `instanceof`, so base-class handlers receive derived events.
- Publishing dispatches to every matching local handler. When a transport is configured, it fans out to transport channels for all matched handler event types in parallel.
- When a transport is configured, the event bus subscribes to one channel per discovered event type on bootstrap. Incoming messages are deserialized with `JSON.parse` and dispatched to matching local handlers.
- Incoming transport messages are dispatched only to handlers registered for that subscribed channel, keeping local/remote inheritance matching outcomes consistent.
- The channel name for a given event type uses `eventType.eventKey` when present, otherwise falls back to the class constructor name.
- Transport `close()` is called during `onApplicationShutdown`.
- Timeout bounds apply only when waiting mode is enabled (`waitForHandlers: true`). Non-blocking mode (`false`) dispatches without waiting.
- Handler failures are isolated and logged through `ApplicationLogger`.
- Request/transient scoped classes with `@OnEvent()` are ignored with a warning.

## Non-goals

- No queueing, replay, wildcards, or ordering guarantees.
- No imperative `subscribe()` or `unsubscribe()` API.
- No durability or persistence (events are lost on crash).
