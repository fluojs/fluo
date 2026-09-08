# Designing Orders as a State Machine

<!-- book:volume=02-fluoshop;chapter=06 -->

[Previous: Why You Cannot Trust Cart Prices](./ch05-cart-and-pricing.md) | [Volume 2 Contents](./toc.md) | [Next: What If Two People Buy the Last T-Shirt?](./ch07-inventory-concurrency.md)

## Changing a Status Field Changed What the Money Meant

Now that cart quotes are calculated on the server, we want to save orders. At first, the operator thinks a single `status` string will be enough. Set it to `pending_payment` when the customer enters the payment screen, to `paid` on success, and to `shipped` when the shipping staff processes it. But an unrestricted status-update API could change an order to `shipped` before any money has been received, or return an already dispatched order to `pending_payment`.

In practice, a collision between two management screens appears even sooner. Just as a reader clicks cancel on an order awaiting payment, the operator enters a payment confirmation. Both screens are looking at `pending_payment` from a few seconds earlier. If the last save wins, a payment-confirmed order may be overwritten as cancelled, or a cancelled order may come back to life as paid. Neither is a mere display error. It changes the decision about whether to issue a refund, return inventory, or begin shipping.

The state machine in this chapter is not a separate framework. It is **an application function that calculates the next state from an allowed event and the current state**. HTTP accepts commands and storage retains the results, but the decision about whether fulfillment may begin now belongs in `src/orders/order-state.ts`. Put this code in `OrdersModule` in the same FluoBlog application. Do not move accounts or posts, or split the order service into a separate process.

There is no payment-provider connection yet. Here, `payment_confirmed` is an internal event that a trusted payment boundary will deliver later, after verification. Do not turn a customer's `paid: true` into that event. This implementation separates permission to deliver an event from the transition rules, making such an incorrect connection visible.

## Keep Both the Current Order and the Reason for Its Transition

An order copies the previous chapter's quote into item snapshots. Once saved, do not reconstruct historical totals by joining the catalog's current prices. If a reissued receipt changes, you lose the evidence needed to explain it to the customer. `customerId` is the same user identifier as the subject from the existing blog authentication, not a new shop account. This example stores the subject's string representation as is. If the actual key in the existing account schema uses a different database type, retain that account mapping at the existing authentication boundary.

The following is a **partial model implementation** to add to `prisma/schema.prisma`. It does not replace the account and product models. Maintain the foreign-key policy for existing accounts separately, according to the account deletion and order retention policies; do not read the code below as a model that verifies an account's existence. An order item's SKU is a historical identifier. The order item remains even if the product is taken off sale or its description is deleted.

```prisma
enum OrderStatus {
  pending_payment
  paid
  fulfilling
  shipped
  cancelled
  refund_pending
  refunded
}

model Order {
  id         String            @id
  customerId String
  status     OrderStatus       @default(pending_payment)
  currency   String            @default("KRW")
  totalMinor BigInt
  version    Int               @default(0)
  items      OrderItem[]
  transitions OrderTransition[]
}

model OrderItem {
  orderId       String
  sku           String
  unitMinor     BigInt
  quantity      Int
  discountMinor BigInt
  lineTotalMinor BigInt
  order         Order @relation(fields: [orderId], references: [id], onDelete: Restrict)

  @@id([orderId, sku])
}

model OrderTransition {
  orderId    String
  version    Int
  from       OrderStatus
  to         OrderStatus
  eventName  String
  actorId    String
  occurredAt DateTime @default(now())
  order      Order @relation(fields: [orderId], references: [id], onDelete: Restrict)

  @@id([orderId, version])
}
```

`OrderTransition` is an audit record of status changes. We do not call it an event-sourcing store that reconstructs an order from all its events. It does not retain all external evidence from order creation, nor is it a payment ledger. Even so, it is more useful than a status row alone. It can answer who created order version 4 and through which event, and it lets us test the partial failure where a status change succeeds but its record is missing.

