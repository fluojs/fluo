# @fluojs/cqrs

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

CQRS primitives for fluo applications with bootstrap-time handler discovery, command/query dispatch, and event publishing delegation through `@fluojs/event-bus`.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
  - [Read Projections](#read-projections)
  - [Saga Process Managers](#saga-process-managers)
  - [Event Publishing Contracts](#event-publishing-contracts)
  - [Symbol Tokens](#symbol-tokens)
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

Use `CqrsModule.forRoot(...)` to wire CQRS buses and handler discovery.

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

### Read Projections

Read projections keep query-shaped data separate from the write model. Publish a domain event after the write succeeds, update the projection from an `@EventHandler(...)`, and serve that denormalized view from a `@QueryHandler(...)`.

```typescript
import { Inject } from '@fluojs/core';
import {
  EventHandler,
  IEvent,
  IEventHandler,
  IQuery,
  IQueryHandler,
  QueryHandler,
} from '@fluojs/cqrs';

interface OrderSummaryView {
  id: string;
  customerId: string;
  status: 'placed';
}

class OrderPlacedEvent implements IEvent {
  constructor(
    public readonly orderId: string,
    public readonly customerId: string,
  ) {}
}

class GetOrderSummaryQuery implements IQuery<OrderSummaryView | undefined> {
  constructor(public readonly orderId: string) {}
}

@Inject(OrderSummaryProjectionStore)
@EventHandler(OrderPlacedEvent)
class OrderSummaryProjectionHandler implements IEventHandler<OrderPlacedEvent> {
  constructor(private readonly store: OrderSummaryProjectionStore) {}

  async handle(event: OrderPlacedEvent): Promise<void> {
    await this.store.upsert({
      id: event.orderId,
      customerId: event.customerId,
      status: 'placed',
    });
  }
}

@Inject(OrderSummaryProjectionStore)
@QueryHandler(GetOrderSummaryQuery)
class GetOrderSummaryHandler
  implements IQueryHandler<GetOrderSummaryQuery, OrderSummaryView | undefined>
{
  constructor(private readonly store: OrderSummaryProjectionStore) {}

  async execute(query: GetOrderSummaryQuery): Promise<OrderSummaryView | undefined> {
    return this.store.findById(query.orderId);
  }
}
```

Register the projection handler, query handler, and projection store as singleton providers in the same application module that imports `CqrsModule.forRoot(...)`. CQRS handler discovery inspects provider registrations only; HTTP controllers stay on the request boundary and are ignored even when a controller class accidentally carries a CQRS handler decorator. `CqrsModule.forRoot(...)` exports the buses globally by default, and `CqrsModule.forRoot({ global: false })` keeps those bus providers and the delegated `@fluojs/event-bus` providers visible only through modules that import the CQRS module unless `eventBus.global` is explicitly overridden. `CqrsEventBusService.publish(new OrderPlacedEvent(...))` runs matching `@EventHandler(...)` providers before sagas and delegated `@fluojs/event-bus` publication, so the read model observes the write-side fact through the documented CQRS event pipeline. Fan-out identity follows the singleton provider token: registering one decorated handler class under two distinct tokens intentionally invokes both registrations, while repeated discovery of the same token and event route is deduplicated. Keep projection handlers idempotent because event replay, retries, or external transports can deliver the same business fact more than once.

### Saga Process Managers

Sagas allow you to listen for events and trigger new commands, enabling complex long-running workflows.

```typescript
import { Inject } from '@fluojs/core';
import { Saga, ISaga, IEvent, ICommand, CqrsDispatchContext, CommandBusLifecycleService } from '@fluojs/cqrs';

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

  async handle(event: UserCreatedEvent, context?: CqrsDispatchContext): Promise<void> {
    await this.commandBus.execute(new SendWelcomeEmailCommand(event.userId), context);
  }
}
```

Saga execution fails fast with `SagaTopologyError` when an in-process publish chain re-enters the same provider-token/event route cyclically or exceeds 32 nested saga hops. Distinct singleton tokens that use the same decorated saga class remain distinct fan-out routes. Multi-stage sagas may still react to different event types in sequence, but in-process saga graphs must stay acyclic overall; move intentionally cyclic or long-running feedback loops behind an external transport, scheduler, or other bounded boundary.

When a saga, command handler, query handler, or event handler performs another CQRS `execute(...)`, `publish(...)`, or `publishAll(...)` call, pass the optional `CqrsDispatchContext` argument through unchanged. CQRS uses this explicit runtime-agnostic context to keep saga topology checks intact across nested dispatch without relying on Node.js async-local APIs. The context is an opaque, frozen fieldless pass-through value; trusted topology and shutdown-drain state remains private to CQRS. Do not construct, clone, inspect, or mutate it because caller-shaped objects and copied values do not carry trusted runtime state.

### Event Publishing Contracts

`CqrsEventBusService.publish(event)` runs the CQRS event pipeline in a fixed order: matching `@EventHandler(...)` providers first, matching `@Saga(...)` providers second, and delegated `@fluojs/event-bus` publication last. `publishAll(events)` preserves the input order by awaiting each event's CQRS handlers, sagas, and delegated publication call before publishing the next event. During application shutdown, the CQRS event bus waits for active `publish(...)` pipelines, `publishAll(...)` sequences, and saga execution chains to settle before marking itself stopped. Command and query buses reject new `execute(...)` calls once shutdown starts and clear their preloaded handler caches during shutdown, so post-close dispatch cannot reuse stale provider instances. Once shutdown starts, brand-new external `publish(...)`, `publishAll(...)`, and direct saga dispatch calls are rejected. A nested `publish(...)` or `publishAll(...)` invoked from an already active handler or saga may continue only when it passes through the CQRS-provided `CqrsDispatchContext`; this keeps drain work inside the active pipeline while still rejecting unrelated callers. Already active publish and saga work continues draining inside the bounded shutdown window. Shutdown drain is bounded by `CqrsModule.forRoot({ shutdown: { drainTimeoutMs } })`, which defaults to 5000ms; if a CQRS handler, saga, or delegated publish chain is still stuck after the bound, CQRS records degraded status diagnostics, logs a warning, and lets application close continue instead of hanging indefinitely. When `CqrsModule.forRoot({ eventBus: { publish: { waitForHandlers: false } } })` is configured, the delegated publication call can resolve before matching `@OnEvent(...)` subscribers finish, so `publish(...)`, `publishAll(...)`, and shutdown drain completion do not imply subscriber completion in that mode.

Each CQRS event handler and saga receives an isolated event copy with the matched event prototype restored. Mutating that copy is local to the current handler or saga route; those mutations are not visible to other CQRS handlers, sagas, the original event object, or delegated `@fluojs/event-bus` subscribers. The delegated event-bus publication receives the original event after CQRS side effects complete, so `@OnEvent(...)` projections and transports observe the caller-owned payload rather than a CQRS handler's mutated copy.

Event classes should keep their payload state cloneable and enumerable. String-keyed and symbol-keyed enumerable payload fields are preserved by the shared core clone fallback, while intentionally non-cloneable resources such as open sockets, functions, or process-local handles should be represented by IDs or other serializable boundaries before publishing.

CQRS handlers, event handlers, and sagas are discovered only on singleton providers. Non-singleton registrations are skipped with warnings. Event-handler and saga fan-out is keyed by singleton provider token, so distinct tokens remain distinct routes even when they use the same decorated class.

### Symbol Tokens

Use these exports when you want explicit symbol tokens for the CQRS buses:

```typescript
import { Inject } from '@fluojs/core';
import { COMMAND_BUS, QUERY_BUS, EVENT_BUS } from '@fluojs/cqrs';

@Inject(COMMAND_BUS, QUERY_BUS, EVENT_BUS)
class TokenInjectedService {
  constructor(commandBus, queryBus, eventBus) {}
}
```

## Public API Overview

### Modules & Providers
- `CqrsModule.forRoot(options)`: Main entry point. Registers buses and starts provider-only discovery. Bus providers are global by default; pass `global: false` for module-local visibility.
- Module options can provide explicit `commandHandlers`, `queryHandlers`, `eventHandlers`, `sagas`, and delegated `eventBus` options.
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
- `CqrsDispatchContext`: Opaque optional context value to pass through nested CQRS dispatch from handlers and sagas. It exposes no public fields; provider assembly remains behind `CqrsModule.forRoot(...)` rather than a public `createCqrsProviders(...)` helper.

### Errors
- `CommandHandlerNotFoundException`, `QueryHandlerNotFoundException`: Raised when a bus has no matching handler.
- `DuplicateCommandHandlerError`, `DuplicateQueryHandlerError`: Raised when different singleton providers claim the same command or query type.
- `DuplicateEventHandlerError`: Exported for conflicting event-handler discovery failures; ordinary multiple `@EventHandler(...)` providers for the same event are valid and fan out in discovery order.
- `SagaExecutionError`: Wraps unexpected non-Fluo saga failures.
- `SagaTopologyError`: Raised when saga orchestration detects a self-triggering, cyclic, or over-deep in-process saga graph.

### Status and metadata
- `createCqrsPlatformStatusSnapshot(...)`: Creates CQRS status snapshots for diagnostics and health surfaces.
- Metadata helpers and symbols are exported for framework packages that need to inspect command, query, event, or saga registrations.

## Related Packages

- `@fluojs/event-bus`: Underlying event distribution used by `CqrsEventBusService`.
- `@fluojs/core`: Required for `@Module` and `@Inject` decorators.

## Example Sources

- `packages/cqrs/src/module.test.ts`: Module registration and basic bus usage.
- `packages/cqrs/src/public-api.test.ts`: Root-barrel public API contract coverage.
- `packages/cqrs/src/status.test.ts`: CQRS status snapshot behavior.
- `packages/cqrs/src/event-clone.test.ts`: Event clone fallback behavior.
