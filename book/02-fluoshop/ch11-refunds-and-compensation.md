# Cancellation and Refunds Are Not an Undo Button

<!-- book:volume=02-fluoshop;chapter=11 -->

[Previous: Handling Payment Webhooks Safely](./ch10-payment-webhooks.md) - [Volume 2 Contents](./toc.md) - [Next: Reconciling Interrupted Orders](./ch12-reconciliation.md)

## Customers Call It Cancellation, but the Server's Work Differs

Just after ordering a logo T-shirt, a blog reader contacts us to say they chose the wrong size. If no payment attempt has started, we can cancel the order and release the reserved stock. If payment has already completed, we also need to return the money. If packing has begun, we need to know where the warehouse has put that T-shirt too. The button on the screen may have one name, but the facts the server must establish differ.

The most dangerous implementation saves `order.status = 'cancelled'` and calls the payment cancellation API. If the external call fails after the DB change, the shop says the order is cancelled, but the customer has not received their money. Reversing the sequence does not remove the problem. If the provider refunds the payment but the DB commit fails, the customer keeps seeing a refund-in-progress screen, and the operator clicks the refund button again.

This problem does not disappear by choosing the right order for two lines of code. PostgreSQL rollback cannot undo the provider's refund. The previous chapter built signature verification and an Inbox to preserve receipt facts; this chapter builds refund records to preserve the operations we intend to perform. Rather than erase a successful charge, we add a new business fact corresponding to it.

FluoShop continues to use the same user IDs and order model. This chapter covers **whole-order cancellation and full refunds before fulfillment begins**. The automatic path does not accept `fulfilling` or `shipped` orders. We do not generalize it to partial refunds or receiving returned goods all at once. Even a single full refund must handle three boundaries precisely: external success, response loss, and DB failure.

## Fix the Allowed State Transitions First

An order in `pending_payment` with no PaymentAttempt yet can become `cancelled`. If an attempt already exists, even in `prepared`, this customer-facing path does not cancel it immediately. We cannot tell whether execution stopped just before the call or succeeded externally without updating the local record. The previous chapter's `prepare()` and this cancellation both lock the same order row first, then reread whether an attempt exists. If preparation wins, cancellation is rejected; if cancellation wins, preparation is rejected. Chapter 10's durable review path handles a late success arriving after Chapter 7's `expire()` has returned an expired reservation.

For a `paid` order, first move it to `refund_pending` and save a refund request. From this state onward, fulfillment work must not take over the order. It becomes `refunded` only after the refund fact is confirmed and compensation of saleable units is committed. A `cancelled` order ended without a charge; a `refunded` order has both a charge and a refund. Combining the two would erase a distinction that matters in sales and refund totals and customer inquiries.

We do not derive reservation state from order status alone either. Reservations retain Chapter 7's `reserved`, `consumed`, and `released` states. By the time an order is `paid`, its reservation is already `consumed`, and payment did not deduct saleable units again. A refund does not rewrite that historical fact to `released`. Only for an order that has not yet left the warehouse do we create a separate compensation record and increment `Stock.available` once. Code that increases saleable units merely because an already shipped item was refunded is wrong.

When returns are supported, refunds and physical recovery become separate records. Some products must be recovered first, while others can be refunded in advance. Either way, compensation is a new operation performed under current conditions, not a feature that deletes the past. We establish that principle first in a small full-refund implementation.

## A Refund Key Identifies a Business Operation, Not a Request

The following is a **schema fragment** to add to `prisma/schema.prisma`. Add `refundRequest RefundRequest?` as an inverse relation on the existing Order. Keep using the previous chapter's PaymentAttempt and Order amount, currency, and version fields. `orderId` is unique because we allow only one full refund per order.

```prisma
enum RefundState {
  pending
  succeeded
  review
}

model RefundRequest {
  id               String      @id
  orderId          String      @unique
  order            Order       @relation(fields: [orderId], references: [id])
  attemptId        String
  paymentId        String
  currency         String
  amountMinor      BigInt
  state            RefundState @default(pending)
  providerRefundId String?     @unique
  createdAt        DateTime    @default(now())
  nextCheckAt      DateTime    @default(now())
  reason           String?
  observedResult   Json?
  compensation     RefundStockCompensation?

  @@index([state, nextCheckAt])
}
```

