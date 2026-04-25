<!-- packages: @fluojs/cqrs, @fluojs/event-bus -->
<!-- project-state: FluoShop v1.9.0 -->

# Chapter 10. CQRS and Sagas

In this chapter, we separate commands, queries, and sagas on top of FluoShop's event-driven flow to build more explicit write, read, and orchestration models. Chapter 9 organized reactions to business facts. Here, we shift the focus to using those facts to organize long-running workflows and read projections.

## Learning Objectives
- Understand why CQRS separates write, read, and orchestration concerns.
- Explain why each command and query should have exactly one handler.
- Learn how to connect the command bus and query bus to the FluoShop write side.
- Analyze the flow where a Saga receives an event and dispatches the next command.
- Explain why in-process saga topology limits lead to other boundary choices such as queues or schedulers.
- Describe the design principle of evolving read models and write models separately.

## Prerequisites
- Complete Chapter 1, Chapter 2, Chapter 3, Chapter 4, Chapter 5, Chapter 6, Chapter 7, Chapter 8, and Chapter 9.
- A basic understanding of commands, queries, and domain events.
- A general sense of asynchronous workflows and projection models.

## 10.1 Why CQRS enters FluoShop now

Part 2 covers event-driven architecture. CQRS belongs here because it formalizes why writes, reads, and follow-up actions should be different. In commerce platforms, these paths almost never have the same requirements. The write side protects invariants, the read side optimizes view shape and speed, and the orchestration layer listens to facts and triggers the next step. That is the separation FluoShop needs now. The package README states the core motivation clearly as well. Commands express intent. Queries retrieve data. Sagas orchestrate multi-step flows started by events.

## 10.2 Command flow on the write side

Commands should describe requested state changes. They are point-to-point. One command should have exactly one handler. This rule makes write ownership explicit.

### 10.2.1 PlaceOrderCommand

By v1.9.0, FluoShop no longer invokes checkout writes only through vague service methods. Instead, it models intent directly.

```typescript
import { Inject } from '@fluojs/core';
import { CommandHandler, ICommandHandler } from '@fluojs/cqrs';

export class PlaceOrderCommand {
  constructor(
    public readonly customerId: string,
    public readonly cartId: string,
  ) {}
}

@Inject(CheckoutService)
@CommandHandler(PlaceOrderCommand)
export class PlaceOrderHandler implements ICommandHandler<PlaceOrderCommand, string> {
  constructor(private readonly checkout: CheckoutService) {}

  async execute(command: PlaceOrderCommand): Promise<string> {
    const order = await this.checkout.place(command.customerId, command.cartId);
    return order.id;
  }
}
```

The command name communicates the intent immediately. The handler owns execution. There is no ambiguity about where that intent lands.

### 10.2.2 Why the single handler rule matters

If two handlers could process the same command, the write model would become nondeterministic. That structure is hard to allow around business invariants. When FluoShop uses commands, it must answer one question clearly. Who is responsible for actually causing this state change? CQRS answers with one handler.

## 10.3 Query flow on the read side

Queries are also point-to-point. Their purpose is different, though. They don't protect write invariants. They satisfy view needs. This separation matters. The best read model is rarely the best write model.

### 10.3.1 GetOrderTimelineQuery

Customer support may need a timeline view that combines checkout, shipment, and refund states. That projection is a read concern. Each new dashboard should not force the write aggregate to be reshaped.

```typescript
import { IQuery, IQueryHandler, QueryHandler } from '@fluojs/cqrs';
import { Inject } from '@fluojs/core';

export class GetOrderTimelineQuery implements IQuery<OrderTimelineView> {
  constructor(public readonly orderId: string) {}
}

@Inject(OrderTimelineStore)
@QueryHandler(GetOrderTimelineQuery)
export class GetOrderTimelineHandler
  implements IQueryHandler<GetOrderTimelineQuery, OrderTimelineView>
{
  constructor(private readonly timelineStore: OrderTimelineStore) {}

  async execute(query: GetOrderTimelineQuery): Promise<OrderTimelineView> {
    return await this.timelineStore.get(query.orderId);
  }
}
```

This keeps the read side honest. It can optimize for view assembly, and it doesn't need to pretend to be the authoritative write model.

### 10.3.2 Projection is part of the design

Once queries are explicit, projections become easier to discuss. FluoShop can create a support timeline table. It can create a fulfillment dashboard table too. It can also create a finance summary table. Each read model exists because a user or operator actually needs it. That structure is better than forcing every consumer to read the write store directly.

## 10.4 CQRS wiring in fluo

The package README documents `CqrsModule.forRoot(...)` as the supported root entrypoint. This Module registers the command, query, and event buses and performs discovery during bootstrap.

```typescript
import { Module } from '@fluojs/core';
import { CqrsModule } from '@fluojs/cqrs';

@Module({
  imports: [CqrsModule.forRoot()],
  providers: [
    PlaceOrderHandler,
    GetOrderTimelineHandler,
    ReserveInventoryHandler,
    OrderFulfillmentSaga,
  ],
})
export class CommerceApplicationModule {}
```

This keeps the entrypoint concise. As with earlier fluo packages, lifecycle and discovery happen through Module registration instead of manually assembling buses in each feature.

