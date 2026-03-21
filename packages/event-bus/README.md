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

## Runtime behavior

- Handler discovery runs during application bootstrap using `COMPILED_MODULES`
- Handler instances are pre-resolved from `RUNTIME_CONTAINER` during bootstrap and reused on publish
- Events are matched by class using `instanceof`, so base-class handlers receive derived events
- Publishing dispatches to every matching local handler and, when a transport is configured, fans out to the transport in parallel
- When a transport is configured, the event bus subscribes to one channel per discovered event type on bootstrap; incoming messages are deserialized with `JSON.parse` and dispatched to matching local handlers
- The channel name for a given event type is the class constructor name (e.g. `UserRegisteredEvent`)
- Transport `close()` is called during `onApplicationShutdown`
- Timeout bounds apply only when waiting mode is enabled (`waitForHandlers: true`); non-blocking mode (`false`) dispatches without waiting
- Handler failures are isolated and logged through `ApplicationLogger`
- Request/transient scoped classes with `@OnEvent()` are ignored with a warning

## Non-goals

- no queueing, replay, wildcards, or ordering guarantees
- no imperative `subscribe()` or `unsubscribe()` API
- no durability or persistence (events lost on crash)
