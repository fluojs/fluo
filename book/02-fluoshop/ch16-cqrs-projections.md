# Write Models and Read Models Develop Different Needs

<!-- book:volume=02-fluoshop;chapter=16 -->

[Previous: Running Failed Jobs Again](./ch15-reliable-jobs.md) | [Volume 2 Contents](./toc.md) | [Next: Coordinating Multiple Stages of Order Processing](./ch17-order-sagas.md)

## Questions About Changing Orders and Questions About Showing Them

After ordering a T-shirt with the same account, a FluoBlog reader checks the progress of that order. The operator wants to group paid orders and see which to pack first. Both screens read order data, but their questions differ from those the code changing orders must answer. The order state machine determines whether an order can be cancelled at its current version. The customer screen provides a short response showing the amount ordered and how far the order has progressed.

Querying `Order` directly is enough at first. Creating screen-specific tables before there is a performance problem only adds synchronization and recovery costs. But as payment, fulfillment preparation, and notification preparation status accumulate on the operations screen, every request must follow all the write model's relationships. The object returned by the order service starts differing by screen, and read optimization starts changing the write boundary. At that point, there is a reason to design a separate read model.

CQRS separates command and query responsibilities. `@fluojs/cqrs` connects that intent through classes and handlers discovered during bootstrap. Separate databases, event sourcing, and microservices are not prerequisites. We keep one PostgreSQL database and the existing modular monolith. Nor do we rewrite all existing order creation, payment, and inventory code as commands. We begin with one query path for order summaries and an internal command that updates those summaries.

In this chapter, `Order` remains the source of current state. We do not introduce event sourcing, which constructs source state by replaying event records alone. The previous chapter's Outbox records only payment facts, not a history capable of fully reconstructing every order change. Establishing that distinction first makes it clear where to rebuild a damaged projection from.

## The Consistency Contract for a Screen-Specific Row

The following is the complete model to add to `prisma/schema.prisma`. Keep the other models. We assume the order owner, `customerId`, does not change after order creation. Physically deleting order records for account withdrawal or personal data handling is governed by a policy separate from this chapter's recovery experiments.

```prisma
model OrderSummary {
  id          String   @id
  customerId  String
  status      String
  currency    String
  totalMinor  BigInt
  version     Int
  projectedAt DateTime @default(now())

  @@index([customerId, id])
}
```

`id` is the source order ID, and `version` is the source order version reflected in the row. Since `Order.version` starts at 0, a version 0 summary of an order awaiting payment is valid too. Distinguish it from `Post.version`, which starts at 1, the Outbox envelope format `v1`, and the queue's `dispatchVersion`. `projectedAt` is when the projection was updated, not the payment or shipping time. The source of the payment transition time is `OrderTransition.occurredAt`, also copied to the Outbox in Chapter 14. Reusing one timestamp for different meanings merely because storage is cheap leads to incorrect answers to support inquiries.

Add the following to the end of the SQL created by `pnpm exec prisma migrate dev --name add_order_summary --create-only`, then run `pnpm exec prisma migrate dev` and `pnpm exec prisma generate` in the isolated DB. Preserve the models and custom constraints from Chapters 14-15.

```sql
ALTER TABLE "OrderSummary"
  ADD CONSTRAINT "OrderSummary_values_check"
    CHECK ("currency" = 'KRW' AND "totalMinor" >= 0 AND "version" >= 0),
  ADD CONSTRAINT "OrderSummary_status_check"
    CHECK ("status" IN (
      'pending_payment', 'paid', 'fulfilling', 'shipped',
      'cancelled', 'refund_pending', 'refunded'
    ));
```

This model serves a minimal query: a customer's order summary. Do not fill operations-list priorities or expected shipping dates with invented data now. As required fields grow, first establish which feature is authoritative for each field. One order version cannot represent the freshness of multiple independent owners, such as payments and fulfillment, either. Because the current summary consists only of fields from `Order`, its version comparison can remain simple.

An asynchronous projection may lag briefly. That does not justify promising that updates always finish within a fixed time. If a user has just received a write result with order version 6, let them request a minimum version of 6 when querying. If the summary is at version 5, return `pending` rather than presenting an old value as the latest result. The user can distinguish "the summary is being updated" from a failed operation. Decisions affecting money and state transitions, such as whether cancellation is allowed, must be checked again against the source order rather than this projection.

## Preventing Reordered Updates from Restoring an Older Screen

Calling `upsert()` in event arrival order can let a version 4 payment confirmation overwrite version 6 fulfillment preparation. Reading and comparing the version before an unconditional update also races when two workers run concurrently. Put the comparison and update in one database statement.

Create `src/orders/read-model/order-summary.store.ts` as the following complete file. `OrderSnapshot` contains only the source fields this projection actually consumes. It does not automatically expose other fields.

