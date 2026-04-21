<!-- packages: @fluojs/event-bus, @fluojs/redis -->
<!-- project-state: FluoShop v1.8.0 -->

# 9. Event Bus and Domain Events

Part 2 starts where Part 1 left off. FluoShop already knows how to move messages across many transports. What it still needs is a clean way to react inside the application boundary after important business facts occur. That is the job of the event bus. This chapter shifts attention from transport choice to domain reaction design. The focus is no longer which broker carries the bytes. The focus is how one local business action can trigger several follow-up behaviors without hardwiring services together.

## 9.1 Why the event bus matters after Part 1

Transport diversity solved communication between processes. It did not solve coordination inside one process. FluoShop now has checkout, inventory, notifications, analytics, and compliance concerns that all care about the same moments. An order can be placed once, but many components may need to react. Sending a confirmation email is one reaction. Updating a dashboard is another. Recording an audit trail is another. Publishing all of those through direct service calls would make the write path brittle. The `@fluojs/event-bus` package gives FluoShop a simpler shape. One component publishes a domain event, many handlers can subscribe, and each handler stays focused on its own concern.

## 9.2 Domain events in FluoShop v1.8.0

By v1.8.0, FluoShop treats important business facts as explicit event classes.

These events are not random log messages.

They represent state changes the business cares about.

Examples include:

- `OrderPlacedEvent`
- `InventoryReservedEvent`
- `ShipmentDispatchedEvent`
- `RefundApprovedEvent`

This naming matters.

Commands express intent.

Events express something that already happened.

That difference keeps the model honest.

### 9.2.1 Event classes and stable keys

The package README recommends stable event keys when channel names must survive renames or minification. That is a practical rule for FluoShop. Long-lived commerce systems should not let event routing depend on class names alone.

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

The event key becomes part of the contract. It gives operators and downstream systems a stable label. It also makes future versioning more deliberate.

### 9.2.2 Module wiring with Redis fan-out

The default event bus is in-process. That is enough for many module boundaries. FluoShop also wants optional cross-process fan-out for horizontally scaled services. The package README documents Redis transport support for that case.

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

This is an important architectural boundary. The event bus API stays stable. Only the transport behind it changes. That continuity matches the broader fluo design philosophy from earlier chapters.

## 9.3 Publish from the write boundary

The most common mistake with events is publishing them from everywhere. FluoShop avoids that. It publishes domain events close to successful write completion. That means after the system is confident the state change actually happened. In practice, this often means an application service or command handler publishes after the transaction settles.

### 9.3.1 OrderPlacedEvent flow

Consider the checkout write path. The customer confirms the cart. Checkout persists the order. Only then does it publish `OrderPlacedEvent`.

```typescript
import { Inject } from '@fluojs/core';
import { EventBusLifecycleService } from '@fluojs/event-bus';

export class CheckoutService {
  @Inject(EventBusLifecycleService)
  private readonly eventBus: EventBusLifecycleService;

  async placeOrder(input: PlaceOrderInput) {
    const order = await this.orders.create(input);

    await this.eventBus.publish(
      new OrderPlacedEvent(order.id, order.customerId, order.totalAmount),
    );

    return order;
  }
}
```

This keeps the write path explicit. The service still owns the state change. The side effects are delegated.

### 9.3.2 Why this is better than chained service calls

Without events, Checkout might call Notifications directly. Then Analytics directly. Then Audit directly. Each new concern would lengthen the write path. Each dependency would make failures and tests more tangled. With events, Checkout only states one fact, and the rest of the system reacts independently. That lowers coupling without hiding intent.

## 9.4 Multiple handlers, one business fact

The event bus is intentionally one-to-many.

That is the opposite of command routing.

A single event can have several handlers because several parts of the platform may legitimately care.

### 9.4.1 Notification reaction

The Notification Service listens for `OrderPlacedEvent` and sends a receipt.

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

Analytics also listens for the same event.

It updates conversion counters and revenue dashboards.

```typescript
export class OrderAnalyticsHandler {
  @OnEvent(OrderPlacedEvent)
  async projectRevenue(event: OrderPlacedEvent) {
    await this.metrics.recordOrder(event.orderId, event.totalAmount);
  }
}
```

### 9.4.3 Audit reaction

Compliance may need the same fact for traceability.

```typescript
export class OrderAuditHandler {
  @OnEvent(OrderPlacedEvent)
  async recordAudit(event: OrderPlacedEvent) {
    await this.audit.append('order.placed', event);
  }
}
```

None of these handlers needs to know about the others.

That independence is the whole point.

## 9.5 In-process first, distributed when needed

The package README describes the default model as in-process with optional external transport adapters. That is a healthy default. FluoShop should not reach for distributed event fan-out just because the option exists. Local delivery is simpler, easier to reason about, and has fewer moving parts. When one application instance hosts the relevant modules, in-process delivery is often enough. Distributed transport becomes useful when reactions must cross process boundaries. For example, Checkout may run separately from Notifications. Or analytics projectors may scale independently. Redis fan-out lets the same event model bridge that deployment topology.

## 9.6 Event bus flow in FluoShop

At v1.8.0, the simplest mental model is this:

1. Checkout accepts a successful order write.
2. Checkout publishes `OrderPlacedEvent`.
3. Local and distributed handlers react.
4. Notifications send customer messages.
5. Analytics projects read-side counters.
6. Audit stores compliance evidence.

This flow is intentionally asymmetric.

One write becomes many reactions.

That is not accidental complexity.

That is the shape of a real commerce platform.

## 9.7 Operational rules for domain events

Domain events need discipline. FluoShop follows a few practical rules. First, event names should describe completed facts. Second, payloads should contain enough context for downstream handling without leaking entire aggregates by default. Third, versioned event keys should change deliberately when contracts break. Fourth, handlers should be idempotent whenever duplicate distributed delivery is possible. Fifth, events should not become a back door for hidden synchronous dependencies. These rules keep the event bus useful instead of mystical.

## 9.8 FluoShop v1.8.0 progression

Part 1 taught FluoShop how to speak across boundaries. This chapter teaches it how to react cleanly within and across bounded contexts. That is the bridge into event-driven architecture. The system is no longer defined only by request paths. It is increasingly defined by the facts it emits and the reactions those facts trigger. That makes later patterns possible. CQRS will build on this. Queues will build on this. Scheduled background orchestration will build on this.

## 9.9 Summary

- `@fluojs/event-bus` gives FluoShop a clear one-to-many reaction model for domain events.
- event classes should represent completed business facts, not future intent.
- stable `eventKey` values help preserve routing contracts across refactors.
- in-process publish and subscribe is the default, while Redis transport extends the same model across processes.
- FluoShop v1.8.0 now publishes order and fulfillment facts that several modules can react to independently.

The deeper lesson is architectural. When one write creates many legitimate follow-up actions, the right design is usually not a longer service chain. It is an explicit event with explicit subscribers.