## 10.5 Event publishing from CQRS

The concept docs draw a clear boundary. `@fluojs/cqrs` is the orchestrator. `@fluojs/event-bus` is the engine underneath it that handles event distribution. This layering matters. CQRS does not replace the event bus. It structures how the application uses the event bus. In FluoShop, after a command handler stores a write, it can publish a domain event through the CQRS event bus service. That event can lead to regular event handlers or Sagas. The write side stays explicit, and the reaction side stays decoupled.

## 10.6 Saga flow for long-running fulfillment

Sagas are where CQRS becomes visibly event-driven. A Saga listens to one event and emits the next command. In other words, it is a process manager, not a magical workflow engine.

### 10.6.1 OrderPlacedEvent to ReserveInventoryCommand

After a customer completes an order, FluoShop must reserve inventory. This is a natural Saga step.

```typescript
import { Inject } from '@fluojs/core';
import { CommandBusLifecycleService, ISaga, Saga } from '@fluojs/cqrs';

export class ReserveInventoryCommand {
  constructor(public readonly orderId: string) {}
}

@Inject(CommandBusLifecycleService)
@Saga(OrderPlacedEvent)
export class OrderFulfillmentSaga implements ISaga<OrderPlacedEvent> {
  constructor(private readonly commandBus: CommandBusLifecycleService) {}

  async handle(event: OrderPlacedEvent): Promise<void> {
    await this.commandBus.execute(new ReserveInventoryCommand(event.orderId));
  }
}
```

This example is intentionally small. A good Saga step is usually simple. It reacts to one fact and chooses the next command.

### 10.6.2 Reserve inventory, then dispatch shipment

A Saga can continue through additional event types. `InventoryReservedEvent` can cause `DispatchShipmentCommand`. `ShipmentDispatchedEvent` can cause `SendShipmentNotificationCommand`. The important design point is that each step crosses an event boundary. That lets FluoShop observe, retry, and reschedule at each boundary instead of treating the entire fulfillment flow as one invisible block.

## 10.7 Saga topology limits

The package README includes an operationally important rule. If an in-process publish chain re-enters the same saga route cyclically or exceeds 32 nested saga hops, saga execution fails immediately with `SagaTopologyError`. This is not an implementation detail. It is an architecture guide. FluoShop must keep its in-process saga graph acyclic. If a workflow is intentionally cyclic or becomes too long-running, it should move behind a different boundary. That boundary might be an external transport. It might be a queue. It might be a scheduler. But it should not remain an endlessly re-entering in-process saga chain.

### 10.7.1 What this means for FluoShop

For example, suppose payment review can move back and forth between fraud analysis and manual approval several times. That should not be modeled as a tight in-process saga loop. Instead, the system should emit an event and hand the next step to a queue worker or scheduled retry path. That keeps the saga topology readable and preserves the documented fluo contract.

## 10.8 A full CQRS and saga flow in FluoShop

In v1.9.0, the order path now looks like this:

1. The API dispatches `PlaceOrderCommand`.
2. `PlaceOrderHandler` validates and stores the order.
3. The write side publishes `OrderPlacedEvent`.
4. `OrderFulfillmentSaga` receives the event.
5. The Saga dispatches `ReserveInventoryCommand`.
6. Inventory stores the reservation and publishes `InventoryReservedEvent`.
7. Another Saga step dispatches `DispatchShipmentCommand`.
8. Shipment publishes `ShipmentDispatchedEvent`.
9. Notification and read-model handlers react.

This is the CQRS and Saga flow seen from one view. Writes are explicit. Reads are explicit. Cross-domain orchestration is explicit too. That clarity matters more than the pattern name.

## 10.9 Read and write models should evolve separately

CQRS does not require separate databases. But it does require separate thinking. The write model must protect correctness. The read model must satisfy consumer needs. In FluoShop, a support agent may need one denormalized view. Finance may need another view. Operations may need a third view. Trying to satisfy all of them with one aggregate shape usually creates accidental complexity. CQRS gives the team permission not to do that.

## 10.10 FluoShop v1.9.0 progression

At this stage, FluoShop has moved beyond simply publishing domain events after writes. It now has formal models for commands, queries, and long-running orchestration. That is a meaningful increase in maturity. The platform can express business intent more precisely. It can expose read models shaped for user needs. It can connect fulfillment steps without pretending everything belongs to one transaction. This prepares the next two chapters. Queues will move slow work out of the immediate flow. Schedulers will manage periodic and delayed reactions inside a clear operational boundary.

## 10.11 Summary

- `@fluojs/cqrs` separates writes, reads, and orchestration into explicit buses and handlers.
- Commands and queries are point-to-point and should have exactly one handler.
- A Saga listens to events and dispatches the next command in a long-running workflow.
- `CqrsEventBusService` delegates event distribution through `@fluojs/event-bus`, so CQRS is built on top of the event bus instead of replacing it.
- `SagaTopologyError` is a design warning that cyclic or overly deep in-process saga graphs need another boundary such as a queue or scheduler.

The key lesson is practical. CQRS is useful in FluoShop not because the acronym is fashionable. It is useful because the platform now needs explicit ownership for writes, explicit shaping for reads, and explicit orchestration between the two.