Do not generate a RefundRequest `id` on every retry. Keep using the one ID stored in the DB as the provider's refund idempotency key. Find the same row whether the customer clicks twice or the operator runs the operation again. Using a temporary HTTP request ID as the refund key turns each retransmission into a different transfer of money.

Compensation uses Chapter 7's `Stock` and `Reservation` directly. The additional model is not a ledger that duplicates inventory numbers. It is a single **durable deduplication record proving that stock compensation for the full refund has already committed**. Add the following model to the same schema. `RefundRequest.compensation` is its inverse relation, and `orderId @id` together with `refundId @unique` prevents compensating the same order and refund twice.

```prisma
model RefundStockCompensation {
  orderId   String        @id
  refundId  String        @unique
  refund    RefundRequest @relation(fields: [refundId], references: [id], onDelete: Restrict)
  createdAt DateTime      @default(now())
}
```

The compensation record's `orderId` must also match the order belonging to that refund. Use the following **migration fragment** to constrain the relation and amount. Preserve the existing `Stock.available >= 0` constraint, reservation quantities of 1-99, and the `(orderId, sku)` key. Apply the generated migration including its SQL constraints, and regenerate Prisma Client.

```sql
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_money_check"
  CHECK ("currency" = 'KRW' AND "amountMinor" > 0);
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_id_order_key"
  UNIQUE ("id", "orderId");
ALTER TABLE "RefundStockCompensation" ADD CONSTRAINT "RefundStockCompensation_order_fk"
  FOREIGN KEY ("refundId", "orderId") REFERENCES "RefundRequest" ("id", "orderId");
```

Read the quantities to return from the reservations after comparing immutable order items with `consumed` reservations by SKU. Put the compensation record insertion, every SKU's `available` increment, the `refund_confirmed` transition and audit, and refund completion in one transaction. If a SKU fails partway through, the compensation record rolls back too, so the next execution can reapply the same ledger. An implementation that saves only the compensation record first and then says "duplicate, so we are done" is prohibited.

## A Small Adapter for Reproducing External Refunds

The following is the **complete file** `src/payments/refund-gateway.ts`. Rather than extending the previous chapter's payment port to put every method into one interface, we state the boundary needed by the refund operation separately. Real adapters can share the same provider SDK.

```ts
export const REFUND_GATEWAY = Symbol('REFUND_GATEWAY');

export type RefundCommand = Readonly<{
  refundKey: string;
  orderId: string;
  attemptId: string;
  paymentId: string;
  currency: 'KRW';
  amountMinor: bigint;
}>;

export type RefundResult =
  | { kind: 'unknown' }
  | { kind: 'rejected'; reason: string }
  | {
      kind: 'succeeded';
      refundId: string;
      paymentId: string;
      currency: 'KRW';
      amountMinor: bigint;
    };

export interface RefundGateway {
  refund(command: RefundCommand): Promise<RefundResult>;
}
```

The following **complete file**, `src/payments/local-refund-gateway.ts`, uses DI to look up the same payment records as the earlier LocalPaymentGateway. It makes no real external transfer. It offers a switch that records success and loses only the response.