```typescript
import { Inject } from '@fluojs/core';
import { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';

export interface OrderSnapshot {
  id: string;
  customerId: string;
  status: string;
  currency: string;
  totalMinor: bigint;
  version: number;
}

@Inject(PrismaService)
export class OrderSummaryStore {
  constructor(private readonly db: PrismaService<PrismaClient>) {}

  async apply(snapshot: OrderSnapshot): Promise<void> {
    await this.db.current().$executeRaw`
      INSERT INTO "OrderSummary"
        ("id", "customerId", "status", "currency", "totalMinor",
         "version", "projectedAt")
      VALUES
        (${snapshot.id}, ${snapshot.customerId}, ${snapshot.status},
         ${snapshot.currency}, ${snapshot.totalMinor}, ${snapshot.version}, NOW())
      ON CONFLICT ("id") DO UPDATE SET
        "customerId" = EXCLUDED."customerId",
        "status" = EXCLUDED."status",
        "currency" = EXCLUDED."currency",
        "totalMinor" = EXCLUDED."totalMinor",
        "version" = EXCLUDED."version",
        "projectedAt" = EXCLUDED."projectedAt"
      WHERE "OrderSummary"."version" < EXCLUDED."version"
    `;
  }

  async refresh(orderId: string): Promise<number | null> {
    const order = await this.db.current().order.findUnique({
      where: { id: orderId },
      select: {
        id: true, customerId: true, status: true, currency: true,
        totalMinor: true, version: true,
      },
    });
    if (!order) return null;
    await this.apply(order);
    return order.version;
  }

  async repairBatch(): Promise<number> {
    const missing = await this.db.current().$queryRaw<Array<{ id: string }>>`
      SELECT o."id" FROM "Order" o
      LEFT JOIN "OrderSummary" s ON s."id" = o."id"
      WHERE s."id" IS NULL OR s."version" < o."version"
      ORDER BY o."id"
      LIMIT 100
    `;
    for (const order of missing) await this.refresh(order.id);
    return missing.length;
  }
}
```

Here, the complete snapshot at version 6 can construct the summary without receiving intermediate versions. We therefore apply version 6 even if it arrives immediately after version 4, and ignore version 5 when it arrives later. For an incremental event such as "add 1 to the quantity," skipping version 5 could be wrong. Distinguish this overwrite rule for **complete snapshots** from a universal solution to all event processing.

`refresh()` reads the current source order rather than writing the old `paid` state carried by a signal unchanged. If a late payment signal arrives after the order has already become `fulfilling`, it builds the latest state. Another change may occur immediately after the read. In that case, it briefly reflects an older version, but it never moves an already newer summary backward. A later signal or `repairBatch()` finds the remaining difference.

`repairBatch()` also recovers when an event never arrives. It limits each run to 100 items; even if the result is 100, do not loop indefinitely within the same HTTP request. A repeatedly failing row can block a run at that point, so observe the last success time and failing order ID. As data grows, measure this comparison query's execution plan and read cost, and consider a change watermark or a separate table of update intents. The current implementation is a baseline for establishing correctness at the product's current scale.

## Connecting Command and Event Handlers

The following `src/orders/read-model/refresh-order-summary.ts` is a complete file. The command instructs the projection to refresh; it does not change the customer's order state. `Refresh` in the name keeps it distinct from a payment command.

```typescript
import { Inject } from '@fluojs/core';
import {
  CommandBusLifecycleService,
  CommandHandler,
  EventHandler,
  type CqrsDispatchContext,
  type ICommand,
  type ICommandHandler,
  type IEventHandler,
} from '@fluojs/cqrs';
import { OrderPaidEvent } from '../events/order-paid.event.js';
import { OrderSummaryStore } from './order-summary.store.js';

export class RefreshOrderSummaryCommand implements ICommand {
  constructor(public readonly orderId: string) {}
}

@Inject(OrderSummaryStore)
@CommandHandler(RefreshOrderSummaryCommand)
export class RefreshOrderSummaryHandler
  implements ICommandHandler<RefreshOrderSummaryCommand, number | null>
{
  constructor(private readonly store: OrderSummaryStore) {}

  execute(command: RefreshOrderSummaryCommand): Promise<number | null> {
    return this.store.refresh(command.orderId);
  }
}

@Inject(CommandBusLifecycleService)
@EventHandler(OrderPaidEvent)
export class PaidOrderProjectionHandler implements IEventHandler<OrderPaidEvent> {
  constructor(private readonly commands: CommandBusLifecycleService) {}

  async handle(
    event: OrderPaidEvent,
    context?: CqrsDispatchContext,
  ): Promise<void> {
    await this.commands.execute<RefreshOrderSummaryCommand, number | null>(
      new RefreshOrderSummaryCommand(event.orderId),
      context,
    );
  }
}
```

The method on a `@CommandHandler` class is `execute`; the method on an `@EventHandler` class is `handle`. Both must be registered as singleton providers to be discovered. Each command must have one handler. An event, in contrast, can trigger multiple handlers under different provider tokens. Do not turn an operation needing a return value into an event and design around obtaining "the last handler's result."

