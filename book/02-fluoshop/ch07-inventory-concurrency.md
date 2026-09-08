# What If Two People Buy the Last T-Shirt?

<!-- book:volume=02-fluoshop;chapter=07 -->

[Previous: Designing Orders as a State Machine](./ch06-order-state-machine.md) | [Volume 2 Contents](./toc.md) | [Next: Two Clicks on Buy, but Only One Order](./ch08-idempotent-checkout.md)

## The Sold-Out Display May Lag, but Sales Promises Must Not Overlap

As a new FluoBlog post is shared, more readers buy logo T-shirts. When only one black size M remains, two readers place orders at the same time. Each browser shows that it is in stock, and each request also reads a stock level of 1 on the server. If the server checks `available > 0` and each request then saves the stock as 0, there are two orders but a remaining quantity of 0. It looks safe because the number is not negative, yet we have already promised one T-shirt to two people.

The fact that Node.js executes JavaScript on one thread does not prevent this problem. A second request can run while the first waits for a database response, and two deployed instances run in different processes. Line order in code is not execution order across the whole system. Even if an in-process `Map` or mutex blocks the requests, another instance and an operator's database writes know nothing about that lock.

This chapter changes a read-decide-save structure into **a single statement that decrements stock only when its condition holds**. It also records the quantity secured while payment is pending in reservation rows. Order status and reservation state are separate. While an order is `pending_payment`, its reservation is `reserved`; when the order is cancelled, the reservation becomes `released`, and when payment is confirmed, it becomes `consumed`. The saleable quantity decremented at reservation time is not decremented again on consumption.

We still have one PostgreSQL database and one Fluo application. We do not start by introducing a Redis lock or a separate inventory server to obtain inventory consistency. First, we use atomic updates and transactions where the data is actually stored. The following implementation is application code for the developer-created `fluo-blog`, not a feature in which a Fluo package generates inventory models.

## Start by Naming the Inventory Number Precisely

`Stock.available` is not the total physical quantity in the warehouse. It is **the quantity that can be promised to new orders**. If 10 T-shirts arrive and 3 are reserved, the saleable quantity is 7. When those 3 become paid, the saleable quantity is still 7. It returns to 10 only when the reservation is cancelled. Receipt of a returned item after shipping is a separate stock receipt event, not a change of an old reservation to `released`.

Using `stock`, `count`, and `quantity` interchangeably without defining their meaning can lead to a double decrement: once at reservation and once at payment. More complex logistics may separate physical quantities, damaged quantities, and holdings by warehouse, but this sale covers only saleable quantities in one warehouse and reservations per order. A small, clear meaning for the number also makes contention tests clear.

The following are **additional models** for `prisma/schema.prisma`. Add the reverse field `reservations Reservation[]` to the previous chapter's `Order` model. Retain all other order fields, items, and transition records. SKUs use the ASCII identifiers normalized in the previous chapter. `Stock` does not duplicate pricing information from the existing product model.

```prisma
enum ReservationState {
  reserved
  released
  consumed
}

model Stock {
  sku          String        @id
  available    Int           @default(0)
  reservations Reservation[]
}

model Reservation {
  orderId   String
  sku       String
  quantity  Int
  state     ReservationState @default(reserved)
  expiresAt DateTime
  order     Order @relation(fields: [orderId], references: [id], onDelete: Restrict)
  stock     Stock @relation(fields: [sku], references: [sku], onDelete: Restrict)

  @@id([orderId, sku])
  @@index([state, expiresAt])
}
```

The composite primary key rejects two reservations for the same SKU in the same order. That alone does not prevent overselling, because different order IDs have different primary keys. Conversely, with only conditional stock decrements and no reservation rows, the process cannot know which orders should have their quantities returned after a restart. The two mechanisms prevent different failures.

The following is a **migration fragment** for this model. The reservation state ENUM restricts spelling, and SQL constraints restrict the meaning of the quantities. PostgreSQL's `integer` upper limit also applies, so do not assume that unlimited receipt quantities can be stored.

