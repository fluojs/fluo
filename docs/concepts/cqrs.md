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
- `CqrsEventBus` (`EVENT_BUS`, alias: `CQRS_EVENT_BUS`) for event publishing via `@konekti/event-bus`

It also publishes issue-aligned base contracts:

- `ICommand`
- `IQuery<TResult = unknown>`
- `IEvent`
- `ICommandHandler<TCommand extends ICommand, TResult = void>`
- `IQueryHandler<TQuery extends IQuery<TResult>, TResult = unknown>`
- `IEventHandler<TEvent extends IEvent>`

`createCqrsModule({ commandHandlers?, queryHandlers?, eventHandlers?, eventBus? })` registers those global tokens and imports `createEventBusModule()` automatically, so CQRS event publishing works without extra module wiring.

- `commandHandlers`, `queryHandlers`, `eventHandlers`: optional convenience arrays that are added as providers in the generated CQRS module.
- `eventBus`: forwarded to `createEventBusModule(eventBus)`.

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
- Handlers must be singleton-scoped and implement `handle(...)`.

## event publishing model

`CqrsEventBus` is intentionally thin but not empty:

- `publish(event)` delegates to `@konekti/event-bus` `EVENT_BUS.publish(event)`.
- `publish(event)` also dispatches class-level `@EventHandler()` handlers discovered by `@konekti/cqrs`.
- `publishAll(events)` calls `publish(event)` for each event in order.

This means class-level `@EventHandler()` and method-level `@OnEvent(...)` handlers can coexist for the same event type.

## mental model

```text
@konekti/cqrs = command/query dispatch contracts + event publishing facade
@konekti/event-bus = event handler discovery and dispatch runtime
```