`context` is an opaque value passed along a chain of internal CQRS calls. Forward it unchanged rather than constructing an object yourself or inspecting its contents. For now, the chain simply goes from an event to a command, but the same rule preserves execution phases and shutdown tracking when it reaches the Saga in the next chapter. Creating a new `{}` because the type looks like an empty TypeScript interface does not pass along the same runtime context.

## Expressing Lag in Query Results

Create `src/orders/read-model/get-order-summary.ts` as the following complete file. The summary's JSON response converts the amount to a decimal string. It validates allowed state names instead of propagating arbitrary state strings. This prevents values from an old schema or an incorrect direct DB edit from masquerading as normal responses.

```typescript
import { Inject } from '@fluojs/core';
import {
  QueryHandler,
  type IQuery,
  type IQueryHandler,
} from '@fluojs/cqrs';
import { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';

type OrderStatus =
  | 'pending_payment' | 'paid' | 'fulfilling' | 'shipped'
  | 'cancelled' | 'refund_pending' | 'refunded';

export type OrderSummaryResult =
  | { kind: 'not_found' }
  | { kind: 'pending'; observedVersion: number | null }
  | {
      kind: 'ready';
      order: {
        id: string;
        status: OrderStatus;
        currency: 'KRW';
        totalMinor: string;
        version: number;
      };
    };

function parseStatus(value: string): OrderStatus {
  switch (value) {
    case 'pending_payment':
    case 'paid':
    case 'fulfilling':
    case 'shipped':
    case 'cancelled':
    case 'refund_pending':
    case 'refunded':
      return value;
    default:
      throw new Error('Invalid order status in projection');
  }
}

export class GetOrderSummaryQuery implements IQuery<OrderSummaryResult> {
  readonly __queryResultType__?: OrderSummaryResult;

  constructor(
    public readonly orderId: string,
    public readonly customerId: string,
    public readonly minimumVersion: number = 0,
  ) {}
}

@Inject(PrismaService)
@QueryHandler(GetOrderSummaryQuery)
export class GetOrderSummaryHandler
  implements IQueryHandler<GetOrderSummaryQuery, OrderSummaryResult>
{
  constructor(private readonly db: PrismaService<PrismaClient>) {}

  async execute(query: GetOrderSummaryQuery): Promise<OrderSummaryResult> {
    const source = await this.db.current().order.findFirst({
      where: { id: query.orderId, customerId: query.customerId },
      select: { id: true },
    });
    if (!source) return { kind: 'not_found' };
    const row = await this.db.current().orderSummary.findFirst({
      where: { id: query.orderId, customerId: query.customerId },
    });
    if (!row || row.version < query.minimumVersion) {
      return { kind: 'pending', observedVersion: row?.version ?? null };
    }
    if (row.currency !== 'KRW' || row.totalMinor < 0n) {
      throw new Error('Invalid money in projection');
    }
    return {
      kind: 'ready',
      order: {
        id: row.id,
        status: parseStatus(row.status),
        currency: row.currency,
        totalMinor: row.totalMinor.toString(),
        version: row.version,
      },
    };
  }
}
```

`customerId` is not a value trusted from the request body. It comes from the JWT subject verified by the existing authentication boundary. This handler queries both source and summary with the same owner condition. It classifies another customer's order as `not_found` too, so it does not reveal whether an order ID exists. There is not yet a GET route connecting this internal result type to an HTTP response. Chapter 8's `OrdersController` handles only POST, so we now add a read-only controller.

The short source query to verify ownership remains deliberately. We do not claim that introducing a projection completely separates us from the source DB. We separate expensive relationship assembly while keeping customer isolation and existence checks explicit. A larger system with a trusted, separate authorization index could remove this query, but would then need to address that index's lag and deletion propagation.

`minimumVersion` is a condition for the response the caller is waiting for, not a command for the server to wait forever. Customers pass the version from their write response. This handler immediately classifies and returns the current state. An arbitrarily large number does not warrant adding a wait loop or source mutation inside the query handler. The customer screen's requery policy is a separate, bounded UI behavior; state changes remain the responsibility of commands or the existing order service.

## Connecting an Authenticated GET to the Actual Query Bus

The following is the **complete file** `src/orders/read-model/order-summary-input.ts`. `@FromPath` and `@FromQuery` bind values; they do not replace integer validation. Repeated query parameters, in particular, can be arrays, so reject them instead of choosing the first value. An omitted minimum version is 0. An explicit value must be `0` or a decimal integer without leading zeroes, within the Prisma `Int` range of 0-2,147,483,647. Empty strings, signs, whitespace, fractions, exponential notation, and out-of-range values produce 400.