Put expressible invariants in the database, too. The following is a **migration fragment** for the models above. Equality between the order total and the sum of its items spans multiple rows, so these `CHECK` constraints alone cannot guarantee it. Order creation code must save the previous chapter's calculation result unchanged within the same transaction.

```sql
ALTER TABLE "Order" ADD CONSTRAINT "Order_values_check"
  CHECK ("currency" = 'KRW' AND "totalMinor" >= 0 AND "version" >= 0);

ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_values_check"
  CHECK (
    "quantity" BETWEEN 1 AND 99
    AND "unitMinor" >= 0
    AND "discountMinor" BETWEEN 0 AND "unitMinor"
    AND "lineTotalMinor" =
      ("unitMinor" - "discountMinor") * "quantity"
  );
```

Declaring a status as an ENUM restricts its spelling, not its transitions. The database knows that `pending_payment` and `shipped` are each valid values; it does not know the business meaning that payment confirmation and the start of fulfillment must come between them. The first design change, therefore, is to remove code that accepts a new status string over HTTP and passes it directly to `update`.

## Implement Event Conditions Instead of Merely Drawing Arrows

The current sales policy allows the transitions below. This table is not a decorative diagram; it is a specification to review against the code and tests. Do not use cancellation and refund as interchangeable terms. An order can be cancelled before money is received. After money is received, a refund must be requested, and only an actual refund confirmation allows the order to reach `refunded`.

| Current status | Internal event | Next status | Additional condition |
| --- | --- | --- | --- |
| `pending_payment` | `payment_confirmed` | `paid` | Currency and amount match the order snapshot |
| `pending_payment` | `cancel_requested` | `cancelled` | The requester has permission to cancel |
| `paid` | `fulfillment_started` | `fulfilling` | The fulfillment boundary decides to begin |
| `fulfilling` | `shipment_recorded` | `shipped` | A nonempty shipment reference exists |
| `paid` | `refund_requested` | `refund_pending` | A full refund before fulfillment begins |
| `refund_pending` | `refund_confirmed` | `refunded` | The confirmed refund amount and currency match |

The current policy does not allow an immediate refund once fulfillment has begun. Supporting returns and partial refunds requires adding whether logistics can be stopped, the result of collecting returned goods, and per-item refundable balances. Adding a shortcut from `fulfilling` to `cancelled` to avoid that cost hides the state of both money and goods. A small model with clear limits is better than a large collection of status strings that lets every exception succeed.

The following is the **complete file** `src/orders/order-state.ts`. The input state is a validated order read from storage, and events are internal values constructed to match their types at the application boundary. This is not a way to turn customer JSON into `OrderEvent` with a type assertion.