```ts
import { Inject } from '@fluojs/core';
import {
  PAYMENT_GATEWAY, type PaymentGateway,
} from './payment-gateway.js';
import type {
  RefundCommand, RefundGateway, RefundResult,
} from './refund-gateway.js';

@Inject(PAYMENT_GATEWAY)
export class LocalRefundGateway implements RefundGateway {
  private readonly refunds = new Map<
    string, { command: RefundCommand; result: RefundResult }
  >();
  private loseNextReply = false;

  constructor(private readonly payments: PaymentGateway) {}

  loseNextResponse(): void {
    this.loseNextReply = true;
  }

  async refund(command: RefundCommand): Promise<RefundResult> {
    const existing = this.refunds.get(command.refundKey);
    if (existing) {
      const saved = existing.command;
      if (
        saved.orderId !== command.orderId ||
        saved.attemptId !== command.attemptId ||
        saved.paymentId !== command.paymentId ||
        saved.currency !== command.currency ||
        saved.amountMinor !== command.amountMinor
      ) {
        throw new Error('Refund key reused with different input');
      }
      return existing.result;
    }
    const payment = await this.payments.lookup(command.attemptId);
    if (
      !payment || payment.state !== 'succeeded' ||
      payment.orderId !== command.orderId ||
      payment.paymentId !== command.paymentId ||
      payment.currency !== command.currency ||
      payment.totalMinor !== command.amountMinor
    ) {
      return { kind: 'rejected', reason: 'Payment does not match refund' };
    }
    const result: RefundResult = Object.freeze({
      kind: 'succeeded',
      refundId: `local_refund_${command.refundKey}`,
      paymentId: command.paymentId,
      currency: command.currency,
      amountMinor: command.amountMinor,
    });
    this.refunds.set(command.refundKey, {
      command: Object.freeze({ ...command }), result,
    });
    if (this.loseNextReply) {
      this.loseNextReply = false;
      return { kind: 'unknown' };
    }
    return result;
  }
}
```

This model's Map stands in for the real provider's store. Resetting the provider double along with our server while testing restart recovery creates a different experiment. A response-loss recovery experiment recreates only the shop instance while retaining the fact that the provider already issued the refund. Using this Map in production is not an acceptable implementation.

If the provider's refund keys expire after a certain period, even resending the same key after that period may be unsafe. Limit automatic retries to less than the key retention period, then hand the case over to original-transaction and refund-history lookup or operational review. The port's contract of returning the same result holds only after verifying the guarantees the real provider supplies.

## Saving Intent, Executing Externally, and Applying Completion

The following `src/payments/refund-service.ts` is a **complete service file** based on the schema and port above. Pass the subject verified at the existing authentication boundary as the customer identifier. Do not pass `customerId` from the request body as this argument. `NotFoundException`, `ForbiddenException`, and `ConflictException` are actual HTTP exceptions, used here to pass the corresponding status codes to the existing order API.