```typescript
import { BadRequestException, FromPath, FromQuery, Optional } from '@fluojs/http';

export class OrderSummaryInput {
  @FromPath('id') id: unknown = '';
  @FromQuery('minimumVersion') @Optional() minimumVersion: unknown = undefined;
}

export function parseMinimumVersion(value: unknown): number {
  if (value === undefined) return 0;
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,9})$/.test(value)) {
    throw new BadRequestException('minimumVersion must be a non-negative decimal integer.');
  }
  const version = Number(value);
  if (version > 2_147_483_647) {
    throw new BadRequestException('minimumVersion exceeds the order version range.');
  }
  return version;
}
```

`src/orders/order-summary.controller.ts` is also a **complete file**. Do not move or delete the existing `OrdersController.create()`. The two controllers share the `/orders` prefix but own GET and POST respectively. `blog-jwt` is Volume 1's existing strategy, which also validates active accounts and authVersion. Pass only `context.principal.subject`, never a customer ID from the body or query.

```typescript
import { Inject } from '@fluojs/core';
import { QueryBusLifecycleService } from '@fluojs/cqrs';
import {
  BadRequestException, Controller, Get, Header, RequestDto,
  UnauthorizedException, type RequestContext,
} from '@fluojs/http';
import { UseAuth } from '@fluojs/passport';
import {
  GetOrderSummaryQuery, type OrderSummaryResult,
} from './read-model/get-order-summary.js';
import {
  OrderSummaryInput, parseMinimumVersion,
} from './read-model/order-summary-input.js';

@Controller('/orders')
@Inject(QueryBusLifecycleService)
export class OrderSummaryController {
  constructor(private readonly queries: QueryBusLifecycleService) {}

  @Get('/:id')
  @UseAuth('blog-jwt')
  @Header('Cache-Control', 'private, no-store')
  @RequestDto(OrderSummaryInput)
  async get(input: OrderSummaryInput, context: RequestContext): Promise<OrderSummaryResult> {
    const subject = context.principal?.subject;
    if (!subject) throw new UnauthorizedException();
    if (typeof input.id !== 'string' || input.id.length === 0) {
      throw new BadRequestException('Order ID is required.');
    }
    const minimumVersion = parseMinimumVersion(input.minimumVersion);
    const result = await this.queries.execute<GetOrderSummaryQuery, OrderSummaryResult>(
      new GetOrderSummaryQuery(input.id, subject, minimumVersion),
    );
    switch (result.kind) {
      case 'ready':
        context.response.setStatus(200);
        return result;
      case 'pending':
        context.response.setStatus(202);
        return result;
      case 'not_found':
        context.response.setStatus(404);
        return result;
      default: {
        const unexpected: never = result;
        throw new Error(`Unexpected order summary result: ${String(unexpected)}`);
      }
    }
  }
}
```

The response body uses `OrderSummaryResult` unchanged. A 200 response is `{ kind: 'ready', order }`, with the amount already a decimal string. A 202 response is `{ kind: 'pending', observedVersion }`. If the source order exists but no summary does, the observed version is `null`; if the summary lags behind the minimum version, it is the current summary version. Here, 202 means waiting for an existing projection to catch up, not acceptance of a new payment or order operation. The response does not itself create new work; the repair task described earlier finds missing updates.

Both a missing order and another customer's order return the same 404 body, `{ kind: 'not_found' }`. This GET does not return a separate 403 for another person's order. Missing, expired, or mismatched credentials are handled as 401 by the existing authentication strategy and guard. Authentication store failures, strategy registration errors, missing query handlers, and Prisma errors are not authentication failures; do not catch them in the controller and convert them to 401 or 404. Leave them as 5xx responses at the existing error-handling boundary.

## Change the Publication Path Instead of Adding Another Bus

`CqrsModule.forRoot()` also registers the event-bus to which it delegates. Do not keep the existing `EventBusModule.forRoot()` in `src/app.ts` while adding another independent root bus. Replace that registration with the following, retaining the existing Redis, Queue, Cron, and feature modules. For the DB, import the same `BlogDatabaseModule` value from `src/database/blog-database.module.ts` once at the root. Preserve that asynchronous global registration's `AppSettings` factory and `strictTransactions: true`; do not create a read-specific `DatabaseModule` or separate Prisma registration.

```typescript
import { CqrsModule } from '@fluojs/cqrs';

const cqrs = CqrsModule.forRoot({
  eventBus: {
    publish: { waitForHandlers: true, timeoutMs: 500 },
    shutdown: { drainTimeoutMs: 5_000 },
  },
  shutdown: { drainTimeoutMs: 5_000 },
});
```

Add `cqrs` to the existing root imports. The following `src/orders/orders.module.ts` registration combines Chapter 8's POST, Chapter 13's preview, and this chapter's query. Import `AuthModule` directly so both controllers can resolve the existing strategy. Preserve any other providers and exports already added to the app. Use the root's global `BlogDatabaseModule` for the DB rather than registering it here again.

