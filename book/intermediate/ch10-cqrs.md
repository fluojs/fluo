<!-- packages: @fluojs/cqrs, @fluojs/event-bus -->
<!-- project-state: FluoShop v1.9.0 -->

# 10. CQRS and Sagas

The event bus gave FluoShop a clean way to react to facts. CQRS goes one step further, giving the platform a clear language for intent, reads, and orchestration. The `@fluojs/cqrs` package splits commands from queries and builds event-driven process management on top of the event bus. This matters once the commerce workflow becomes larger than one service method. By v1.9.0, FluoShop needs more than local event reactions. It needs explicit write commands, dedicated read models, and sagas that connect long-running business steps without collapsing everything into one transaction.

## 10.1 Why CQRS enters FluoShop now

Part 2 is about event-driven architecture. CQRS belongs here because it formalizes how writes, reads, and follow-up actions should differ. In a commerce platform, those paths rarely have identical needs. The write side protects invariants, the read side optimizes view shape and speed, and the orchestration layer listens for facts and triggers the next step. That is exactly the split FluoShop now needs. The package README names the core motivations clearly. Commands express intent. Queries retrieve data. Sagas orchestrate multi-step flows triggered by events.

## 10.2 Command flow on the write side

Commands should describe a requested state change. They are point-to-point. One command must have exactly one handler. That rule makes write ownership explicit.

### 10.2.1 PlaceOrderCommand

At v1.9.0, FluoShop stops calling checkout writes through vague service methods alone.

Instead, it models the intent directly.

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

The command name tells the story. The handler owns the execution. There is no ambiguity about where that intent lands.

### 10.2.2 Why the single handler rule matters

If two handlers could process the same command, the write model would become nondeterministic. That is unacceptable for business invariants. FluoShop uses commands where the platform must answer a simple question: who is responsible for making this state change happen? CQRS answers with one handler.

## 10.3 Query flow on the read side

Queries are also point-to-point. But their goal is different. They do not protect write invariants. They serve view needs. This separation matters because the best read model is often not the best write model.

### 10.3.1 GetOrderTimelineQuery

Customer support may need a timeline view that joins checkout, shipment, and refund state. That projection is a read concern. It should not reshape the write aggregate every time a new dashboard appears.

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

This keeps the read side honest. It is allowed to optimize for view assembly. It does not need to pretend it is the authoritative write model.

### 10.3.2 Projection is part of the design

Once queries are explicit, projection becomes easier to discuss. FluoShop can build a support timeline table. It can build a fulfillment dashboard table. It can build a finance summary table. Each read model exists because a user or operator needs it. That is a better reason than forcing every consumer to read the write store directly.

## 10.4 CQRS wiring in fluo

The package README documents `CqrsModule.forRoot(...)` as the supported root entrypoint.

That module registers command, query, and event buses and performs discovery at bootstrap.

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

This keeps the entrypoint concise.

As with earlier fluo packages, lifecycle and discovery happen through module registration rather than manual bus assembly in every feature.

## 10.5 Event publishing from CQRS

The concept doc is explicit about the boundary. `@fluojs/cqrs` is the orchestrator. `@fluojs/event-bus` is the underlying event distribution engine. That layering is important. CQRS does not replace the event bus. It structures how the application uses it. In FluoShop, a command handler may persist a write and then publish a domain event through the CQRS event bus service. That event can feed ordinary event handlers or sagas. The write side stays explicit, and the reaction side stays decoupled.

## 10.6 Saga flow for long-running fulfillment

Sagas are where CQRS becomes visibly event-driven. A saga listens for one event and emits the next command. That makes it a process manager, not a magical workflow engine.

### 10.6.1 OrderPlacedEvent to ReserveInventoryCommand

After a customer places an order, FluoShop should reserve inventory.

That is a natural saga step.

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

This is small on purpose. A good saga step is usually simple. It reacts to one fact and chooses the next command.

### 10.6.2 Reserve inventory, then dispatch shipment

The saga can continue through additional event types. `InventoryReservedEvent` can trigger `DispatchShipmentCommand`. `ShipmentDispatchedEvent` can trigger `SendShipmentNotificationCommand`. The important design point is that each step crosses an event boundary. That means FluoShop can observe, retry, or reschedule work at those boundaries instead of treating the whole fulfillment flow as one invisible block.

## 10.7 Saga topology limits

The package README includes an operationally important rule. Saga execution fails fast with `SagaTopologyError` when an in-process publish chain re-enters the same saga route cyclically or exceeds 32 nested saga hops. That is not an implementation footnote. It is architectural guidance. FluoShop should keep in-process saga graphs acyclic. If a workflow becomes intentionally cyclic or too long-running, it belongs behind another boundary. That boundary may be an external transport. It may be a queue. It may be a scheduler. But it should not stay an endlessly re-entrant in-process saga chain.

### 10.7.1 What this means for FluoShop

Suppose payment review can bounce between fraud analysis and manual approval several times. That should not be modeled as a tight in-process saga loop. Instead, the system should emit an event and hand the next step to a queue worker or a scheduled retry path. That keeps the saga topology readable. It also respects the documented fluo contract.

## 10.8 A full CQRS and saga flow in FluoShop

At v1.9.0, the order path now looks like this:

1. API dispatches `PlaceOrderCommand`.
2. `PlaceOrderHandler` validates and writes the order.
3. The write side publishes `OrderPlacedEvent`.
4. `OrderFulfillmentSaga` receives the event.
5. The saga dispatches `ReserveInventoryCommand`.
6. Inventory writes a reservation and publishes `InventoryReservedEvent`.
7. Another saga step dispatches `DispatchShipmentCommand`.
8. Shipment publishes `ShipmentDispatchedEvent`.
9. Notification and read-model handlers react.

This is the CQRS and saga story in one view. Writes are explicit. Reads are explicit. Cross-domain orchestration is explicit. That clarity matters more than the pattern label.

## 10.9 Read and write models should evolve separately

CQRS does not require separate databases. But it does require separate thinking. The write model should protect correctness. The read model should serve consumer needs. In FluoShop, support agents may need one denormalized view. Finance may need another. Operations may need a third. Trying to make one aggregate shape serve all of them usually creates accidental complexity. CQRS gives the team permission to stop doing that.

## 10.10 FluoShop v1.9.0 progression

At this stage, FluoShop is no longer just publishing domain events after writes. It now has a formal model for commands, queries, and long-running orchestration. That is a meaningful maturity step. The platform can speak more precisely about business intent. It can expose read models that match user needs. It can connect fulfillment steps without pretending everything belongs in one transaction. This prepares the system for the next two chapters. Queues will take slower work out of the immediate flow. Schedulers will manage periodic and delayed reactions with clear operational boundaries.

## 10.11 Summary

- `@fluojs/cqrs` separates writes, reads, and orchestration into explicit buses and handlers.
- commands and queries are point-to-point and should have exactly one handler.
- sagas listen for events and dispatch the next command in a long-running workflow.
- `CqrsEventBusService` delegates event distribution through `@fluojs/event-bus`, so CQRS builds on the event bus rather than replacing it.
- `SagaTopologyError` is a design warning that cyclic or over-deep in-process saga graphs need another boundary such as a queue or scheduler.

The main lesson is practical. CQRS is useful in FluoShop not because the acronym is fashionable. It is useful because the platform now needs explicit ownership for writes, explicit shaping for reads, and explicit orchestration between the two.