```sql
ALTER TABLE "Stock" ADD CONSTRAINT "Stock_available_check"
  CHECK ("available" >= 0);

ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_quantity_check"
  CHECK ("quantity" BETWEEN 1 AND 99);
```

## Establish the Lock Order: Orders, Then Stock

The inventory service reads stored order items when creating reservations. This prevents callers from passing a different set of SKUs or quantities from those on the order. It structurally reduces mistakes such as saving the pricing calculation's `quantity=2` on the order but passing `quantity=1` to the reservation call. The order creation use case calls `reserve(orderId)` immediately after creating the order and its items, within the same transaction.

The following is the **complete file** `src/inventory/inventory.service.ts`. It assumes the root's shared `BlogDatabaseModule` and a generated Prisma Client. `$queryRaw` is used as a tagged template, not through string concatenation. The part that locks the order row and reads database time is PostgreSQL-specific; we do not claim it works unchanged with another ORM or database.

```ts
import { Inject } from '@fluojs/core';
import { PrismaService, type PrismaServiceFacade } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';

export class OutOfStock extends Error {}
export class ReservationConflict extends Error {}

type LockedOrder = {
  status: string;
  now: Date;
};

@Inject(PrismaService)
export class InventoryService {
  constructor(private readonly prisma: PrismaServiceFacade<PrismaClient>) {}

  async reserve(orderId: string): Promise<void> {
    await this.prisma.transaction(async () => {
      const orders = await this.prisma.$queryRaw<LockedOrder[]>`
        SELECT "status", transaction_timestamp() AS "now"
        FROM "Order" WHERE "id" = ${orderId} FOR UPDATE
      `;
      const order = orders[0];
      if (!order || order.status !== 'pending_payment') {
        throw new ReservationConflict('Order cannot acquire a reservation.');
      }
      const items = await this.prisma.orderItem.findMany({
        where: { orderId },
        orderBy: { sku: 'asc' },
      });
      if (items.length === 0) {
        throw new ReservationConflict('An order must contain items.');
      }
      const existing = await this.prisma.reservation.count({ where: { orderId } });
      if (existing !== 0) {
        throw new ReservationConflict('Order already has reservation history.');
      }
      const expiresAt = new Date(order.now.getTime() + 15 * 60 * 1000);
      for (const item of items) {
        const changed = await this.prisma.stock.updateMany({
          where: { sku: item.sku, available: { gte: item.quantity } },
          data: { available: { decrement: item.quantity } },
        });
        if (changed.count !== 1) throw new OutOfStock(item.sku);
        await this.prisma.reservation.create({
          data: {
            orderId,
            sku: item.sku,
            quantity: item.quantity,
            state: 'reserved',
            expiresAt,
          },
        });
      }
    });
  }

  async settle(
    orderId: string,
    outcome: 'released' | 'consumed',
  ): Promise<number> {
    return this.prisma.transaction(async () => {
      const orders = await this.prisma.$queryRaw<LockedOrder[]>`
        SELECT "status", transaction_timestamp() AS "now"
        FROM "Order" WHERE "id" = ${orderId} FOR UPDATE
      `;
      const order = orders[0];
      const expected = outcome === 'released' ? 'cancelled' : 'paid';
      if (!order || order.status !== expected) {
        throw new ReservationConflict('Order and reservation outcome disagree.');
      }
      const rows = await this.prisma.reservation.findMany({
        where: { orderId },
        orderBy: { sku: 'asc' },
      });
      if (rows.length === 0) {
        throw new ReservationConflict('Reservation history is missing.');
      }
      let changedCount = 0;
      for (const row of rows) {
        if (row.state === outcome) continue;
        if (row.state !== 'reserved') {
          throw new ReservationConflict('Reservation has another final outcome.');
        }
        if (outcome === 'consumed' && row.expiresAt <= order.now) {
          throw new ReservationConflict('Reservation expired before confirmation.');
        }
        const changed = await this.prisma.reservation.updateMany({
          where: { orderId, sku: row.sku, state: 'reserved' },
          data: { state: outcome },
        });
        if (changed.count !== 1) {
          throw new ReservationConflict('Reservation changed concurrently.');
        }
        if (outcome === 'released') {
          await this.prisma.stock.update({
            where: { sku: row.sku },
            data: { available: { increment: row.quantity } },
          });
        }
        changedCount += 1;
      }
      return changedCount;
    });
  }
}
```