```typescript
import { Module } from '@fluojs/core';
import { AuthModule } from '../auth/auth.module.js';
import { CartModule } from '../cart/cart.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { CheckoutService } from './checkout.service.js';
import { OrderInventoryService } from './order-inventory.service.js';
import { OrderTransitionsService } from './order-transitions.service.js';
import { OrdersController } from './orders.controller.js';
import { OrderSummaryController } from './order-summary.controller.js';
import { PaidPreviewListener, PaidPreviewStore } from './paid-preview.js';
import { OrderSummaryStore } from './read-model/order-summary.store.js';
import {
  PaidOrderProjectionHandler,
  RefreshOrderSummaryHandler,
} from './read-model/refresh-order-summary.js';
import { GetOrderSummaryHandler } from './read-model/get-order-summary.js';
import { OrderSummaryRepairTask } from './read-model/order-summary-repair-task.js';

@Module({
  imports: [AuthModule, CartModule, InventoryModule],
  controllers: [OrdersController, OrderSummaryController],
  providers: [
    CheckoutService,
    OrderTransitionsService,
    OrderInventoryService,
    PaidPreviewStore,
    PaidPreviewListener,
    OrderSummaryStore,
    RefreshOrderSummaryHandler,
    PaidOrderProjectionHandler,
    GetOrderSummaryHandler,
    OrderSummaryRepairTask,
  ],
  exports: [
    OrderInventoryService, OrderTransitionsService, PaidPreviewStore, OrderSummaryStore,
  ],
})
export class OrdersModule {}
```

The existing `OrdersModule` import in the root `AppModule` now exposes GET too. Register `GetOrderSummaryHandler` as a CQRS provider and `OrderSummaryController` as an HTTP controller. Do not move the query handler into the controller list or register `CqrsModule` again in OrdersModule. The idempotency, authentication, and 201 response of `POST /orders` remain in Chapter 8's controller.

The more important change is the previous chapter's relay publication path. Calling the existing `EventBusLifecycleService.publish()` does not automatically run `@EventHandler`. The following gives **the exact three replacements** in Chapter 14's complete `src/notifications/paid-outbox-relay.ts` file. Keep the existing `deliverNext()` body, `OrderPaidEvent` import, and `await this.events.publish(event)`.

```diff
-import { EventBusLifecycleService } from '@fluojs/event-bus';
+import { CqrsEventBusService } from '@fluojs/cqrs';

-@Inject(PrismaService, EventBusLifecycleService)
+@Inject(PrismaService, CqrsEventBusService)
 export class PaidOutboxRelay {
   constructor(
     private readonly db: PrismaService<PrismaClient>,
-    private readonly events: EventBusLifecycleService,
+    private readonly events: CqrsEventBusService,
   ) {}
```

The full publication path runs from `PaymentLedger.record` through `PaidOrderOutbox` to `PaidOutboxRelay`. After committing the Inbox and `ReceiptRequest`, the relay sends the same original envelope through `CqrsEventBusService.publish()`. `PaidOrderProjectionHandler` dispatches `RefreshOrderSummaryCommand`, which reaches `OrderSummaryStore.refresh()` to read the current source order; finally, the delegated bus's existing `PaidPreviewListener` reacts. Independently, `ReceiptDispatchTask` hands off through `RenderReceiptJob` and `RenderReceiptWorker` to `ReceiptService.prepare()` to process the persistent request. The receipt worker does not update the projection, and successful projection is not a prerequisite for queue handoff.

Do not register `OrderEventsPublisher`, removed in Chapter 14, again, or attach CQRS publication to PaymentLedger. `OrderPaidEvent.orderVersion` remains fixed at the payment transition version. If the relay runs late and the source order is already `refunded`, `refresh()` reads that latest version and state. Preserve the distinct responsibilities: the receipt is a past payment snapshot, and the summary is the current order.

The current CQRS publication order is matching `@EventHandler` handlers, Sagas, and then the delegated event-bus. A CQRS event handler failure fails publication without proceeding to the next stages. This differs from the previous chapter's local failure isolation for `@OnEvent`. CQRS does not automatically roll back DB changes made by handlers that already ran either. If one of several handlers fails and the event is redelivered, previously successful handlers can run again, so the version condition remains necessary.

A CQRS publication failure after the relay has committed the Inbox handoff does not undo that DB handoff. `deliveredAt` means the receipt consumer's handoff is complete, not that projection is complete. Receipt work remains discoverable, and `repairBatch()` recovers the projection. The following **complete file**, `src/orders/read-model/order-summary-repair-task.ts`, owns that call. Since it was registered above as a provider in the same OrdersModule, it creates no reverse dependency on the payment module or NotificationsModule. The one existing Cron registration discovers this task too.

```typescript
import { Inject } from '@fluojs/core';
import { Cron, CronExpression } from '@fluojs/cron';
import { OrderSummaryStore } from './order-summary.store.js';

@Inject(OrderSummaryStore)
export class OrderSummaryRepairTask {
  constructor(private readonly store: OrderSummaryStore) {}

  @Cron(CronExpression.EVERY_MINUTE, {
    name: 'orders.summary-repair',
    timezone: 'UTC',
  })
  async run(): Promise<void> {
    await this.store.repairBatch();
  }
}
```