```ts
import { randomUUID } from 'node:crypto';
import { Inject } from '@fluojs/core';
import {
  ConflictException, ForbiddenException, NotFoundException,
} from '@fluojs/http';
import { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import { reservationIssue } from '../inventory/reservation-policy.js';
import { OrderInventoryService } from '../orders/order-inventory.service.js';
import { OrderTransitionsService } from '../orders/order-transitions.service.js';
import {
  REFUND_GATEWAY, type RefundGateway,
} from './refund-gateway.js';

@Inject(PrismaService, REFUND_GATEWAY, OrderInventoryService, OrderTransitionsService)
export class RefundService {
  constructor(
    private readonly db: PrismaService<PrismaClient>,
    private readonly gateway: RefundGateway,
    private readonly inventory: OrderInventoryService,
    private readonly transitions: OrderTransitionsService,
  ) {}

  async request(orderId: string, customerId: string) {
    return this.db.transaction(async () => {
      const tx = this.db.current();
      await tx.$queryRaw`
        SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE
      `;
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order) throw new NotFoundException('Order not found');
      if (order.customerId !== customerId) {
        throw new ForbiddenException('Order belongs to another customer');
      }
      const existing = await tx.refundRequest.findUnique({ where: { orderId } });
      if (existing) return { kind: 'refund' as const, id: existing.id };
      if (order.status === 'cancelled') return { kind: 'cancelled' as const };
      const payment = await tx.paymentAttempt.findUnique({ where: { orderId } });
      if (order.status === 'pending_payment' && !payment) {
        await this.inventory.cancel(
          orderId, order.version, { subject: customerId, scopes: [] },
        );
        return { kind: 'cancelled' as const };
      }
      if (
        order.status !== 'paid' || !payment ||
        payment.state !== 'succeeded' || !payment.paymentId ||
        order.currency !== 'KRW' || payment.currency !== order.currency ||
        payment.totalMinor !== order.totalMinor
      ) {
        throw new ConflictException('Order cannot use automatic refund');
      }
      const items = await tx.orderItem.findMany({ where: { orderId } });
      const rows = await tx.reservation.findMany({ where: { orderId } });
      const issue = reservationIssue(items, rows, 'consumed', new Date(0));
      if (issue) throw new ConflictException(issue);
      await this.transitions.apply(
        orderId, order.version, { type: 'refund_requested' },
        { subject: customerId, scopes: [] },
      );
      const refund = await tx.refundRequest.create({
        data: {
          id: randomUUID(), orderId, attemptId: payment.id,
          paymentId: payment.paymentId,
          currency: order.currency, amountMinor: order.totalMinor,
        },
      });
      return { kind: 'refund' as const, id: refund.id };
    }, { isolationLevel: 'ReadCommitted' });
  }

  async execute(refundId: string, now = new Date()): Promise<void> {
    const saved = await this.db.current().refundRequest.findUniqueOrThrow({
      where: { id: refundId }, include: { order: true },
    });
    if (saved.state !== 'pending') return;
    if (
      saved.order.status !== 'refund_pending' ||
      saved.createdAt.getTime() <= now.getTime() - 86_400_000
    ) {
      await this.db.current().refundRequest.updateMany({
        where: { id: refundId, state: 'pending' },
        data: {
          state: 'review',
          reason: saved.order.status !== 'refund_pending'
            ? 'order_not_refund_pending' : 'automatic_window_elapsed',
        },
      });
      return;
    }
    if (saved.currency !== 'KRW' || saved.amountMinor <= 0n) {
      throw new Error('Invalid stored refund');
    }
    const result = await this.gateway.refund({
      refundKey: saved.id, orderId: saved.orderId, attemptId: saved.attemptId,
      paymentId: saved.paymentId, currency: saved.currency,
      amountMinor: saved.amountMinor,
    });

    await this.db.transaction(async () => {
      const tx = this.db.current();
      await tx.$queryRaw`
        SELECT "id" FROM "Order" WHERE "id" = ${saved.orderId} FOR UPDATE
      `;
      await tx.$queryRaw`
        SELECT "id" FROM "RefundRequest" WHERE "id" = ${refundId} FOR UPDATE
      `;
      const current = await tx.refundRequest.findUniqueOrThrow({
        where: { id: refundId }, include: { order: true },
      });
      if (result.kind === 'unknown') {
        if (current.state !== 'pending') return;
        await tx.refundRequest.update({
          where: { id: refundId },
          data: { nextCheckAt: new Date(now.getTime() + 300_000) },
        });
        return;
      }
      const observedResult = result.kind === 'succeeded'
        ? {
            kind: result.kind, refundId: result.refundId,
            paymentId: result.paymentId, currency: result.currency,
            amountMinor: result.amountMinor.toString(),
          }
        : { kind: result.kind, reason: result.reason };
      if (current.state === 'succeeded') return;
      if (current.state === 'review') {
        if (result.kind === 'succeeded' || current.observedResult === null) {
          await tx.refundRequest.update({
            where: { id: refundId }, data: { observedResult },
          });
        }
        return;
      }
      const review = async (reason: string) => {
        await tx.refundRequest.update({
          where: { id: refundId },
          data: { state: 'review', reason, observedResult },
        });
      };
      if (
        result.kind === 'rejected' ||
        result.paymentId !== current.paymentId ||
        result.currency !== current.currency ||
        result.amountMinor !== current.amountMinor ||
        current.order.status !== 'refund_pending'
      ) {
        await review('refund_result_or_order_mismatch');
        return;
      }
      const items = await tx.orderItem.findMany({
        where: { orderId: current.orderId },
      });
      const reservations = await tx.reservation.findMany({
        where: { orderId: current.orderId }, orderBy: { sku: 'asc' },
      });
      const issue = reservationIssue(items, reservations, 'consumed', now);
      if (issue) {
        await review(issue);
        return;
      }
      const already = await tx.refundStockCompensation.findUnique({
        where: { orderId: current.orderId },
      });
      if (already) {
        await review('compensation_exists_without_completed_refund');
        return;
      }
      await tx.refundStockCompensation.create({
        data: { orderId: current.orderId, refundId: current.id },
      });
      for (const reservation of reservations) {
        await tx.stock.update({
          where: { sku: reservation.sku },
          data: { available: { increment: reservation.quantity } },
        });
      }
      await this.transitions.apply(
        current.orderId, current.order.version,
        {
          type: 'refund_confirmed', currency: result.currency,
          amountMinor: result.amountMinor,
        },
        { subject: 'system:refund-ledger', scopes: ['payments:refund-confirm'] },
      );
      await tx.refundRequest.update({
        where: { id: refundId },
        data: {
          state: 'succeeded', providerRefundId: result.refundId,
          observedResult, reason: null,
        },
      });
    }, { isolationLevel: 'ReadCommitted' });
  }
}
```

