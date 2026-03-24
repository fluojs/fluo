# @konekti/cqrs

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

CQRS primitives for Konekti applications with bootstrap-time handler discovery, command/query dispatch, and event publishing delegation through `@konekti/event-bus`.

## Installation

```bash
npm install @konekti/cqrs
```

## Quick Start

```typescript
import { Inject, Module } from '@konekti/core';
import {
  CommandBus,
  CommandHandler,
  COMMAND_BUS,
  CqrsEventBus,
  createCqrsModule,
  EVENT_BUS,
  EventHandler,
  ICommand,
  ICommandHandler,
  IEvent,
  IEventHandler,
  IQuery,
  IQueryHandler,
  QueryBus,
  QueryHandler,
  QUERY_BUS,
} from '@konekti/cqrs';

class CreateUserCommand implements ICommand {
  constructor(public readonly name: string) {}
}

class GetUserCountQuery implements IQuery<number> {
  readonly __queryResultType__?: number;
}

class UserCreatedEvent implements IEvent {
  constructor(public readonly name: string) {}
}

class UserStore {
  count = 0;
}

@Inject([UserStore])
@CommandHandler(CreateUserCommand)
class CreateUserHandler implements ICommandHandler<CreateUserCommand, number> {
  constructor(private readonly store: UserStore) {}

  execute(command: CreateUserCommand): number {
    void command;
    this.store.count += 1;
    return this.store.count;
  }
}

@Inject([UserStore])
@QueryHandler(GetUserCountQuery)
class GetUserCountHandler implements IQueryHandler<GetUserCountQuery, number> {
  constructor(private readonly store: UserStore) {}

  execute(_query: GetUserCountQuery): number {
    return this.store.count;
  }
}

@EventHandler(UserCreatedEvent)
class AuditLogProjection implements IEventHandler<UserCreatedEvent> {
  handle(event: UserCreatedEvent): void {
    console.log('user created', event.name);
  }
}

@Inject([COMMAND_BUS, QUERY_BUS, EVENT_BUS])
class UserService {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
    private readonly eventBus: CqrsEventBus,
  ) {}

  async create(name: string): Promise<number> {
    const count = await this.commandBus.execute<CreateUserCommand, number>(new CreateUserCommand(name));
    await this.eventBus.publish(new UserCreatedEvent(name));
    return count;
  }

  async getCount(): Promise<number> {
    return this.queryBus.execute<GetUserCountQuery, number>(new GetUserCountQuery());
  }
}

@Module({
  imports: [
    createCqrsModule({
      commandHandlers: [CreateUserHandler],
      eventHandlers: [AuditLogProjection],
      queryHandlers: [GetUserCountHandler],
    }),
  ],
  providers: [UserStore, CreateUserHandler, GetUserCountHandler, AuditLogProjection, UserService],
})
export class AppModule {}
```

## API

- `createCqrsModule({ commandHandlers?, queryHandlers?, eventHandlers?, eventBus? })` - registers global `COMMAND_BUS`, `QUERY_BUS`, and CQRS `EVENT_BUS`, and imports `createEventBusModule()`.
- `createCqrsProviders()` - returns raw providers for manual composition.
- `COMMAND_BUS` - DI token for `CommandBus`.
- `QUERY_BUS` - DI token for `QueryBus`.
- `EVENT_BUS` - issue-compatible CQRS event-bus token for `CqrsEventBus`.
- `CQRS_EVENT_BUS` - compatibility alias to the same CQRS event-bus token.
- `ICommand`, `IQuery<TResult>`, `IEvent` - marker interfaces for CQRS message types.
- `ICommandHandler<TCommand, TResult>`, `IQueryHandler<TQuery, TResult>`, `IEventHandler<TEvent>` - handler contracts.
- `@CommandHandler(CommandClass)` - marks a class as a command handler.
- `@QueryHandler(QueryClass)` - marks a class as a query handler.
- `@EventHandler(EventClass)` - marks a class with CQRS event-handler metadata.

### module option semantics

- `commandHandlers`, `queryHandlers`, and `eventHandlers` are optional convenience arrays.
- Each array item is added as a provider in the generated CQRS module.
- Discovery still relies on decorators/compiled modules at bootstrap, so these arrays are an explicit registration path rather than a replacement for decorator metadata.
- `eventBus` is passed through to `createEventBusModule(eventBus)`.

## Runtime behavior

- Command/query handler discovery runs during `onApplicationBootstrap()` via `COMPILED_MODULES`.
- Handler instances are pre-resolved from `RUNTIME_CONTAINER` during bootstrap.
- Exactly one handler must exist per command type and per query type.
- Duplicate command/query handlers fail fast with typed framework errors.
- Missing command/query handlers throw typed not-found framework errors on `execute(...)`.
- `CqrsEventBus.publish()` delegates to the underlying `EVENT_BUS.publish()`.
- `CqrsEventBus.publish()` also dispatches class-level `@EventHandler()` handlers discovered at bootstrap.
- `CqrsEventBus.publishAll()` calls `publish()` sequentially for each event.

## Requirements and boundaries

- Use standard TC39 decorators only (no legacy decorator mode).
- Command/query handler classes must be singleton-scoped.
- Command/query handler classes must implement `execute(...)`.
- Event handler classes must implement `handle(...)`.
- `@EventHandler()` class handlers can coexist with `@konekti/event-bus` method-level `@OnEvent()` handlers.