Starting with the first scheduled run after restart, it compares source and summary. Version 0 orders that have never had a payment event, as well as later cancellation, refund, and shipping transitions, are all candidates. Existing business services still own writing the source state, version, and `OrderTransition`. This task only repairs the projection; it does not modify inventory or the payment ledger. A manual rebuild tool can also call the exported `OrderSummaryStore.repairBatch()` outside a transaction in bounded runs. Events help reduce lag, while periodic comparison recovers missing updates.

## Checking Ownership and Lag at the HTTP Entry Point

In your running app, set `ACCESS_TOKEN` to the access token from Volume 1's `/auth/login` response and `ORDER_ID` to the order ID from Chapter 8's `POST /orders` response. The following requests actually reach the controller above. A minimum version of 0 must allow queries for new orders too. The result is 200 if the summary is ready and 202 if it is not yet present; after the first repair run creates the summary, the same request returns 200. A request without a token returns 401, and an authenticated request with an out-of-range minimum version returns 400.

```bash
: "${ACCESS_TOKEN:?Set the access token returned by POST /auth/login}"
: "${ORDER_ID:?Set the id returned by POST /orders}"
curl -i "http://localhost:3000/orders/$ORDER_ID?minimumVersion=0" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
curl -i "http://localhost:3000/orders/$ORDER_ID"
curl -i "http://localhost:3000/orders/$ORDER_ID?minimumVersion=2147483648" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

The following `src/orders/read-model/order-summary.http.test.ts` is a **complete request test file**. It uses the actual controller, DTO, QueryBus, query handler, `BlogJwtStrategy`, and `BlogTokenAuthenticator`. Only storage is replaced with narrow read doubles; it does not inject an authentication result through `principal()`. The test therefore fails if GET registration, JWT authentication, DTO binding, or query handler wiring is missing. It explicitly defines source and summary state for each case rather than waiting for delays or scheduled tasks. Run it with the existing Vitest configuration that applies standard decorator transformation.

```typescript
import assert from 'node:assert/strict';
import { Module } from '@fluojs/core';
import { CqrsModule } from '@fluojs/cqrs';
import { DefaultJwtSigner, JwtModule, type JwtVerifierOptions } from '@fluojs/jwt';
import { PassportModule } from '@fluojs/passport';
import { PrismaService } from '@fluojs/prisma';
import { createTestApp } from '@fluojs/testing';
import { test } from 'vitest';
import { AccountsService } from '../../accounts/accounts.service.js';
import { BlogJwtStrategy } from '../../auth/blog-jwt.strategy.js';
import { BlogTokenAuthenticator } from '../../auth/blog-token-authenticator.js';
import { OrderSummaryController } from '../order-summary.controller.js';
import { GetOrderSummaryHandler } from './get-order-summary.js';

type Case = Readonly<{
  name: string;
  subject?: string;
  minimumVersion?: string | string[];
  orderId?: string;
  missingSummary?: boolean;
  failure?: 'auth' | 'query';
  status: number;
}>;
const cases: readonly Case[] = [
  { name: 'defaults to version zero', subject: 'reader-7', status: 200 },
  { name: 'accepts explicit zero', subject: 'reader-7', minimumVersion: '0', status: 200 },
  { name: 'reports a stale projection', subject: 'reader-7', minimumVersion: '1', status: 202 },
  { name: 'reports a missing projection', subject: 'reader-7', missingSummary: true, status: 202 },
  { name: 'accepts the Int maximum', subject: 'reader-7', minimumVersion: '2147483647', status: 202 },
  { name: 'rejects Int overflow', subject: 'reader-7', minimumVersion: '2147483648', status: 400 },
  { name: 'rejects a negative version', subject: 'reader-7', minimumVersion: '-1', status: 400 },
  { name: 'rejects a fractional version', subject: 'reader-7', minimumVersion: '1.5', status: 400 },
  { name: 'rejects an empty version', subject: 'reader-7', minimumVersion: '', status: 400 },
  { name: 'rejects leading zeroes', subject: 'reader-7', minimumVersion: '01', status: 400 },
  { name: 'rejects repeated versions', subject: 'reader-7', minimumVersion: ['0', '1'], status: 400 },
  { name: 'hides another customer order', subject: 'reader-8', status: 404 },
  { name: 'reports an absent order', subject: 'reader-7', orderId: 'missing', status: 404 },
  { name: 'requires authentication', status: 401 },
  { name: 'preserves authentication store failures', subject: 'reader-7', failure: 'auth', status: 500 },
  { name: 'preserves query store failures', subject: 'reader-7', failure: 'query', status: 500 },
];