The key is that `available: { gte: item.quantity }` and `decrement` are part of one `UPDATE`. If two orders try to decrement the last unit simultaneously, PostgreSQL serializes writes to the same stock row. An update that runs after the first order commits reevaluates the quantity condition against the latest row, and gets an affected row count of 0 if stock is insufficient. The application must check that number. Returning reservation success merely because no exception was thrown defeats the purpose of the conditional update.

Locking the order row first prevents reservation creation, cancellation, and payment confirmation for the same order from interleaving. Multiple SKUs are always processed in the same sorted `sku` order. If order A locks the T-shirt first while order B locks the stickers first, a cycle can form in which each waits for the other's lock. A consistent order reduces the possibility of deadlock on this path. Other administrative paths must follow the same order, too; this is not a guarantee that deadlocks disappear from the entire system.

If the second SKU is out of stock after the first reservation row is created, the preceding decrement and reservation both roll back. Returning no per-product partial success is the current product policy. The reader confirmed the cart's bundle as one order. Ordering only part of it would require showing a new quote and getting consent again on the screen. Do not silently change that policy by catching `OutOfStock` inside the transaction and moving on to the next SKU.

`settle` does not return inventory first. It first checks whether the reservation can transition, and adds quantity only for rows that change from `reserved` to `released`. Repeating the operation skips rows already in `released`, so inventory does not increase twice. It rejects changing a `consumed` reservation to `released`. Refunds and restocking for paid goods are separate policies, not the same thing as retrying this method.

## Combine Reservation Expiration and Order Cancellation into One Business Operation

The database does not automatically return quantities when a reservation's time runs out. `expiresAt` is data used to make a decision. Deleting reservation rows with a TTL alone neither restores inventory nor preserves the reason for its return. This chapter implements the use case for expiring one order; deciding which orders to find and when to execute it remains the responsibility of a later chapter on scheduled jobs. We do not replace the core expiration logic with the name of a job scheduler.

The following is the **complete file** `src/orders/order-inventory.service.ts`. Ordinary cancellation and verified payment confirmation likewise change status and reservations together in the same outer transaction. The `confirmPayment` below does not call a real payment API. It is an internal connection point that accepts the trusted event defined in the previous chapter.

```ts
import { Inject } from '@fluojs/core';
import { PrismaService, type PrismaServiceFacade } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import { InventoryService } from '../inventory/inventory.service.js';
import { OrderTransitionsService } from './order-transitions.service.js';
import type { OrderActor } from './order-state.js';

@Inject(PrismaService, OrderTransitionsService, InventoryService)
export class OrderInventoryService {
  constructor(
    private readonly prisma: PrismaServiceFacade<PrismaClient>,
    private readonly transitions: OrderTransitionsService,
    private readonly inventory: InventoryService,
  ) {}

  async cancel(id: string, version: number, actor: OrderActor) {
    return this.prisma.transaction(async () => {
      const order = await this.transitions.apply(
        id, version, { type: 'cancel_requested' }, actor,
      );
      await this.inventory.settle(id, 'released');
      return order;
    });
  }

  async confirmPayment(
    id: string,
    version: number,
    currency: string,
    amountMinor: bigint,
    actor: OrderActor,
  ) {
    return this.prisma.transaction(async () => {
      const order = await this.transitions.apply(
        id, version, { type: 'payment_confirmed', currency, amountMinor }, actor,
      );
      await this.inventory.settle(id, 'consumed');
      return order;
    });
  }

  async expire(id: string): Promise<boolean> {
    return this.prisma.transaction(async () => {
      const rows = await this.prisma.$queryRaw<Array<{
        status: string;
        version: number;
        now: Date;
      }>>`
        SELECT "status", "version", transaction_timestamp() AS "now"
        FROM "Order" WHERE "id" = ${id} FOR UPDATE
      `;
      const order = rows[0];
      if (!order || order.status !== 'pending_payment') return false;
      const reservations = await this.prisma.reservation.findMany({
        where: { orderId: id },
      });
      if (
        reservations.length === 0 ||
        reservations.some(row =>
          row.state !== 'reserved' || row.expiresAt > order.now)
      ) return false;
      await this.transitions.apply(
        id,
        order.version,
        { type: 'cancel_requested' },
        { subject: 'system:reservation-expiry', scopes: ['orders:cancel'] },
      );
      await this.inventory.settle(id, 'released');
      return true;
    });
  }
}
```

