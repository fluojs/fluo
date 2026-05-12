# @fluojs/event-bus

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

In-process event publishing and subscription for fluo. It features decorator-based handler discovery and support for external transport adapters like Redis Pub/Sub for cross-process communication.

## Table of Contents

- [Installation](#installation)
- [When to use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
- [Public API](#public-api)
- [Runtime-Specific and Integration Subpaths](#runtime-specific-and-integration-subpaths)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @fluojs/event-bus
```

## When to Use

- When you need to decouple components by communicating via events instead of direct service calls.
- When multiple parts of the system need to react to a single action (e.g., sending an email and updating a dashboard when a user registers).
- When you need a simple in-memory event bus with optional support for distributed systems.

## Quick Start

### 1. Define an Event and Handler

Create an event class and a handler method decorated with `@OnEvent`.

```typescript
import { OnEvent } from '@fluojs/event-bus';

export class UserSignedUpEvent {
  constructor(public readonly email: string) {}
}

export class NotificationService {
  @OnEvent(UserSignedUpEvent)
  async notify(event: UserSignedUpEvent) {
    console.log(`Sending welcome email to: ${event.email}`);
  }
}
```

### 2. Register and Publish

Import `EventBusModule` and inject `EventBusLifecycleService` to publish events.

Use `EventBusModule.forRoot(...)` to wire the in-process event bus.

```typescript
import { Module, Inject } from '@fluojs/core';
import { EventBusModule, EventBusLifecycleService } from '@fluojs/event-bus';

@Inject(EventBusLifecycleService)
export class UserService {
  constructor(private readonly eventBus: EventBusLifecycleService) {}

  async signUp(email: string) {
    // Logic to save user...
    await this.eventBus.publish(new UserSignedUpEvent(email));
  }
}

@Module({
  imports: [EventBusModule.forRoot()],
  providers: [NotificationService, UserService],
})
export class AppModule {}
```

`publish(event, options?)` supports `signal`, `timeoutMs`, and `waitForHandlers`. `waitForHandlers` defaults to `true`; awaited local handlers and awaited transport publishes share the same timeout and cancellation bounds. When `waitForHandlers` is set to `false`, publishing returns immediately and skips timeout bounds. During shutdown, the event bus drains in-flight awaited publish work before closing the transport and ignores new publish calls after the lifecycle has started stopping. Shutdown drain is bounded by `EventBusModule.forRoot({ shutdown: { drainTimeoutMs } })`, which defaults to 5000ms; if active publish work is still stuck after the bound, the bus records a degraded status diagnostic, logs a warning, and continues transport cleanup instead of hanging application close indefinitely.

## Common Patterns

### Distributed Fan-out (Redis)

Extend the event bus to other processes by plugging in a transport adapter.

```typescript
import { RedisEventBusTransport } from '@fluojs/event-bus/redis';

EventBusModule.forRoot({
  transport: new RedisEventBusTransport({ 
    publishClient: redis, 
    subscribeClient: redisSubscriber 
  }),
})
```

### Versioned Event Keys

Use static `eventKey` to ensure stable channel names regardless of class minification or renames.

```typescript
class UserRegisteredEvent {
  static readonly eventKey = 'user.registered.v1';
}
```

Handlers are discovered from singleton providers and controllers across imported modules. Each handler receives an isolated cloned payload, and class inheritance is supported through `instanceof` matching.

## Public API Overview

### Core
- `EventBusModule.forRoot(...)`: Main entry point for event bus registration.
- `EventBusLifecycleService`: Primary service for publishing events (`publish(event, options?)`) and creating platform status snapshots.
- `@OnEvent(EventClass)`: Decorator to mark a method as an event handler.
- `EVENT_BUS`: Compatibility injection token for the publish facade.
- `createEventBusPlatformStatusSnapshot(...)`: Status snapshot helper used by diagnostics and health surfaces.

### Interfaces
- `EventBusTransport`: Contract for implementing external transport adapters.
- `EventBus`, `EventPublishOptions`, `EventBusModuleOptions`, `EventType`: Type-only contracts for publishing, defaults, transports, and stable event keys.
- `EventBusLifecycleState`, `EventBusStatusAdapterInput`, `EventBusPlatformStatusSnapshot`: Status snapshot contracts.

Transport bootstrap subscribes once per unique event channel. `eventKey` controls the transport channel name when present. Invalid JSON transport messages are ignored.

## Runtime-Specific and Integration Subpaths

| Concern | Subpath | Exports |
| --- | --- | --- |
| Redis Pub/Sub transport | `@fluojs/event-bus/redis` | `RedisEventBusTransport`, `RedisEventBusTransportOptions` |

`RedisEventBusTransport` stays on the explicit `@fluojs/event-bus/redis` subpath so the root `@fluojs/event-bus` entrypoint remains focused on module registration, local publishing, decorators, and type-only contracts. The transport unsubscribes the channels it registered and detaches its message listener during shutdown, but it does not disconnect caller-owned Redis clients.

## Related Packages

- `@fluojs/cqrs`: Built on top of the event bus for more formal architectural patterns.
- `@fluojs/redis`: Provides the clients required for `RedisEventBusTransport`.

## Example Sources

- `packages/event-bus/src/module.test.ts`: Handler discovery and publish/subscribe tests.
- `packages/event-bus/src/public-surface.test.ts`: Public API contract verification.
- `packages/event-bus/src/status.test.ts`: Status snapshot semantics.
- `packages/event-bus/src/transports/redis-transport.test.ts`: Redis transport behavior.