for (const scenario of cases) {
  test(scenario.name, async () => {
    const source = {
      id: 'order-16', customerId: 'reader-7', status: 'pending_payment',
      currency: 'KRW', totalMinor: 29000n, version: 0,
    };
    type Lookup = { where: { id: string; customerId: string } };
    const belongs = ({ where }: Lookup) =>
      where.id === source.id && where.customerId === source.customerId;
    const db = {
      current: () => ({
        order: {
          async findFirst(input: Lookup) {
            if (scenario.failure === 'query') throw new Error('Order store unavailable');
            return belongs(input) ? source : null;
          },
        },
        orderSummary: {
          async findFirst(input: Lookup) {
            return !scenario.missingSummary && belongs(input) ? source : null;
          },
        },
      }),
    };
    const accounts = {
      async findActiveSubject(id: string) {
        if (scenario.failure === 'auth') throw new Error('Account store unavailable');
        return { id, displayName: 'Reader', authVersion: 1 };
      },
    };
    const jwt: JwtVerifierOptions = {
      algorithms: ['HS256'], secret: 'order-summary-test-key-not-for-production',
      issuer: 'fluo-blog', audience: 'fluo-blog-web',
      accessTokenTtlSeconds: 900, requireExp: true, clockSkewSeconds: 0,
    };
    @Module({
      imports: [
        CqrsModule.forRoot(),
        JwtModule.forRoot(jwt),
        PassportModule.forRoot(
          { defaultStrategy: 'blog-jwt', global: true },
          [{ name: 'blog-jwt', token: BlogJwtStrategy }],
        ),
      ],
      controllers: [OrderSummaryController],
      providers: [
        BlogTokenAuthenticator, BlogJwtStrategy, GetOrderSummaryHandler,
        { provide: PrismaService, useValue: db },
        { provide: AccountsService, useValue: accounts },
      ],
    })
    class ReadRouteTestModule {}

    const app = await createTestApp({ rootModule: ReadRouteTestModule });
    try {
      const request = app.request('GET', `/orders/${scenario.orderId ?? source.id}`)
        .query('customerId', 'reader-7');
      if (scenario.subject) {
        const token = await new DefaultJwtSigner(jwt).signAccessToken({
          sub: scenario.subject, authVersion: 1,
        });
        request.header('Authorization', `Bearer ${token}`);
      }
      if (scenario.minimumVersion !== undefined) {
        request.query('minimumVersion', scenario.minimumVersion);
      }
      const response = await request.send();
      assert.equal(response.status, scenario.status);
      if (scenario.status === 200) {
        assert.deepEqual(response.body, {
          kind: 'ready',
          order: {
            id: source.id, status: 'pending_payment', currency: 'KRW',
            totalMinor: '29000', version: 0,
          },
        });
      } else if (scenario.status === 202) {
        assert.deepEqual(response.body, {
          kind: 'pending', observedVersion: scenario.missingSummary ? null : 0,
        });
      } else if (scenario.status === 404) {
        assert.deepEqual(response.body, { kind: 'not_found' });
      }
    } finally {
      await app.close();
    }
  }, 5_000);
}
```

```bash
pnpm exec vitest run src/orders/read-model/order-summary.http.test.ts
```

Every case sends `customerId=reader-7` in the query, but a `reader-8` token must still receive 404. This verifies that the server uses the authenticated principal. The test crosses the HTTP boundary but does not connect to PostgreSQL or the actual account DB. The SQL experiments below verify persistence consistency in a separate isolated DB.

## Demonstrating Reordering and Missing Updates with Real SQL

Run the following experiments in isolated PostgreSQL with the schema applied. `store` is the actual `OrderSummaryStore`, and `query` is the actual `GetOrderSummaryHandler`. A source order fixture with the same ID and `customerId` must exist first. The amount and ID in `base` match that fixture. The following is a test-body fragment sharing this environment and using Vitest's `expect`.

```typescript
const base = {
  id: 'order-16',
  customerId: 'reader-7',
  currency: 'KRW',
  totalMinor: 29000n,
};
await store.apply({ ...base, status: 'paid', version: 1 });
await store.apply({ ...base, status: 'shipped', version: 3 });
await store.apply({ ...base, status: 'fulfilling', version: 2 });
await store.apply({ ...base, status: 'paid', version: 1 });

