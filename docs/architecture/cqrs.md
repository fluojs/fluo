# CQRS Contract

<p><strong><kbd>English</kbd></strong> <a href="./cqrs.ko.md"><kbd>한국어</kbd></a></p>

This document defines the current CQRS contract implemented by `@fluojs/cqrs` and `@fluojs/event-bus`.

## Message Separation Rules

| Message type | Dispatch surface | Resolution model | Current contract |
| --- | --- | --- | --- |
| Command | `CommandBusLifecycleService.execute(...)` or `COMMAND_BUS.execute(...)` | One command type to one singleton handler | A command resolves by constructor identity. Missing handlers fail with `CommandHandlerNotFoundException`. Duplicate singleton handlers for the same command fail discovery with `DuplicateCommandHandlerError`. |
| Query | `QueryBusLifecycleService.execute(...)` or `QUERY_BUS.execute(...)` | One query type to one singleton handler | A query resolves by constructor identity. Missing handlers fail with `QueryHandlerNotFoundException`. Duplicate singleton handlers for the same query fail discovery with `DuplicateQueryHandlerError`. |
| Event | `CqrsEventBusService.publish(...)` or `EVENT_BUS.publish(...)` | One event type to zero or more singleton handlers | Event handlers are matched with `instanceof` against the published event type. Duplicate `@EventHandler(...)` providers for the same event, including aliases of the same handler class, are valid and fan out in discovery order. Local handlers run first, then saga dispatch, then delegated publication through `@fluojs/event-bus`. |
| Saga trigger | `@Saga(Event)` or `@Saga([EventA, EventB])` | One saga class to one or more event types | Saga metadata is attached to singleton providers and discovered at bootstrap. One saga may listen to multiple event constructors. |

## Handler Registration Rules

| Rule | Current contract | Source anchor |
| --- | --- | --- |
| Module entrypoint | Applications register CQRS through `CqrsModule.forRoot(...)`. The module is global and exports lifecycle services plus the `COMMAND_BUS`, `QUERY_BUS`, and `EVENT_BUS` compatibility tokens. | `packages/cqrs/src/module.ts` |
| Decorator metadata | `@CommandHandler(...)`, `@QueryHandler(...)`, `@EventHandler(...)`, and `@Saga(...)` store standard-decorator metadata on the target class. | `packages/cqrs/src/decorators.ts`, `packages/cqrs/src/metadata.ts` |
| Optional eager registration | `CqrsModule.forRoot({ commandHandlers, queryHandlers, eventHandlers, sagas })` adds those classes to the provider list, but discovery still reads the same handler metadata. | `packages/cqrs/src/module.ts` |
| Singleton-only discovery | Command handlers, query handlers, event handlers, and sagas are registered only when the provider scope is `singleton`. Non-singleton candidates are skipped with a logger warning. | `packages/cqrs/src/buses/command-bus.ts`, `packages/cqrs/src/buses/query-bus.ts`, `packages/cqrs/src/buses/event-bus.ts`, `packages/cqrs/src/buses/saga-bus.ts` |
| Handler shape | Command and query handlers MUST implement `execute(...)`. Event handlers and sagas MUST implement `handle(...)`. Violations fail at dispatch with `InvariantError`. | `packages/cqrs/src/buses/command-bus.ts`, `packages/cqrs/src/buses/query-bus.ts`, `packages/cqrs/src/buses/event-bus.ts`, `packages/cqrs/src/buses/saga-bus.ts` |
| Duplicate registrations | Duplicate singleton command and query providers are discovery errors because those buses are point-to-point, even when aliases use the same handler class. Duplicate singleton event-handler providers are not a conflict; every matching `@EventHandler(...)` provider is retained and invoked once in discovery order. | `packages/cqrs/src/buses/command-bus.ts`, `packages/cqrs/src/buses/query-bus.ts`, `packages/cqrs/src/buses/event-bus.ts`, `packages/cqrs/src/errors.ts` |
| Saga event list | `@Saga()` requires at least one event constructor and rejects non-class event values. Duplicate event constructors in one decorator call are deduplicated. | `packages/cqrs/src/decorators.ts` |

## Bus and Lifecycle Boundaries

| Surface | Current behavior | Source anchor |
| --- | --- | --- |
| Command bus | Discovers handlers once, preloads handler instances, then dispatches one command to one handler. | `packages/cqrs/src/buses/command-bus.ts` |
| Query bus | Discovers handlers once, preloads handler instances, then dispatches one query to one handler. | `packages/cqrs/src/buses/query-bus.ts` |
| CQRS event bus | Publishes to matching local event handlers, then to the saga lifecycle service, then to the shared `@fluojs/event-bus` transport. `publishAll(...)` awaits each event's full CQRS pipeline before publishing the next event, preserving input order. | `packages/cqrs/src/buses/event-bus.ts` |
| Saga runtime | Serializes execution per saga token, tracks active dispatch context with `AsyncLocalStorage`, and reports runtime snapshot data for diagnostics. | `packages/cqrs/src/buses/saga-bus.ts` |
| Shutdown behavior | The CQRS event bus waits for active `publish(...)` pipelines and `publishAll(...)` sequences to settle before marking itself stopped. The saga runtime also waits for in-flight dispatches during shutdown before clearing descriptors and cached handler instances. New publishes after shutdown begins and direct saga dispatches after shutdown completes are ignored with lifecycle warnings. | `packages/cqrs/src/buses/event-bus.ts`, `packages/cqrs/src/buses/saga-bus.ts` |

## Constraints

- Command and query routing is constructor-based and point-to-point. One message type cannot intentionally resolve to multiple singleton handlers.
- Event handling is in-process by default. `CqrsEventBusService` delegates the final publication step to `@fluojs/event-bus`, but the CQRS package itself does not provide a distributed broker contract.
- Shutdown drain covers CQRS-local handler and saga work plus the delegated publication call. When `CqrsModule.forRoot({ eventBus: { publish: { waitForHandlers: false } } })` is configured, delegated `@OnEvent(...)` subscribers may still be running after delegated publication resolves, so `publish(...)`, `publishAll(...)`, and CQRS shutdown drain completion do not guarantee subscriber completion in that mode.
- Saga orchestration is guarded against unsafe re-entry. Re-entering the same saga route or exceeding the nested depth limit of `32` fails with `SagaTopologyError`.
- Sagas that throw non-Fluo errors are wrapped as `SagaExecutionError`.
- The CQRS package relies on TC39 standard decorators and explicit metadata storage.