There are no external calls inside `request()`. Even when two customer requests arrive concurrently, the order version and unique constraint allow only one refund intent to commit. A request that loses the race rereads the same order and shows the existing refund. Do not swallow every error as success. Checking for an existing row must happen at the retry boundary outside the transaction.

`execute()` reads only the stored amount and key, makes the external call, and then opens a new transaction. Applying `@Transaction()` to this entire method or wrapping it in a request-wide transaction interceptor therefore breaks the design. External execution must be called outside an active ambient transaction. Unlike ordinary DB work, where the new service `@Transaction()` is recommended, here it is more important to make the two separate boundaries visible in the code. The second argument, `now`, is the time input for internal work, allowing the next chapter's reconciliation and tests to use the same time reference. Do not use a customer-supplied timestamp for this value.

Two executors may call the same refund concurrently. Rather than prevent that completely, we use the external idempotency key and DB state checks to converge on the same effect. If the first executor saved completion, the later executor changes nothing because the refund is no longer `pending`. If the first executor died after the provider succeeded, the next one receives the same result and resumes local completion.

While an executor is waiting for the external response, the 24-hour boundary may pass and reconciliation may move the request to `review`. An executor receiving a late success locks the refund row after locking the order, preserves `review` and its reason, and records the success evidence in `observedResult`. A late rejection must not erase stored success evidence. This branch performs neither stock compensation nor order completion. Treating duplicate completion in `succeeded` and additional evidence in `review` with the same early return would lose the external success.

If the reservation ledger does not match, commit the refund result and reason as `review` before making the writes. This preserves the fact that the external refund already happened without automatically repairing an incorrect quantity. In contrast, a DB error during stock updates, audit insertion, or final refund storage must propagate and roll back everything, including the compensation record. The external refund remains, so rerun the same `pending` ID to continue only the completion update. `review` is not eligible for automatic retries.

Fulfillment takeover allows only `paid -> fulfilling` through Chapter 6's `fulfillment_started`. It neither consumes reservations again nor deducts inventory again. If the refund request commits `refund_pending` first, the fulfillment transition is rejected; if fulfillment wins first, the refund request receives 409. Even if a late refund result is observed in `fulfilling` or `shipped`, no automatic compensation occurs. Receiving returned goods has not been implemented, so we do not increase quantities as if such an order were eligible.

## Separating Customer Cancellation from Internal Refund Execution

The following **complete file**, `src/payments/refund-actions.controller.ts`, adds `POST /orders/:id/cancel`. It accepts neither a customer ID nor a refund amount from the request. This entry point saves intent only; actual external refunds are left to the `RefundService.execute` call in Chapter 12. Thus, `kind: refund` means a saved refund operation ID, not a completed refund.

```ts
import { Inject } from '@fluojs/core';
import {
  BadRequestException, ConflictException, Controller, Header, HttpCode, Post,
  UnauthorizedException, type RequestContext,
} from '@fluojs/http';
import { UseAuth } from '@fluojs/passport';
import { z } from 'zod';
import { ReservationConflict } from '../inventory/inventory.service.js';
import {
  OrderRuleError, OrderVersionConflict,
} from '../orders/order-state.js';
import { RefundService } from './refund-service.js';

const cancellationInput = z.object({
  orderId: z.string().min(1).max(160),
  body: z.object({}).strict().optional(),
});

@Controller('/orders')
@Inject(RefundService)
export class RefundActionsController {
  constructor(private readonly refunds: RefundService) {}

  @Post('/:id/cancel')
  @UseAuth('blog-jwt')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async request(_input: unknown, context: RequestContext) {
    const subject = context.principal?.subject;
    if (!subject) throw new UnauthorizedException();
    const input = cancellationInput.safeParse({
      orderId: context.request.params.id, body: context.request.body,
    });
    if (!input.success) throw new BadRequestException('Invalid cancellation request');
    try {
      return await this.refunds.request(input.data.orderId, subject);
    } catch (error) {
      if (
        error instanceof ReservationConflict ||
        error instanceof OrderRuleError ||
        error instanceof OrderVersionConflict
      ) throw new ConflictException(error.message);
      throw error;
    }
  }
}
```

