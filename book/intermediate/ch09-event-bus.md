<!-- packages: @fluojs/event-bus, @fluojs/redis -->
<!-- project-state: FluoShop v1.8.0 -->

# Chapter 9. Event Bus and Domain Events

This chapter introduces an event bus to FluoShop so we can build a domain reaction model on top of the transport choices from Part 1. Chapter 8 organized service-to-service contracts. Here, we shift the focus to keeping the write boundary firm even when one business fact fans out into several follow-up actions.

## Learning Objectives
- Understand why an event bus becomes necessary after transport diversity.
- Explain the role difference between domain events and commands.
- Design a flow that publishes events from the write boundary and separates side effects.
- Analyze a structure where multiple handlers react independently to one business fact.
- Summarize the criteria for choosing between in-process delivery and Redis fan-out.
- Explain why stable event keys and idempotent handler rules matter in FluoShop.

## Prerequisites
- Completion of Chapter 1, Chapter 2, Chapter 3, Chapter 4, Chapter 5, Chapter 6, Chapter 7, and Chapter 8.
- Basic understanding of business events and asynchronous follow-up processing.
- Basic intuition for module boundaries and distributed fan-out.

## 9.1 Why the event bus matters after Part 1

Transport diversity solved communication between processes. It doesn't solve coordination inside a process. In FluoShop, checkout, inventory, notifications, analytics, and compliance now care about the same business fact. An order is created only once, but several components may need to react. Sending a confirmation email, refreshing a dashboard, and recording an audit trail are different reactions. If all of these are wired together through direct service calls, the write path quickly becomes fragile. The `@fluojs/event-bus` package gives FluoShop a simpler shape. One component publishes a domain event, multiple handlers subscribe to it, and each handler focuses only on its own concern.

## 9.2 Domain events in FluoShop v1.8.0

FluoShop v1.8.0 treats important business facts as explicit event classes. These events aren't arbitrary log messages. They represent state changes the business truly cares about. Examples include:

- `OrderPlacedEvent`
- `InventoryReservedEvent`
- `ShipmentDispatchedEvent`
- `RefundApprovedEvent`

This naming matters. A command expresses intent. An event expresses something that has already happened. That distinction keeps the model honest.

### 9.2.1 Event classes and stable keys

The package README recommends stable event keys when channel names must survive renaming or minification. For FluoShop, this is a practical rule. A long-running commerce system shouldn't depend only on class names for event routing.

```typescript
export class OrderPlacedEvent {
  static readonly eventKey = 'fluoshop.order.placed.v1';

  constructor(
    public readonly orderId: string,
    public readonly customerId: string,
    public readonly totalAmount: number,
  ) {}
}
```

This event key becomes part of the contract. It gives operators and downstream systems a stable label, and it makes future versioning more intentional.

### 9.2.2 Module wiring with Redis fan-out

The default event bus is in-process. That is enough for many module boundaries. FluoShop, however, also needs optional cross-process fan-out between horizontally scaled services. The package README documents Redis transport support for this case.

```typescript
import { Module } from '@fluojs/core';
import { EventBusModule } from '@fluojs/event-bus';
import { RedisEventBusTransport } from '@fluojs/event-bus/redis';

@Module({
  imports: [
    EventBusModule.forRoot({
      transport: new RedisEventBusTransport({
        publishClient: redis,
        subscribeClient: redisSubscriber,
      }),
    }),
  ],
  providers: [
    OrderNotificationsHandler,
    OrderAnalyticsHandler,
    OrderAuditHandler,
  ],
})
export class OrderEventsModule {}
```

This boundary matters. The event bus API stays the same, and only the transport behind it changes. That continuity matches the fluo design philosophy we saw in earlier chapters.

## 9.3 Publish from the write boundary

The most common mistake with events is publishing them from anywhere. FluoShop doesn't do that. It publishes domain events close to successful write completion. In other words, it publishes after the system is confident that the state change really happened. In a real implementation, an application service or command handler often publishes after the transaction has been settled.

### 9.3.1 OrderPlacedEvent flow

Think about the checkout write path. A customer confirms a cart. Checkout stores the order. Only then does it publish `OrderPlacedEvent`.

```typescript
import { Inject } from '@fluojs/core';
import { EventBusLifecycleService } from '@fluojs/event-bus';

@Inject(EventBusLifecycleService)
export class CheckoutService {
  constructor(private readonly eventBus: EventBusLifecycleService) {}

  async placeOrder(input: PlaceOrderInput) {
    const order = await this.orders.create(input);

    await this.eventBus.publish(
      new OrderPlacedEvent(order.id, order.customerId, order.totalAmount),
    );

    return order;
  }
}
```

