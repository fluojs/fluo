# CQRS (Command Query Responsibility Segregation)

<p><strong><kbd>English</kbd></strong> <a href="./cqrs.ko.md"><kbd>한국어</kbd></a></p>

Architecture is about managing complexity. fluo provides a robust CQRS implementation that separates **state-changing operations (Commands)** from **data-retrieval operations (Queries)** into distinct buses, facilitating scalable and maintainable backend systems.

## Why CQRS in fluo?

- **Decoupled Intent and Execution**: Application services only need to know the "Intent" (a Command or Query object), not the implementation details of how it's handled.
- **Explicit Domain Modeling**: By treating state changes as first-class `Command` objects, your business logic becomes auditable and easier to reason about.
- **Event-Driven Orchestration**: Built-in support for **Sagas** allows you to manage complex, multi-step workflows across different domains without tight coupling.
- **Zero-Config Discovery**: Handlers are automatically discovered and registered at bootstrap time using standard decorators.

## Responsibility Split

- **`@fluojs/cqrs` (The Orchestrator)**: Provides the core `CommandBus`, `QueryBus`, and `CqrsEventBus`. It manages the discovery lifecycle and ensures each message reaches its designated handler.
- **`@fluojs/event-bus` (The Engine)**: The underlying infrastructure for event distribution. The CQRS package delegates event publishing to this package for high-performance delivery.

## Typical Workflows

### 1. The Command Flow (Write)
A Command represents an intent to change the system state. It has exactly one handler and often results in one or more events.

```typescript
// 1. Dispatch the intent
await commandBus.execute(new CreateUserCommand('John Doe'));

// 2. Handled by
@CommandHandler(CreateUserCommand)
class CreateUserHandler implements ICommandHandler<CreateUserCommand> {
  async execute(command: CreateUserCommand) {
    // Logic to save to database...
    // Automatically publish UserCreatedEvent...
  }
}
```

### 2. The Query Flow (Read)
A Query represents an intent to retrieve data. Like commands, queries are handled by a single dedicated handler to ensure predictable read models.

```typescript
const user = await queryBus.execute(new GetUserQuery(userId));
```

### 3. The Saga (Cross-Domain Orchestration)
Sagas listen for events and dispatch new commands, acting as a "Process Manager" for complex workflows.

```typescript
@Saga(UserCreatedEvent)
class WelcomeSaga implements ISaga<UserCreatedEvent> {
  async handle(event: UserCreatedEvent) {
    // When a user is created, trigger the "Send Welcome Email" command
    await this.commandBus.execute(new SendEmailCommand(event.userId));
  }
}
```

## Core Boundaries

- **The Single Handler Rule**: Commands and Queries are **Point-to-Point**. Each must have exactly one handler. If zero or multiple handlers are found, fluo will throw an error at bootstrap or execution time.
- **Event-to-Many**: Unlike commands, a single `Event` can be handled by multiple `EventHandlers` and `Sagas` simultaneously.
- **Local vs. Distributed**: The default CQRS buses operate within a single process. For distributed architectures, you can bridge these buses to external brokers via custom adapters.

## Next Steps

- **Deep Dive**: Explore the [CQRS Package README](../../packages/cqrs/README.md).
- **Underlying Infrastructure**: Learn about the [Event Bus Package](../../packages/event-bus/README.md).
- **Examples**: See complex saga workflows in the [Example Apps](../../examples/README.md).
