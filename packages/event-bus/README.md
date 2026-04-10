# @fluojs/event-bus

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

In-process event publishing and subscription for fluo. It features decorator-based handler discovery and support for external transport adapters like Redis Pub/Sub for cross-process communication.

## Table of Contents

- [Installation](#installation)
- [When to use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
- [Public API](#public-api)
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

```typescript
import { Module, Inject } from '@fluojs/core';
import { EventBusModule, EventBusLifecycleService } from '@fluojs/event-bus';

@Module({
  imports: [EventBusModule.forRoot()],
  providers: [NotificationService],
})
export class AppModule {}

export class UserService {
  @Inject(EventBusLifecycleService)
  private readonly eventBus: EventBusLifecycleService;

  async signUp(email: string) {
    // Logic to save user...
    await this.eventBus.publish(new UserSignedUpEvent(email));
  }
}
```

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

## Public API Overview

### Core
- `EventBusModule`: Main entry point for event bus registration.
- `EventBusLifecycleService`: Primary service for publishing events (`publish(event)`).
- `@OnEvent(EventClass)`: Decorator to mark a method as an event handler.

### Interfaces
- `EventBusTransport`: Contract for implementing external transport adapters.

## Related Packages

- `@fluojs/cqrs`: Built on top of the event bus for more formal architectural patterns.
- `@fluojs/redis`: Provides the clients required for `RedisEventBusTransport`.

## Example Sources

- `packages/event-bus/src/module.test.ts`: Handler discovery and publish/subscribe tests.
- `packages/event-bus/src/public-surface.test.ts`: Public API contract verification.