```ts
export type OrderStatus =
  | 'pending_payment'
  | 'paid'
  | 'fulfilling'
  | 'shipped'
  | 'cancelled'
  | 'refund_pending'
  | 'refunded';

export type OrderState = Readonly<{
  id: string;
  customerId: string;
  status: OrderStatus;
  currency: string;
  totalMinor: bigint;
  version: number;
}>;

export type OrderEvent =
  | { type: 'payment_confirmed'; currency: string; amountMinor: bigint }
  | { type: 'cancel_requested' }
  | { type: 'fulfillment_started' }
  | { type: 'shipment_recorded'; shipmentRef: string }
  | { type: 'refund_requested' }
  | { type: 'refund_confirmed'; currency: string; amountMinor: bigint };

export class OrderRuleError extends Error {}
export class OrderVersionConflict extends Error {}
export class OrderNotFound extends Error {}
export class OrderAccessDenied extends Error {}

export function decideTransition(
  order: OrderState,
  event: OrderEvent,
): OrderStatus {
  switch (event.type) {
    case 'payment_confirmed':
      if (
        order.status === 'pending_payment' &&
        event.currency === order.currency &&
        event.amountMinor === order.totalMinor
      ) return 'paid';
      break;
    case 'cancel_requested':
      if (order.status === 'pending_payment') return 'cancelled';
      break;
    case 'fulfillment_started':
      if (order.status === 'paid') return 'fulfilling';
      break;
    case 'shipment_recorded':
      if (order.status === 'fulfilling' && event.shipmentRef.trim().length > 0) {
        return 'shipped';
      }
      break;
    case 'refund_requested':
      if (order.status === 'paid') return 'refund_pending';
      break;
    case 'refund_confirmed':
      if (
        order.status === 'refund_pending' &&
        event.currency === order.currency &&
        event.amountMinor === order.totalMinor
      ) return 'refunded';
      break;
    default: {
      const unexpected: never = event;
      throw new OrderRuleError(`Unknown order event: ${String(unexpected)}`);
    }
  }
  throw new OrderRuleError(`Cannot apply ${event.type} to ${order.status}.`);
}

export type OrderActor = Readonly<{
  subject: string;
  scopes: readonly string[];
}>;

export function authorizeOrderEvent(
  order: OrderState,
  event: OrderEvent,
  actor: OrderActor,
): void {
  if (
    (event.type === 'cancel_requested' || event.type === 'refund_requested') &&
    actor.subject === order.customerId
  ) return;
  const scope: Record<OrderEvent['type'], string> = {
    payment_confirmed: 'payments:confirm',
    cancel_requested: 'orders:cancel',
    fulfillment_started: 'orders:fulfill',
    shipment_recorded: 'orders:fulfill',
    refund_requested: 'orders:refund',
    refund_confirmed: 'payments:refund-confirm',
  };
  if (!actor.scopes.includes(scope[event.type])) {
    throw new OrderAccessDenied('Order action is not permitted.');
  }
}
```

The function returns only the next status because it has no authority to touch items or prices. It does not overwrite the entire order with request values through something like `Object.assign(order, payload)`. Amount comparison also checks exact equality of the currency and integer value, not whether the numbers are approximately the same. A confirmation of USD 28,000 received for a KRW 28,000 order must not mark it as paid.

The permission names in `authorizeOrderEvent` are not scopes reserved by Fluo. They are application policy extending the blog's authentication result. Customers may request cancellation or refunds only for their own orders, while only an internal boundary with `payments:confirm` permission may deliver payment confirmation. Having a scope does not make an arbitrary amount acceptable. Even after the permission check passes, the state rules check the amount and transition again.

If a duplicate `payment_confirmed` arrives for `paid`, this function throws an error. Not treating it as success simply because the status is the same is deliberate. The current status alone cannot distinguish a retransmission of the same payment notification from another payment having occurred. Later, a boundary that stores payment-provider event IDs must identify the same event and handle replay. Do not hide duplicate payments by adding unconditional success to the state machine.

## Close the Gap Between Decision and Persistence with a Version

Even if the pure function is correct, another request may change the order just before it is saved. The solution is to include the version read for the decision in the write condition. The following is the **complete file** `src/orders/order-transitions.service.ts`. It requires the existing root-owned `BlogDatabaseModule` and the Prisma models defined here. This service owns only status and audit records. Do not interpret it as also sending payments or returning inventory.

```ts
import { Inject } from '@fluojs/core';
import { PrismaService, type PrismaServiceFacade } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import {
  OrderNotFound,
  OrderRuleError,
  OrderVersionConflict,
  authorizeOrderEvent,
  decideTransition,
  type OrderActor,
  type OrderEvent,
} from './order-state.js';

@Inject(PrismaService)
export class OrderTransitionsService {
  constructor(private readonly prisma: PrismaServiceFacade<PrismaClient>) {}

  async apply(
    id: string,
    expectedVersion: number,
    event: OrderEvent,
    actor: OrderActor,
  ) {
    if (
      !Number.isInteger(expectedVersion) ||
      expectedVersion < 0 ||
      expectedVersion >= 2_147_483_647
    ) {
      throw new OrderRuleError('Invalid order version.');
    }
    return this.prisma.transaction(async () => {
      const current = await this.prisma.order.findUnique({ where: { id } });
      if (!current) throw new OrderNotFound(id);
      authorizeOrderEvent(current, event, actor);
      if (current.version !== expectedVersion) {
        throw new OrderVersionConflict(id);
      }
      const next = decideTransition(current, event);
      const changed = await this.prisma.order.updateMany({
        where: { id, version: expectedVersion, status: current.status },
        data: { status: next, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new OrderVersionConflict(id);
      await this.prisma.orderTransition.create({
        data: {
          orderId: id,
          version: expectedVersion + 1,
          from: current.status,
          to: next,
          eventName: event.type,
          actorId: actor.subject,
        },
      });
      return { ...current, status: next, version: expectedVersion + 1 };
    });
  }
}
```