expect(await query.execute(
  new GetOrderSummaryQuery('order-16', 'reader-7', 3),
)).toEqual({
  kind: 'ready',
  order: {
    id: 'order-16',
    status: 'shipped',
    currency: 'KRW',
    totalMinor: '29000',
    version: 3,
  },
});
expect(await query.execute(
  new GetOrderSummaryQuery('order-16', 'reader-7', 4),
)).toEqual({ kind: 'pending', observedVersion: 3 });
expect(await query.execute(
  new GetOrderSummaryQuery('order-16', 'another-reader', 0),
)).toEqual({ kind: 'not_found' });
```

The sequential experiment checks reordering; a variation applying versions 2 and 3 with `Promise.all()` across two independent connections checks a race. The final result must be version 3 regardless of which starts first. Reimplementing the same comparison in a simple Map mock does not verify whether PostgreSQL's `ON CONFLICT ... WHERE` actually prevents the race.

For the missing-update experiment, do not publish an event at all. Update the isolated fixture's source order through a legal transition, increasing its version, and run `repairBatch()` once. If the fixture places the target order within the batch limit, the summary should advance to the new version. An empty summary table can be recovered the same way. This checks rebuildability with test data; it is not an experiment that empties an operational table.

In a separate fixture, call `refresh()` for a `pending_payment` source order at version 0 and verify that `GetOrderSummaryQuery(id, customerId, 0)` returns `ready`. This catches implementations that treat version 0 as meaning the summary does not yet exist. When the summary row truly is absent, in contrast, the result must be `pending` with `observedVersion: null`.

For the full handoff test, prepare an isolated DB and Redis, then pass through the relay, dispatcher, and actual worker in sequence after Chapter 14's successful ledger operation. Subscribe to the worker's completion signal before enqueue and verify one Outbox, one Inbox, and one ReceiptRequest for the same event ID. The projection must contain the source's current version, not a state guessed from the bus. In the next variation, fail only the relay's `CqrsEventBusService.publish()` and check that the persistent handoff remains, and that the independent `ReceiptDispatchTask` and `OrderSummaryRepairTask` recover the receipt and summary respectively. Use actual method completion and explicit failure injection rather than fixed delays to arrange execution order.

The registration experiment starts the CQRS graph with actual `FluoFactory.create(rootModule)` and executes the query above through the query bus. Its purpose differs from the earlier experiment that simply constructs the handler directly. Removing the query handler from providers must fail with `QueryHandlerNotFoundException`, and having two providers own the same query must cause a duplicate error during bootstrap. CQRS does not discover handler decorators on controllers as substitutes for provider registration, so do not hide handler implementations inside HTTP controllers.

Distinguish request experiments crossing the HTTP boundary from verification of real DB consistency. Prisma schema generation, migrations, and PostgreSQL integration experiments in your application are not results executed in this manuscript. Real DB verification requires Node24, pnpm10, a generated PrismaClient, and an isolated DB. An HTTP test using storage doubles does not also prove PostgreSQL's `ON CONFLICT` or locking behavior.

## Rebuild Costs and the Next Boundary

A model that can be rebuilt from its source may appear easy to discard, but rebuilding in production races with the screens readers are using. It also matters that when you add fields to a new summary format, the current SQL does not update rows at the same version. Simply rerunning `repairBatch()` after a format change may leave the new fields unfilled. Populate a separate new projection table, compare it, and switch the read path, or design an explicit projection format version and rebuild procedure. Do not arbitrarily increase the source order version to simulate a screen migration.

Operators need to observe projection lag alongside average query speed. They need the number of orders with differing source and summary versions, the oldest change not yet reflected, and rebuild failure counts. A recent `projectedAt` alone does not mean every order is current. One continually updated order can hide overall lag. Personal data deletion or order retention policies also require a separate path to remove rows from the projection when they disappear from the source. This chapter handles insertion and increasing versions under a contract that retains orders.

Introducing CQRS does not require a projection for every screen. A single-item check that must be current immediately after an update is better served by reading the source. There is no reason to move all uncomplicated post CRUD into buses and handlers either. What we gain is a boundary that prevents screen requirements from displacing write invariants; what we pay for is expressing lag, synchronization, recovery, and operational observation.

The customer-facing summary now cannot move backward when old events arrive, and it can be rebuilt from the source when events are missing. Payment and reservation consumption have already completed in the same ledger transaction. Later flows in which multiple stages wait for one another's results, such as fulfillment preparation, shipping handoff, and failure compensation, cannot be coordinated by a projection alone. In the next chapter, we examine how far CQRS Sagas help connect those stages, and where the application must store order progress that needs to continue after a restart. Do not reinterpret an already `consumed` reservation as still `reserved` until shipping.

## Implementation References

- [CQRS usage, projections, and publication order contracts](../../packages/cqrs/README.md)
- [Public exports](../../packages/cqrs/src/index.ts), [command/query/event types](../../packages/cqrs/src/types.ts)
- [Delegated event-bus registration implementation](../../packages/cqrs/src/module.ts)
- [Event pipeline](../../packages/cqrs/src/buses/event-bus.ts), [query dispatch implementation](../../packages/cqrs/src/buses/query-bus.ts)
- [Single-handler, failure, and discovery contract tests](../../packages/cqrs/src/module.test.ts)
- [Event fan-out and ordering tests](../../packages/cqrs/src/event-fanout-contract.test.ts)
- [Prisma transaction and current contracts](../../packages/prisma/README.md)
- [HTTP DTO and routing public APIs](../../packages/http/src/index.portable.ts), [distinguishing authentication failures from infrastructure errors](../../packages/passport/src/guard.ts)
- [Request tests using the actual dispatcher](../../packages/testing/README.md)

[Previous: Running Failed Jobs Again](./ch15-reliable-jobs.md) | [Volume 2 Contents](./toc.md) | [Next: Coordinating Multiple Stages of Order Processing](./ch17-order-sagas.md)