This keeps the write path explicit. The service still owns the state change, while side effects are delegated.

### 9.3.2 Why this is better than chained service calls

Without events, Checkout could call Notifications directly. Then it could call Analytics, and then Audit. Every time a new concern is added, the write path gets longer. Each dependency makes failure handling and testing more complex. With events, Checkout states a single fact and the rest of the system reacts independently. This lowers coupling without hiding intent.

## 9.4 Multiple handlers, one business fact

An event bus is intentionally one-to-many. This is the opposite of command routing. A single event can have multiple handlers because several parts of the platform can legitimately care about the same fact.

### 9.4.1 Notification reaction

Notification Service listens for `OrderPlacedEvent` and sends a receipt. The checkout flow does not need to wait for email delivery directly, so order recording and customer communication stay loosely connected.

```typescript
import { OnEvent } from '@fluojs/event-bus';

export class OrderNotificationsHandler {
  @OnEvent(OrderPlacedEvent)
  async sendReceipt(event: OrderPlacedEvent) {
    await this.email.sendOrderReceipt(event.orderId, event.customerId);
  }
}
```

### 9.4.2 Analytics reaction

Analytics also subscribes to the same event. It updates conversion counters and the revenue dashboard, and that reaction remains a read-side projection separated from order storage responsibility.

```typescript
export class OrderAnalyticsHandler {
  @OnEvent(OrderPlacedEvent)
  async projectRevenue(event: OrderPlacedEvent) {
    await this.metrics.recordOrder(event.orderId, event.totalAmount);
  }
}
```

### 9.4.3 Audit reaction

Compliance may need the same fact for traceability. This handler does not change the customer experience, but it quietly leaves the evidence needed to explain the order flow later.

```typescript
export class OrderAuditHandler {
  @OnEvent(OrderPlacedEvent)
  async recordAudit(event: OrderPlacedEvent) {
    await this.audit.append('order.placed', event);
  }
}
```

These handlers don't need to know about each other. That independence is the point.

## 9.5 In-process first, distributed when needed

The package README describes the default model as in-process and says an external transport adapter can be added when needed. That is a healthy default. FluoShop shouldn't choose distributed event fan-out just because the option exists. Local delivery is simpler, easier to understand, and has fewer moving parts. When related modules live together in one application instance, in-process delivery is often enough. Distributed transport becomes useful when reactions need to cross a process boundary. For example, Checkout and Notifications may run as separate processes. Or an analytics projector may scale independently. Redis fan-out extends the same event model over that deployment topology.

## 9.6 Event bus flow in FluoShop

In v1.8.0, the simplest mental model is:

1. Checkout accepts a successful order write.
2. Checkout publishes `OrderPlacedEvent`.
3. Local and distributed handlers react.
4. Notifications sends the customer message.
5. Analytics projects read-side counters.
6. Audit stores compliance evidence.

This flow is intentionally asymmetric. One write expands into multiple reactions. This isn't accidental complexity. It is the shape of a real commerce platform.

## 9.7 Operational rules for domain events

Domain events need discipline. FluoShop follows a few practical rules. First, the event name should describe a completed fact. Second, the payload should carry enough context for downstream handlers to act, but it generally shouldn't leak the whole aggregate. Third, a versioned event key should change intentionally only when the contract breaks. Fourth, if duplicate distributed delivery is possible, handlers must be idempotent. Fifth, an event must not become a back door for hidden synchronous dependencies. These rules keep the event bus an operational tool, not a vague mechanism.

## 9.8 FluoShop v1.8.0 progression

Part 1 organized how FluoShop communicates across boundaries. This chapter covers how to organize reactions inside and outside a bounded context. This is the bridge into event-driven architecture. The system is no longer defined only by request paths. Increasingly, it is defined by the facts it emits and the reactions those facts trigger. That makes the next patterns possible. CQRS is built on top of this. Queues are built on top of this. Scheduled background orchestration is built on top of this.

## 9.9 Summary

- `@fluojs/event-bus` gives FluoShop a clear one-to-many reaction model for domain events.
- An event class should represent a completed business fact, not future intent.
- Stable `eventKey` values help preserve routing contracts across refactors.
- In-process publish and subscribe is the default, while Redis transport extends the same model beyond process boundaries.
- FluoShop v1.8.0 now publishes order and fulfillment facts that multiple modules can react to independently.

The deeper lesson is architectural. When one write creates several legitimate follow-up actions, the right design usually isn't a longer service chain. It is an explicit event with explicit subscribers.