Expiration rereads the status after acquiring the order lock. It does not trust only the list a scheduler found a few seconds earlier. If payment confirmation commits first, expiration sees `paid` and exits; if expiration commits first, payment confirmation is rejected by the state rules or version condition. This avoids partial states where only the order is cancelled while inventory remains tied up, or only inventory is returned while the order can still be paid.

Time comes from PostgreSQL's `transaction_timestamp()`, not each application instance's clock. This value is the start time of the current transaction. A long lock wait can reduce the actual usable reservation period, so order transactions must be short. Do not wait for network payment calls or additional user input inside this boundary. To promise 15 minutes on the screen, the server must return the stored expiration time and explain the basis for that promise.

Rejecting a late payment confirmation does not cancel an actual payment. If the external provider has already taken the money but the reservation has expired, the application needs reconciliation and a refund decision. No real payment is made in this chapter, so we reproduce this race using internal confirmation events. The following payment chapters add handling that retains discrepancies without losing external evidence. We do not describe a database transaction as rolling back an external payment as well.

The next two blocks are the **updated registration files** for `src/inventory/inventory.module.ts` and the previous chapter's `src/orders/orders.module.ts`. Both modules import the same `BlogDatabaseModule` object from `src/database/blog-database.module.ts`. Do not add `InventoryService` to `OrdersModule.providers` again and create a separate instance.

```ts
import { Module } from '@fluojs/core';
import { BlogDatabaseModule } from '../database/blog-database.module.js';
import { InventoryService } from './inventory.service.js';

@Module({
  imports: [BlogDatabaseModule],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
```

```ts
import { Module } from '@fluojs/core';
import { BlogDatabaseModule } from '../database/blog-database.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { OrderInventoryService } from './order-inventory.service.js';
import { OrderTransitionsService } from './order-transitions.service.js';

@Module({
  imports: [BlogDatabaseModule, InventoryModule],
  providers: [OrderTransitionsService, OrderInventoryService],
  exports: [OrderInventoryService],
})
export class OrdersModule {}
```

Other features now receive `OrderInventoryService` instead of a service that changes status alone. This makes it harder to omit inventory return when invoking cancellation. Internally, pure state decisions and the persistence service remain separate so that each invariant can be tested. A module's exports are also a contract expressing which business operations other features may use.

## Make Two Connections Contend for the Last Unit

An array-backed fake store cannot prove lock behavior. The following experiment requires PostgreSQL isolated from production, the migrations above, and a `FLUO-TEE-BLK-M` row with `available=1`. The person performing the exercise manages the data before and after the actual run. No database was created or modified for this manuscript; below are **SQL for a manual contention experiment** and the results to observe.

Run the following statements on the first connection, A, and leave the transaction open. The result must be one row with `available=0`.

```sql
BEGIN ISOLATION LEVEL READ COMMITTED;
UPDATE "Stock"
SET "available" = "available" - 1
WHERE "sku" = 'FLUO-TEE-BLK-M' AND "available" >= 1
RETURNING "available";
```

Run the same statements on the second connection, B. There should be no result yet because of the row lock held by A. Do not use elapsed waiting time as the success condition. A third observation connection can inspect the corresponding B session in `pg_stat_activity` and use `pg_blocking_pids` with B's PID to confirm that A is the blocker. Prepare observation permissions only within the development database.

```sql
BEGIN ISOLATION LEVEL READ COMMITTED;
UPDATE "Stock"
SET "available" = "available" - 1
WHERE "sku" = 'FLUO-TEE-BLK-M' AND "available" >= 1
RETURNING "available";
```

