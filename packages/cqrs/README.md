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

- `createCqrsModule({ commandHandlers?, queryHandlers?, eventHandlers?, sagas?, eventBus? })` - registers global `COMMAND_BUS`, `QUERY_BUS`, and CQRS `EVENT_BUS`, and imports `createEventBusModule()`.
- `createCqrsProviders()` - returns raw providers for manual composition.
- `COMMAND_BUS` - DI token for `CommandBus`.
- `QUERY_BUS` - DI token for `QueryBus`.
- `EVENT_BUS` - issue-compatible CQRS event-bus token for `CqrsEventBus`.
- `CQRS_EVENT_BUS` - compatibility alias to the same CQRS event-bus token.
- `ICommand`, `IQuery<TResult>`, `IEvent` - marker interfaces for CQRS message types.
- `ICommandHandler<TCommand, TResult>`, `IQueryHandler<TQuery, TResult>`, `IEventHandler<TEvent>`, `ISaga<TEvent>` - handler contracts.
- `@CommandHandler(CommandClass)` - marks a class as a command handler.
- `@QueryHandler(QueryClass)` - marks a class as a query handler.
- `@EventHandler(EventClass)` - marks a class with CQRS event-handler metadata.
- `@Saga(EventClass | EventClass[])` - marks a class-level saga/process-manager for one or more event types.
- `createCqrsPlatformStatusSnapshot(input)` - maps CQRS event/saga lifecycle dependency and drain visibility into shared platform snapshot fields

### module option semantics

- `commandHandlers`, `queryHandlers`, `eventHandlers`, and `sagas` are optional convenience arrays.
- Each array item is added as a provider in the generated CQRS module.
- Discovery still relies on decorators/compiled modules at bootstrap, so these arrays are an explicit registration path rather than a replacement for decorator metadata.
- `eventBus` is passed through to `createEventBusModule(eventBus)`.

## Saga process-manager example

```typescript
import { Inject, Module } from '@konekti/core';
import {
  CommandBus,
  CommandHandler,
  COMMAND_BUS,
  CqrsEventBus,
  createCqrsModule,
  EVENT_BUS,
  ICommand,
  ICommandHandler,
  IEvent,
  ISaga,
  Saga,
} from '@konekti/cqrs';

class OrderSubmittedEvent implements IEvent {
  constructor(public readonly orderId: string) {}
}

class PaymentAuthorizedEvent implements IEvent {
  constructor(public readonly orderId: string) {}
}

class InventoryReservedEvent implements IEvent {
  constructor(public readonly orderId: string) {}
}

class StartPaymentCommand implements ICommand {
  constructor(public readonly orderId: string) {}
}

class ReserveInventoryCommand implements ICommand {
  constructor(public readonly orderId: string) {}
}

class CompleteOrderCommand implements ICommand {
  constructor(public readonly orderId: string) {}
}

@Inject([EVENT_BUS])
@CommandHandler(StartPaymentCommand)
class StartPaymentHandler implements ICommandHandler<StartPaymentCommand> {
  constructor(private readonly eventBus: CqrsEventBus) {}

  async execute(command: StartPaymentCommand): Promise<void> {
    await this.eventBus.publish(new PaymentAuthorizedEvent(command.orderId));
  }
}

@Inject([EVENT_BUS])
@CommandHandler(ReserveInventoryCommand)
class ReserveInventoryHandler implements ICommandHandler<ReserveInventoryCommand> {
  constructor(private readonly eventBus: CqrsEventBus) {}

  async execute(command: ReserveInventoryCommand): Promise<void> {
    await this.eventBus.publish(new InventoryReservedEvent(command.orderId));
  }
}

@CommandHandler(CompleteOrderCommand)
class CompleteOrderHandler implements ICommandHandler<CompleteOrderCommand> {
  execute(command: CompleteOrderCommand): void {
    console.log(`order completed: ${command.orderId}`);
  }
}

@Inject([COMMAND_BUS])
@Saga([OrderSubmittedEvent, PaymentAuthorizedEvent, InventoryReservedEvent])
class OrderFulfillmentSaga implements ISaga<IEvent> {
  constructor(private readonly commandBus: CommandBus) {}

  async handle(event: IEvent): Promise<void> {
    if (event instanceof OrderSubmittedEvent) {
      await this.commandBus.execute(new StartPaymentCommand(event.orderId));
      return;
    }

    if (event instanceof PaymentAuthorizedEvent) {
      await this.commandBus.execute(new ReserveInventoryCommand(event.orderId));
      return;
    }

    if (event instanceof InventoryReservedEvent) {
      await this.commandBus.execute(new CompleteOrderCommand(event.orderId));
    }
  }
}

@Module({
  imports: [createCqrsModule()],
  providers: [StartPaymentHandler, ReserveInventoryHandler, CompleteOrderHandler, OrderFulfillmentSaga],
})
export class AppModule {}
```

## Runtime behavior

- Command/query handler discovery runs during `onApplicationBootstrap()` via `COMPILED_MODULES`.
- Handler instances are pre-resolved from `RUNTIME_CONTAINER` during bootstrap.
- Exactly one handler must exist per command type and per query type.
- Duplicate command/query handlers fail fast with typed framework errors.
- Missing command/query handlers throw typed not-found framework errors on `execute(...)`.
- `CqrsEventBus.publish()` delegates to the underlying `EVENT_BUS.publish()`.
- `CqrsEventBus.publish()` also dispatches class-level `@EventHandler()` handlers discovered at bootstrap.
- Saga discovery runs at bootstrap and only registers singleton `@Saga()` classes.
- Different saga classes can observe the same event type; duplicate registration of the same saga class is deduplicated.
- Saga dispatches run through per-saga execution chains, so concurrent `publish()` calls are applied in deterministic order for each saga instance.
- Unexpected saga failures throw `SagaExecutionError` from `publish()`. Existing `KonektiError` failures are preserved.
- In-flight saga executions are drained during application shutdown.
- `CqrsEventBus.publishAll()` calls `publish()` sequentially for each event.

## Requirements and boundaries

- Use standard TC39 decorators only (no legacy decorator mode).
- Command/query handler classes must be singleton-scoped.
- Command/query handler classes must implement `execute(...)`.
- Event handler classes must implement `handle(...)`.
- Saga classes must be singleton-scoped.
- Saga classes must implement `handle(...)`.
- `@EventHandler()` class handlers can coexist with `@konekti/event-bus` method-level `@OnEvent()` handlers.

## Platform status snapshot semantics

Use `createCqrsPlatformStatusSnapshot(...)` (or `CqrsEventBusService#createPlatformStatusSnapshot()`) to expose CQRS event/saga lifecycle state in the shared platform snapshot shape.

- `dependencies`: snapshots expose explicit `event-bus.default` dependency edges.
- `readiness`: discovery/startup and shutdown drain states are surfaced explicitly.
- `health`: unavailable event/saga pipeline states are reported as unhealthy rather than silent no-op behavior.
- `details`: includes discovered CQRS event-handler/saga counts and in-flight saga execution count during drain windows.
