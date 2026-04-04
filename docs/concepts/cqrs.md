# cqrs

This guide describes the CQRS package model in Konekti.

### related documentation

- `./decorators-and-metadata.md`
- `./di-and-modules.md`
- `../../packages/cqrs/README.md`

## what `@konekti/cqrs` provides

`@konekti/cqrs` adds three runtime surfaces:

- `CommandBus` (`COMMAND_BUS`) for command execution
- `QueryBus` (`QUERY_BUS`) for query execution
- `CqrsEventBus` (`EVENT_BUS`) for event publishing via `@konekti/event-bus`

It also publishes issue-aligned base contracts:

- `ICommand`
- `IQuery<TResult = unknown>`
- `IEvent`
- `ICommandHandler<TCommand extends ICommand, TResult = void>`
- `IQueryHandler<TQuery extends IQuery<TResult>, TResult = unknown>`
- `IEventHandler<TEvent extends IEvent>`
- `ISaga<TEvent extends IEvent>` — saga/process-manager contract for event-driven orchestration

`CqrsModule.forRoot({ commandHandlers?, queryHandlers?, eventHandlers?, sagas?, eventBus? })` registers those global tokens and imports `EventBusModule.forRoot()` automatically, so CQRS event publishing works without extra module wiring.

- `commandHandlers`, `queryHandlers`, `eventHandlers`, `sagas`: optional convenience arrays that are added as providers in the generated CQRS module.
- `eventBus`: forwarded to `EventBusModule.forRoot(eventBus)`.

## handler registration model

Command and query handlers are class-based and discovered at bootstrap.

```typescript
import {
  CommandHandler,
  ICommand,
  ICommandHandler,
  IQuery,
  IQueryHandler,
  QueryHandler,
} from '@konekti/cqrs';

class CreateUserCommand implements ICommand {
  constructor(public readonly name: string) {}
}

class GetUserQuery implements IQuery<{ id: string }> {
  readonly __queryResultType__?: { id: string };

  constructor(public readonly id: string) {}
}

@CommandHandler(CreateUserCommand)
class CreateUserHandler implements ICommandHandler<CreateUserCommand, string> {
  execute(command: CreateUserCommand) {
    return command.name;
  }
}

@QueryHandler(GetUserQuery)
class GetUserHandler implements IQueryHandler<GetUserQuery, { id: string }> {
  execute(query: GetUserQuery) {
    return { id: query.id };
  }
}
```

- Decorators are implemented with **standard TC39 class decorators** and `ClassDecoratorContext.metadata`.
- Metadata readers merge explicit metadata store values with standard decorator metadata safely.
- Handler discovery runs in `onApplicationBootstrap()` using `COMPILED_MODULES` and `RUNTIME_CONTAINER`.

## command/query invariants

- Exactly one handler must exist per command type.
- Exactly one handler must exist per query type.
- Duplicate registrations fail bootstrap with typed framework errors.
- Missing handlers fail at execute-time with typed framework errors.
- Command/query handler classes must be singleton-scoped and implement `execute(...)`.

## event publishing model

`CqrsEventBus` is intentionally thin but not empty:

- `publish(event)` delegates to `@konekti/event-bus` `EVENT_BUS.publish(event)`.
- `publish(event)` also dispatches class-level `@EventHandler()` handlers discovered by `@konekti/cqrs`.
- `publishAll(events)` calls `publish(event)` for each event in order.

This means class-level `@EventHandler()` and method-level `@OnEvent(...)` handlers can coexist for the same event type.

## saga / process-manager model

`@Saga(EventClass | EventClass[])` marks a class as a saga/process-manager that reacts to one or more event types:

```typescript
import { Inject } from '@konekti/core';
import {
  CommandBus,
  COMMAND_BUS,
  IEvent,
  ISaga,
  Saga,
} from '@konekti/cqrs';

class OrderSubmittedEvent implements IEvent {
  constructor(public readonly orderId: string) {}
}

class StartPaymentCommand {
  constructor(public readonly orderId: string) {}
}

@Inject([COMMAND_BUS])
@Saga(OrderSubmittedEvent)
class OrderSaga implements ISaga<OrderSubmittedEvent> {
  constructor(private readonly commandBus: CommandBus) {}

  async handle(event: OrderSubmittedEvent): Promise<void> {
    await this.commandBus.execute(new StartPaymentCommand(event.orderId));
  }
}
```

- `@Saga()` accepts a single event class or an array of event classes.
- Saga classes must be singleton-scoped and implement `handle(event)`.
- Different saga classes can observe the same event type; duplicate registration of the same saga class is deduplicated.
- Saga dispatches run through per-saga execution chains, so concurrent `publish()` calls are applied in deterministic order for each saga instance.
- Unexpected saga failures throw `SagaExecutionError` from `publish()`.
- In-flight saga executions are drained during application shutdown.
- Register sagas via the `sagas` option in `CqrsModule.forRoot({ sagas: [...] })` or rely on decorator discovery at bootstrap.

## mental model

```text
@konekti/cqrs = command/query dispatch contracts + event publishing facade
@konekti/event-bus = event handler discovery and dispatch runtime
```
