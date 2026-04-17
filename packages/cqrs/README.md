# @fluojs/cqrs

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

CQRS primitives for fluo applications with bootstrap-time handler discovery, command/query dispatch, and event publishing delegation through `@fluojs/event-bus`.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
  - [Saga Process Managers](#saga-process-managers)
  - [Compatibility Tokens](#compatibility-tokens)
- [Public API Overview](#public-api-overview)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @fluojs/cqrs
```

## When to Use

- When you want to decouple the "intent" (Commands/Queries) from the "execution" (Handlers).
- When implementing complex business logic that requires clear separation between write models and read models.
- When orchestrating multi-step processes (Sagas) triggered by domain events.
- When you need a centralized bus for commands, queries, and events within a single application.

## Quick Start

Register the `CqrsModule` and define your first command and handler.

`CqrsModule.forRoot(...)` is the supported root entrypoint for wiring CQRS buses and handler discovery. Root-only consumers should treat low-level provider assembly as an internal implementation detail instead of part of the root-barrel API.

```typescript
import { Inject, Module } from '@fluojs/core';
import {
  CqrsModule,
  CommandHandler,
  ICommand,
  ICommandHandler,
  CommandBusLifecycleService,
} from '@fluojs/cqrs';

// 1. Define a Command
class CreateUserCommand implements ICommand {
  constructor(public readonly name: string) {}
}

// 2. Implement the Handler
@CommandHandler(CreateUserCommand)
class CreateUserHandler implements ICommandHandler<CreateUserCommand, string> {
  async execute(command: CreateUserCommand): Promise<string> {
    console.log(`Creating user: ${command.name}`);
    return 'user-id-123';
  }
}

// 3. Use the Command Bus
@Inject(CommandBusLifecycleService)
class UserService {
  constructor(private readonly commandBus: CommandBusLifecycleService) {}

  async create(name: string) {
    return this.commandBus.execute(new CreateUserCommand(name));
  }
}

@Module({
  imports: [CqrsModule.forRoot()],
  providers: [CreateUserHandler, UserService],
})
class AppModule {}
```

## Common Patterns

### Saga Process Managers

Sagas allow you to listen for events and trigger new commands, enabling complex long-running workflows.

```typescript
import { Inject } from '@fluojs/core';
import { Saga, ISaga, IEvent, ICommand, CommandBusLifecycleService } from '@fluojs/cqrs';

class UserCreatedEvent implements IEvent {
  constructor(public readonly userId: string) {}
}

class SendWelcomeEmailCommand implements ICommand {
  constructor(public readonly userId: string) {}
}

@Inject(CommandBusLifecycleService)
@Saga(UserCreatedEvent)
class UserSaga implements ISaga<UserCreatedEvent> {
  constructor(private readonly commandBus: CommandBusLifecycleService) {}

  async handle(event: UserCreatedEvent): Promise<void> {
    await this.commandBus.execute(new SendWelcomeEmailCommand(event.userId));
  }
}
```

Saga execution now fails fast with `SagaTopologyError` when an in-process publish chain re-enters the same saga route cyclically or exceeds 32 nested saga hops. Multi-stage sagas may still react to different event types in sequence, but in-process saga graphs must stay acyclic overall; move intentionally cyclic or long-running feedback loops behind an external transport, scheduler, or other bounded boundary.

### Compatibility Tokens

For codebases transitioning to class-first DI or requiring explicit symbol tokens, the following are available:

```typescript
import { Inject } from '@fluojs/core';
import { COMMAND_BUS, QUERY_BUS, EVENT_BUS } from '@fluojs/cqrs';

@Inject(COMMAND_BUS, QUERY_BUS, EVENT_BUS)
class LegacyService {
  constructor(commandBus, queryBus, eventBus) {}
}
```

## Public API Overview

### Modules & Providers
- `CqrsModule.forRoot(options)`: Main entry point. Registers buses and starts discovery.
- Root-level registration is intentionally centered on `CqrsModule.forRoot(...)`; low-level provider helpers are not part of the documented root-barrel contract.
- `CommandBusLifecycleService`: Primary service for executing commands.
- `QueryBusLifecycleService`: Primary service for executing queries.
- `CqrsEventBusService`: Primary service for publishing events.

### Decorators
- `@CommandHandler(Command)`: Associates a class with a Command.
- `@QueryHandler(Query)`: Associates a class with a Query.
- `@EventHandler(Event)`: Associates a class with an Event.
- `@Saga(Event | Event[])`: Marks a class as a Saga listener.

### Interfaces
- `ICommand`, `IQuery<T>`, `IEvent`: Marker interfaces for messages.
- `ICommandHandler<C, R>`, `IQueryHandler<Q, R>`, `IEventHandler<E>`, `ISaga<E>`: Handler contracts.

### Errors
- `SagaTopologyError`: Raised when saga orchestration detects a self-triggering, cyclic, or over-deep in-process saga graph.

## Related Packages

- `@fluojs/event-bus`: Underlying event distribution used by `CqrsEventBusService`.
- `@fluojs/core`: Required for `@Module` and `@Inject` decorators.

## Example Sources

- `packages/cqrs/src/module.test.ts`: Module registration and basic bus usage.
- `packages/cqrs/src/public-api.test.ts`: Root-barrel public API contract coverage.