The **registration extension** for PaymentsModule follows. Add the entries below to each array without deleting the previous chapter's imports/providers/controllers/exports. Add these imports at the top of the file and merge the metadata.

```ts
import { LocalRefundGateway } from './local-refund-gateway.js';
import { RefundActionsController } from './refund-actions.controller.js';
import { REFUND_GATEWAY } from './refund-gateway.js';
import { RefundService } from './refund-service.js';
```

```ts
providers: [
  { provide: REFUND_GATEWAY, useClass: LocalRefundGateway },
  RefundService,
],
controllers: [RefundActionsController],
exports: [RefundService],
```

Extend `OrdersModule.exports` to `[OrderInventoryService, OrderTransitionsService]`. Both classes are already in the same module's providers; do not register them twice. Cancellation before payment uses the former's `cancel`, while refund request and confirmation use the latter's `apply`. PaymentsModule continues to import OrdersModule; do not add an import in the opposite direction. The default PrismaService comes from `BlogDatabaseModule`, registered once at the root.

The ID returned by `request()` is a durable operation identifier. In the exercise before adding Chapter 12's reconciliation, you can advance the refund by calling `await service.execute(id)` on a RefundService resolved from the container. Observe separately the point when intent exists without an external call and the point when completion actually occurs. Do not create an unobserved Promise with `void service.execute()`.

## Reproducing Refund Failures in Order

The following is the **complete test file** `src/payments/local-refund-gateway.test.ts`. It reproduces payments and refunds without external calls and checks that the same refund identifier is returned after losing a result.

```ts
import { expect, it } from 'vitest';
import { LocalPaymentGateway } from './local-payment-gateway.js';
import { LocalRefundGateway } from './local-refund-gateway.js';

it('returns the original refund after losing its response', async () => {
  const payments = new LocalPaymentGateway();
  await payments.charge({
    attemptId: 'attempt-101', orderId: 'order-101',
    currency: 'KRW', totalMinor: 29_000n,
  });
  const refunds = new LocalRefundGateway(payments);
  const command = {
    refundKey: 'refund-101', attemptId: 'attempt-101', orderId: 'order-101',
    paymentId: 'local_attempt-101', currency: 'KRW' as const,
    amountMinor: 29_000n,
  };
  refunds.loseNextResponse();
  expect(await refunds.refund(command)).toEqual({ kind: 'unknown' });
  expect(await refunds.refund(command)).toEqual({
    kind: 'succeeded', refundId: 'local_refund_refund-101',
    paymentId: 'local_attempt-101', currency: 'KRW', amountMinor: 29_000n,
  });
  await expect(refunds.refund({ ...command, amountMinor: 1n })).rejects.toThrow();
});
```

In your app, run `pnpm exec vitest run src/payments/local-refund-gateway.test.ts`. This test checks only the provider double's idempotency. Test PostgreSQL consistency separately with the following integration sequence. Pay the version 0 order created in Chapter 8 through the actual coordinator from Chapters 9 and 10, producing `paid`, version 1, and 29,000 KRW. Use a ProductVariant of a published Product and an order-item quantity of 1, with T-shirt `Stock.available=9` and the corresponding `(orderId, sku)` reservation in `consumed`. The attempt and provider double retain the same success identifier, and no compensation record exists yet.

First call `request(orderId, customerId)`. Expect order `refund_pending`, version 2, one `refund_requested` audit row, and one RefundRequest row, with the quantity still 9. Next, call `loseNextResponse()` followed by `execute(id, fixedNow)`. The external double now has a refund, but the DB must still be `pending`. Executing again with the same ID produces order `refunded`, version 3, one `refund_confirmed` audit row, refund `succeeded`, the reservation **still `consumed`**, quantity 10, and exactly one RefundStockCompensation row. These numbers must remain unchanged on a third execution and on execution after recreating the container.