Here, the entire service method is wrapped in an explicit `transaction`. The transaction makes the two writes atomic, while `where.version` prevents an outdated decision from overwriting a newer one. Neither replaces the other. Reading inside a `ReadCommitted` transaction does not eliminate the possibility that two requests see the same version.

When the second request's conditional update runs after the first has changed version 0 to 1, the second receives an affected row count of 0. That request ends with an exception and creates no audit record. Conversely, if the update succeeds but insertion of the audit row fails, the entire transaction rolls back. Catching the error and returning `{ ok: false }` would let the callback end normally and could commit the preceding update, so propagate failures as exceptions within the database atomicity boundary.

The following is the **registration file for this stage**, `src/orders/orders.module.ts`. Later chapters add the order creation service and inventory module to this same module. We are not creating several parallel `OrdersModule` implementations.

```ts
import { Module } from '@fluojs/core';
import { BlogDatabaseModule } from '../database/blog-database.module.js';
import { OrderTransitionsService } from './order-transitions.service.js';

@Module({
  imports: [BlogDatabaseModule],
  providers: [OrderTransitionsService],
  exports: [OrderTransitionsService],
})
export class OrdersModule {}
```

The root `src/app.ts` imports this module alongside the existing account, post, and product modules. The HTTP adapter for status transitions maps `OrderNotFound` to 404, `OrderAccessDenied` to 403, and `OrderVersionConflict` and transition rejection by `OrderRuleError` to 409. The adapter first rejects malformed requests with 400. The application `Error` classes above do not become Fluo HTTP exceptions merely because of their names.

One important boundary remains. Do not expose the current `apply` as a customer-facing endpoint for executing every kind of event. A cancellation route constructs `cancel_requested` on the server, and the payment confirmation boundary supplies verified amounts. Later, the cancellation use case with inventory return calls the status change and return together inside an outer transaction. This service's nested `transaction` reuses the active context of the same Prisma registration. Do not change that intent by giving each internal method different isolation options.

## Test More Forbidden Paths Than Successful Ones

The following is the **complete pure test file** `src/orders/order-state.test.ts`. These are synchronous function tests, so they need neither delays nor a database. Run the two built files with Node.js 24's `node --test`. The tests verify returned statuses, error types, and permission denial, not descriptive strings.

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OrderAccessDenied,
  OrderRuleError,
  authorizeOrderEvent,
  decideTransition,
  type OrderState,
  type OrderStatus,
} from './order-state.js';

const order: OrderState = {
  id: 'order-1',
  customerId: 'reader-1',
  status: 'pending_payment',
  currency: 'KRW',
  totalMinor: 28_000n,
  version: 0,
};

test('accepts matching payment but rejects amount and currency mismatches', () => {
  assert.equal(decideTransition(order, {
    type: 'payment_confirmed', currency: 'KRW', amountMinor: 28_000n,
  }), 'paid');
  for (const event of [
    { type: 'payment_confirmed' as const, currency: 'KRW', amountMinor: 1n },
    { type: 'payment_confirmed' as const, currency: 'USD', amountMinor: 28_000n },
  ]) {
    assert.throws(() => decideTransition(order, event), OrderRuleError);
  }
});

test('never allows cancellation after payment', () => {
  const states: OrderStatus[] = [
    'paid', 'fulfilling', 'shipped', 'cancelled', 'refund_pending', 'refunded',
  ];
  for (const status of states) {
    assert.throws(
      () => decideTransition({ ...order, status }, { type: 'cancel_requested' }),
      OrderRuleError,
    );
  }
});