Executing `COMMIT;` on A must make B's update finish with 0 returned rows. Close B with `ROLLBACK;`. Conversely, prepare the experiment again with an initial quantity of 1 and issue `ROLLBACK;` on A; B must then be able to decrement one row. This is the difference between a committed reservation and a cancelled attempt. A TypeScript conditional that reads inventory first cannot control this execution order.

Application integration tests extend this principle to several invariants.

| Situation | Execution order or failure injection | Expected observation |
| --- | --- | --- |
| Last unit | Request reservations for two different orders simultaneously | One reservation succeeds, the other request gets `OutOfStock`, quantity is 0 |
| One item in a bundle is out of stock | The second SKU's condition fails after the first SKU is decremented | Both SKUs retain their original quantities; the order has 0 reservation rows |
| Duplicate return | Call `settle(id, 'released')` twice for a cancelled order | Only the first call has a positive state-change count; the second returns 0; quantity increases only once |
| Return after consumption | Attempt to return a payment-confirmed reservation | `ReservationConflict`; saleable quantity does not change |
| Rerun expiration | Store an `expiresAt` in the past, then call `expire` twice | The first call returns `true`, the next returns `false`; one cancellation audit row exists |
| Database error during return | Make the stock update fail after the reservation change | The reservation is still `reserved`; no partial return occurs |

Expiration tests do not require a 15-minute wait. Store test data with an `expiresAt` in the past relative to database time, wait for that commit, and then call `expire`. A row with a future time must return `false`. This is faster and deterministic, unlike sleeping for a fixed time and inferring the outcome. Concurrency tests need at least two working connections in the pool plus any required observation connection. A pool size of 1 can serialize all the code and hide defects.

## Stronger Locks Are Not Always Better

Running every order at `Serializable` is another option. But conflicts do not disappear: some transactions may end with serialization failures, requiring the application to retry the entire operation. Our current inventory invariant can be expressed as a conditional update on a specific row, so it can be explained using the default `ReadCommitted` level and short explicit locks. Revisit the choice when the entire read set affects the decision, such as a total-quantity constraint spanning several warehouses.

Retrying is not blindly calling a function that subtracts inventory one more time. You must establish whether the failed outer transaction rolled back completely and whether this is the same order creation intent. `@fluojs/prisma`'s `transaction` shares the active context, but does not automatically supply the application's deadlock retry policy or reservation idempotency. This chapter's `reserve` rejects an order that already has reservation history. Responsibility for purchase requests with an uncertain outcome belongs to the idempotency record in the next chapter.

It is acceptable for the saleable quantity on the screen to be temporarily wrong. If stock is insufficient when creating the order, return 409 and ask the customer to review the cart again. In contrast, reporting that an order succeeded and then contacting the customer to say the T-shirt was not actually available is a different level of failure. Row locks, reservation records, and expiration processing are the costs this chapter pays to keep that sales promise.

Now, when two readers try to buy the last unit simultaneously, only one gets a reservation. But a single reader clicking twice and creating two orders remains unsolved. If inventory is sufficient, both requests can legitimately secure quantities. In the next chapter, we identify the same purchase intent and complete a flow that returns the already-created order even when its response was lost.

## Evidence and Further Reading

- [Prisma module registration, facade, and manual transactions](../../packages/prisma/README.md)
- [Service transaction execution and termination boundaries](../../packages/prisma/src/service.ts)
- [Transaction options and client inference types](../../packages/prisma/src/types.ts)
- [Module, nested transaction, and strict mode tests](../../packages/prisma/src/module.test.ts)
- [Active transaction reuse and exception-based rollback contract](../../docs/architecture/transactions.md)
- [Order state and version control implementation from the previous chapter](./ch06-order-state-machine.md)

[Previous: Designing Orders as a State Machine](./ch06-order-state-machine.md) | [Volume 2 Contents](./toc.md) | [Next: Two Clicks on Buy, but Only One Order](./ch08-idempotent-checkout.md)
