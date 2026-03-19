# @konekti/event-bus

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>


**In-process only.** In-process event publishing for Konekti applications with decorator-based handler discovery across singleton providers and controllers.

## Installation

```bash
npm install @konekti/event-bus
```

> **⚠️ Scope: In-process only.** This package dispatches events within a single Node.js process. It provides no durability guarantees, no persistence, no cross-process delivery, and no replay capability. If your application crashes mid-dispatch, in-flight events are lost. For durable, distributed event processing, use `@konekti/queue` backed by Redis.

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
- `EventBus` - interface with `publish(event)`
- `@OnEvent(EventClass)` - marks provider/controller methods as event handlers

## Runtime behavior

- Handler discovery runs during application bootstrap using `COMPILED_MODULES`
- Handler instances are resolved from `RUNTIME_CONTAINER` when events are published
- Events are matched by class using `instanceof`, so base-class handlers receive derived events
- Publishing dispatches to every matching handler and waits for completion without throwing handler errors
- Handler failures are isolated and logged through `ApplicationLogger`
- Request/transient scoped classes with `@OnEvent()` are ignored with a warning

## Non-goals

- no transport abstraction, queueing, replay, wildcards, or ordering guarantees
- no external pub/sub adapter integration
- no imperative `subscribe()` or `unsubscribe()` API