test('requires a shipment reference and a confirmed refund', () => {
  assert.throws(() => decideTransition(
    { ...order, status: 'fulfilling' },
    { type: 'shipment_recorded', shipmentRef: ' ' },
  ), OrderRuleError);
  assert.equal(decideTransition(
    { ...order, status: 'paid' }, { type: 'refund_requested' },
  ), 'refund_pending');
  assert.equal(decideTransition(
    { ...order, status: 'refund_pending' },
    { type: 'refund_confirmed', currency: 'KRW', amountMinor: 28_000n },
  ), 'refunded');
});

test('ownership does not grant permission to confirm payment', () => {
  const actor = { subject: order.customerId, scopes: [] };
  assert.doesNotThrow(() =>
    authorizeOrderEvent(order, { type: 'cancel_requested' }, actor));
  assert.throws(() => authorizeOrderEvent(order, {
    type: 'payment_confirmed', currency: 'KRW', amountMinor: 28_000n,
  }, actor), OrderAccessDenied);
});
```

Contention tests must use real PostgreSQL. Create one version-0 order awaiting payment in a development-only database, then execute cancellation and payment confirmation from two connections with the same `expectedVersion=0`. Regardless of which starts first, exactly one status change must succeed, exactly one audit row must exist, and the final version must be 1. Running the two requests sequentially can also verify rejection of a stale version, but that result alone does not establish that lock contention was tested.

For a stronger reproduction, have both connections signal a test barrier after finishing their reads, and only then allow both updates to proceed. Do not use a delay on the assumption that both will have read within 100ms. In a separate test, prepare development data that makes insertion into `OrderTransition` fail with a constraint violation. After execution, the order's status and version must also remain at their original values. The PostgreSQL tests in this chapter are reproduction procedures and expected results; this manuscript does not include results from running them against an actual connection.

## Do Not Compress Every Fact into a Single Status

It may be tempting to add a name such as `stock_reserved_and_payment_started` to the order status. But orders, inventory reservations, and payment attempts progress at different rates. A reservation may expire on an order awaiting payment, or a late payment confirmation may arrive for a cancelled order. Putting all of this into one ENUM multiplies the combinations and blurs which feature has authority to change the status.

This chapter restricts only the business stages of an order. Each boundary must take responsibility for whether an inventory reservation actually exists, whether a payment-provider notification is authentic, and whether a shipping record corresponding to the shipment reference has been saved. Checking that `shipmentRef` is not empty is different from proving an actual shipment. A later shipping use case will combine persistence of the shipping record with this transition. The honest limit of this structure is that a state machine does not automatically move money or goods.

Not every system needs an audit table or a state machine library from the start. Two conditionals were enough for small posts with only draft and published states. FluoShop has a separate file and audit records because the parties changing status have expanded to include customers, the payment boundary, and fulfillment staff, and the cost of an incorrect overwrite has grown. The time to introduce a new pattern is when the invariants to protect increase, not when the module count increases.

The next chapter moves to a question still unanswered. Even perfect enforcement of order statuses can leave us promising the last T-shirt to two orders. We will implement what must be secured atomically before saving `pending_payment`, and how to return it exactly once when cancelling a reservation.

## Evidence and Further Reading

- [Amount calculation and snapshot contract from the previous chapter](./ch05-cart-and-pricing.md)
- [Shared order fields and status names](../EDITORIAL.md)
- [Prisma service transaction and nested boundary contracts](../../packages/prisma/README.md)
- [Transaction execution implementation](../../packages/prisma/src/service.ts), [module and transaction tests](../../packages/prisma/src/module.test.ts)
- [HTTP exception constructors and actual status codes](../../packages/http/src/exceptions.ts)
- [Explicit class injection and module registration](../../packages/core/README.md)

[Previous: Why You Cannot Trust Cart Prices](./ch05-cart-and-pricing.md) | [Volume 2 Contents](./toc.md) | [Next: What If Two People Buy the Last T-Shirt?](./ch07-inventory-concurrency.md)