In the race test, start two refund requests for the same order concurrently. Both need not succeed immediately, but there must be only one final refund row. Retrying the failed request must return the same ID. To race against fulfillment takeover, put a test Promise boundary immediately before the order's conditional update and release both operations together. An outcome in which both refund and fulfillment succeed is not allowed.

For a partial-failure test, fail the second SKU update or OrderTransition insertion inside the completion transaction. The refund in the external double must remain, while the first SKU's quantity, compensation record, order, audit, and RefundRequest changes all roll back. Rerunning the same ID leaves the external refund identifier unchanged and finishes only local completion. This experiment requires a real transactional DB and was not run during manuscript preparation.

Also remove a reservation or change it to `released` before applying external success: `review`, `observedResult`, and `reason` must remain, and inventory must not increase. Requests for `fulfilling` or `shipped` orders must return 409 without a refund intent or external call. A `pending` refund exactly 24 hours after creation also moves to review with `automatic_window_elapsed` without an external call. For cancellation of an order with no payment attempt, check version 0 to 1, one `cancel_requested` audit row, reservation `released`, and one increase in saleable units; duplicate cancellation must not repeat them.

Reproduce the race at the 24-hour boundary with `entered` and `release` Promises in the double. First wait for A's signal that the refund call has entered, then move the fixed time to the boundary and finish B's reconciliation to confirm `review`, and only then release A's success response. The final refund must be `review`, its reason `automatic_window_elapsed`, and `observedResult.refundId` the external success ID. The order, quantity, and compensation record must remain unchanged. Do not use sleep to wait for real time to pass.

Refund facts must link to charge facts in operational logs. Recording only an order ID can incorrectly join multiple orders from the same customer, while recording every provider error message verbatim can introduce sensitive values. Record the refund ID, original payment ID, operation state, and retry eligibility as structured data, and serialize amounts as strings. "Refund complete" on the customer screen must also follow the boundary between the external fact and its local completion update.

## Defining Where Automation Ends and What Comes Next

Automatically retrying every failure forever is not an operational policy. A payment amount mismatch, an unknown original payment, or an expired refund key retention period requires `review` and human judgment. Keep only cases in which the same operation can safely be repeated, such as a network error or failure to save completion, on the automatic path. The key is to distinguish retrying an operation from sending money anew.

Introducing partial refunds takes more than simply removing `orderId @unique`. It requires a total constraint that stays within the charged amount, allocation records preventing the same item quantity from being refunded twice, allocation of discounts and shipping fees, and a locking boundary for summing concurrent refunds. At the current scale, supporting only full refunds is an explicit product decision that defers these costs.

Cancellation now runs only in eligible states, and a refund is an operation with a durable ID. But who executes it again if the process exits immediately after saving the request? The next chapter implements reconciliation that finds these interruption points through DB queries and scheduled work rather than human memory.

## Sources and Verification Scope

- [Prisma README](../../packages/prisma/README.md), [public exports](../../packages/prisma/src/index.ts), [transaction types](../../packages/prisma/src/types.ts): `transaction()` and `current()`, nested boundary reuse, and strict mode.
- [Prisma service implementation](../../packages/prisma/src/service.ts), [service integration tests](../../packages/prisma/src/vertical-slice.test.ts), [shutdown drain tests](../../packages/prisma/src/shutdown-drain-status.test.ts): evidence for transactions and client lifecycle.
- [HTTP exception implementation](../../packages/http/src/exceptions.ts): 403, 404, and 409 mappings.
- [The previous chapter's receipt records](./ch10-payment-webhooks.md), [editorial contract](../EDITORIAL.md): assumptions about the same order, amounts, and reservation lifecycle.

This chapter's refund store and stock compensation are application-owned code. Fluo registration does not provide atomic external refunds or restart recovery. No real payments, refunds, or infrastructure changes were executed.

[Previous: Handling Payment Webhooks Safely](./ch10-payment-webhooks.md) - [Volume 2 Contents](./toc.md) - [Next: Reconciling Interrupted Orders](./ch12-reconciliation.md)
