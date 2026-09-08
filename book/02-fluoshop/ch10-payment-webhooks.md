# Handling Payment Webhooks Safely

<!-- book:volume=02-fluoshop;chapter=10 -->

[Previous: Keeping the Payment Provider Outside the Application](./ch09-payment-boundary.md) - [Volume 2 Contents](./toc.md) - [Next: Cancellation and Refunds Are Not an Undo Button](./ch11-refunds-and-compensation.md)

## The Day a Payment Notification Arrived Three Times

On the first day of sales, a blog reader pays for a T-shirt. The provider sends a success response, but the reader closes the browser. A little later, a success notification arrives at `/payments/webhooks`, followed by two more copies. From the provider's perspective, retransmission is reasonable because it did not receive the first response. If the shop completes the order and deducts inventory every time, that reasonable retransmission becomes three shipping instructions.

A webhook is not a special internal call. It is an HTTP request from the internet, and it can be duplicated, delayed, or delivered out of order. Calling it "a request from the payment provider" means something only after verifying the sender. Conversely, a valid signature does not justify changing an order's status unconditionally. The signature confirms what the provider said; it does not decide whether that statement can be applied to this order now.

The previous chapter separated payment call results into `observed` and `unknown`. This chapter implements the boundary that turns observations into durable order facts. We keep the existing accounts and orders. PaymentsModule gains a separate entry point that verifies the provider's signature rather than a customer JWT, but we create neither a separate service nor a new account system.

The signing protocol used here is **the book's local payment provider protocol**. It is not presented as a real vendor's API. Concatenate the timestamp in seconds from the `x-payment-timestamp` header, a period, and the raw bytes; sign them with HMAC-SHA256, and send the 64-character lowercase hex value in `x-payment-signature`. When connecting a real provider, follow its protocol for the bytes to sign, key identifiers, and whether signatures are refreshed on retransmission.

## What to Preserve Before the JSON Object

The following two JSON documents represent the same data, but their bytes differ.

```json
{"eventId":"evt-101","totalMinor":"29000"}
```

```json
{ "totalMinor": "29000", "eventId": "evt-101" }
```

Verifying a signature against the result of applying `JSON.stringify()` to a parsed object can reject a valid request because of whitespace, key order, or escaping. An even more dangerous repair is simply trusting the parsed body when verification fails. Signature verification must stop processing on failure, and it must verify the raw bytes received.

Fluo's `FrameworkRequest.rawBody` is an optional `Uint8Array`. This does not mean that the HTTP package automatically captures raw bodies in every adapter. On the Fastify path in Node.js 24, enable `rawBody: true`. The following is the **bootstrap option change** in the existing `src/main.ts`. Merge these options while preserving the existing AppModule and the host, port, and lifecycle policies read from configuration.

```ts
import { runFastifyApplication } from '@fluojs/platform-fastify';
import { AppModule } from './app.js';

await runFastifyApplication(AppModule, {
  host: '127.0.0.1',
  port: 3000,
  rawBody: true,
  maxBodySize: 65_536,
});
```

Here, the size limit applies to the entire adapter. If the blog's upload policy allows larger bodies, do not overwrite the global limit with this number. Keep the existing limit and apply separate webhook ingress and verifier limits. A length check inside a controller checks a body that has already arrived, so it cannot replace a memory limit during receipt. Fastify does not apply raw-body capture to multipart requests, so this entry point accepts JSON only.

## The File That Validates Signatures and Input

The following is the **complete file** `src/payments/webhook-verifier.ts`. It receives the same local ConfigService used for the previous chapter's `PaymentConfig`. Accepting time as an argument allows tests to fix the clock; it does not let an external request choose the server's time.

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ConfigService } from '@fluojs/config';
import { Inject } from '@fluojs/core';
import {
  BadRequestException,
  UnauthorizedException,
} from '@fluojs/http';
import { z } from 'zod';
import type { PaymentConfig } from './payments.module.js';

const eventSchema = z.object({
  eventId: z.string().min(1).max(160)
    .refine(value => !value.startsWith('reconcile:')),
  attemptId: z.string().min(1).max(160),
  orderId: z.string().min(1).max(160),
  paymentId: z.string().min(1).max(160),
  currency: z.literal('KRW'),
  totalMinor: z.string().refine(value =>
    /^[1-9][0-9]{0,18}$/.test(value) &&
    BigInt(value) <= 9_223_372_036_854_775_807n),
  state: z.enum(['succeeded', 'declined']),
});

export type PaymentEvent = z.infer<typeof eventSchema>;

@Inject(ConfigService)
export class WebhookVerifier {
  constructor(private readonly config: ConfigService<PaymentConfig>) {}

  verify(
    raw: Uint8Array,
    timestamp: string | string[] | undefined,
    signature: string | string[] | undefined,
    nowSeconds = Math.floor(Date.now() / 1000),
  ): PaymentEvent {
    if (
      typeof timestamp !== 'string' ||
      !/^[0-9]{10}$/.test(timestamp) ||
      Math.abs(nowSeconds - Number(timestamp)) > 300 ||
      typeof signature !== 'string' ||
      !/^[0-9a-f]{64}$/.test(signature)
    ) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
    const expected = createHmac(
      'sha256',
      this.config.getOrThrow('PAYMENT_WEBHOOK_SECRET'),
    ).update(`${timestamp}.`).update(raw).digest();
    const actual = Buffer.from(signature, 'hex');
    if (!timingSafeEqual(expected, actual)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    let input: unknown;
    try {
      input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    } catch {
      throw new BadRequestException('Invalid webhook JSON');
    }
    const result = eventSchema.safeParse(input);
    if (!result.success) {
      throw new BadRequestException('Invalid webhook event');
    }
    return result.data;
  }
}
```

Passing buffers of different lengths to `timingSafeEqual()` throws an exception, so we first check the exact hex format. Header arrays are rejected too. Rather than arbitrarily choosing which of several same-named signatures to trust, we reject ambiguous input. We reject timestamps too far in the future as well as the past, and check the timestamp in the signature header, not one in the body.

A five-minute tolerance window does not solve duplicate processing. The same request can be sent repeatedly within that window. Conversely, a provider may retransmit an event from days ago with a new signature, so we do not discard an event just because it occurred long ago. Transmission freshness and event duplication are separate checks. If a real provider reuses the original signature unchanged, this time policy is unsuitable. In that case, use the provider's documented retransmission protocol.

Amount validation calls `BigInt()` only after the string passes the format check. Otherwise, a malformed amount could become an exception handled as a 500 instead of a validation failure. Event IDs beginning with `reconcile:` are reserved for the internal observation records in Chapter 12. Even authenticated external events must not occupy the internal event ID space.

Do not log raw bodies, signatures, or secret keys. Incident analysis needs the event identifier, payment attempt identifier, outcome classification, and request trace ID. The convenience of storing an entire body brings retention and access-control costs. This chapter stores a hash and processing result instead of the raw body.

## Committing the Receipt and Order Change Together

The following is an **application schema fragment** to integrate into `prisma/schema.prisma`. Do not recreate the existing Order model or delete its order-item and account relations. Use Order's existing fields `id String`, `customerId String`, `status OrderStatus`, `currency String`, `totalMinor BigInt`, and `version Int`, and add the inverse relation `paymentAttempt PaymentAttempt?`. We assume that `OrderStatus` already contains the seven states in the editorial contract. Fluo packages do not generate the following new models and enums.

```prisma
enum PaymentAttemptState {
  prepared
  pending
  succeeded
  declined
  review
}

enum PaymentInboxDecision {
  received
  applied
  ignored
  review
}

model PaymentAttempt {
  id          String              @id
  orderId     String              @unique
  order       Order               @relation(fields: [orderId], references: [id])
  provider    String
  paymentId   String?
  currency    String
  totalMinor  BigInt
  state       PaymentAttemptState @default(prepared)
  createdAt   DateTime            @default(now())
  nextCheckAt DateTime            @default(now())
  reviewReason String?

  @@unique([provider, paymentId])
  @@index([state, nextCheckAt])
}

model PaymentInbox {
  provider   String
  eventId    String
  attemptId  String
  digest     String
  facts      Json
  reason     String?
  decision   PaymentInboxDecision @default(received)
  receivedAt DateTime             @default(now())

  @@id([provider, eventId])
  @@index([decision, receivedAt])
}
```

The policy across these four chapters is one payment attempt per order. `orderId @unique` enforces it in the DB too. The Inbox's `attemptId` deliberately has no foreign key, because authenticated notifications about attempts we do not have must also be persisted for investigation. Instead, immediately before changing an order, we look up the attempt and compare the order, amount, currency, and payment identifier.

`facts` stores only validated identifiers, currency, the amount string, and the observed state. It does not store the raw HTTP body or card information. A hash alone cannot reconstruct which success could not be applied, so `reason` and these limited facts become the review evidence. If the existing practice DB has Inbox rows, first add a nullable `facts Json?`, populate it through trusted payment lookups, and then make the column required. Keep unrecoverable rows separately and retain their processing deduplication keys; do not fill them with arbitrary amounts. A new practice DB can use the definition above directly.

Add the following SQL to the migration that creates the payment models. Order versions still start at 0.

```sql
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_money_check"
  CHECK ("provider" = 'local' AND "currency" = 'KRW' AND "totalMinor" > 0);
```

## Separating External Success from a Valid Sales Commitment

Chapter 7's `confirmPayment` performs the transition and reservation consumption in the same transaction. Here, **before** calling that boundary, we check that the order items match the entire reservation ledger under the same order lock. Missing SKUs, extra reservations, different quantities, expiration, or a different final state are all reasons an external success cannot become `paid`. The following **complete file**, `src/inventory/reservation-policy.ts`, extracts that decision into a pure function. Chapter 11 requires `consumed` through the same function to validate the ledger to be compensated.

```ts
type Item = Readonly<{ sku: string; quantity: number }>;
type ReservationRow = Readonly<{
  sku: string;
  quantity: number;
  state: string;
  expiresAt: Date;
}>;

export function reservationIssue(
  items: readonly Item[],
  rows: readonly ReservationRow[],
  requiredState: 'reserved' | 'consumed',
  now: Date,
): string | null {
  if (items.length === 0 || rows.length !== items.length) {
    return 'reservation_set_mismatch';
  }
  for (const item of items) {
    const row = rows.find(value => value.sku === item.sku);
    if (!row || row.quantity !== item.quantity) {
      return 'reservation_quantity_mismatch';
    }
    if (row.state !== requiredState) return 'reservation_state_mismatch';
    if (requiredState === 'reserved' && row.expiresAt <= now) {
      return 'reservation_expired';
    }
  }
  return null;
}
```

The composite keys and SQL constraints from Chapters 6 and 7 already guarantee unique SKUs and positive quantities in order items and reservations. This function does not replace DB constraints. An old `expiresAt` on a `consumed` reservation does not remove refund eligibility. Saleable units were already deducted at reservation time and are not returned merely because time passes after payment.

The following `src/payments/payment-ledger.ts` is a **complete file** containing `prepare`, `recordObservation`, and `record`. `prepare` acquires the order row lock before rereading the existing attempt. Preparing an attempt is not a state transition and does not increment the order version. Cancellation in Chapter 11 also locks the same order row first, so the "no attempt" decision cannot race with preparation. Only when the order status changes does the existing `OrderTransitionsService.apply` create the version change and audit row together.

```ts
import { createHash } from 'node:crypto';
import { Inject } from '@fluojs/core';
import { ConflictException } from '@fluojs/http';
import { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import { reservationIssue } from '../inventory/reservation-policy.js';
import { OrderInventoryService } from '../orders/order-inventory.service.js';
import type { PaymentSnapshot } from './payment-gateway.js';
import type { PaymentEvent } from './webhook-verifier.js';

type LedgerEvent = Omit<PaymentEvent, 'state'> & {
  state: PaymentSnapshot['state'];
};

@Inject(PrismaService, OrderInventoryService)
export class PaymentLedger {
  constructor(
    private readonly db: PrismaService<PrismaClient>,
    private readonly inventory: OrderInventoryService,
  ) {}

  async prepare(orderId: string, attemptId: string) {
    return this.db.transaction(async () => {
      const tx = this.db.current();
      await tx.$queryRaw`
        SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE
      `;
      const existing = await tx.paymentAttempt.findUnique({ where: { orderId } });
      if (existing) return existing;
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      if (
        order.status !== 'pending_payment' || order.currency !== 'KRW' ||
        order.totalMinor <= 0n
      ) throw new ConflictException('Order is not payable');
      return tx.paymentAttempt.create({
        data: {
          id: attemptId, orderId, provider: 'local',
          currency: order.currency, totalMinor: order.totalMinor,
        },
      });
    }, { isolationLevel: 'ReadCommitted' });
  }

  async recordObservation(expectedAttemptId: string, observed: PaymentSnapshot) {
    const facts = {
      attemptId: observed.attemptId, orderId: observed.orderId,
      paymentId: observed.paymentId, currency: observed.currency,
      totalMinor: observed.totalMinor.toString(), state: observed.state,
    };
    const digest = createHash('sha256')
      .update(JSON.stringify([expectedAttemptId, facts])).digest('hex');
    return this.record(
      { eventId: `reconcile:${digest}`, ...facts }, digest, expectedAttemptId,
    );
  }

  async record(
    event: LedgerEvent,
    digest: string,
    expectedAttemptId = event.attemptId,
  ) {
    return this.db.transaction(async () => {
      const tx = this.db.current();
      await tx.$queryRaw`
        SELECT o."id" FROM "Order" o
        JOIN "PaymentAttempt" p ON p."orderId" = o."id"
        WHERE p."id" = ${expectedAttemptId} FOR UPDATE OF o
      `;
      await tx.$queryRaw`
        SELECT "id" FROM "PaymentAttempt" WHERE "id" = ${expectedAttemptId} FOR UPDATE
      `;
      const key = { provider: 'local', eventId: event.eventId };
      const inserted = await tx.paymentInbox.createMany({
        data: [{
          ...key, attemptId: expectedAttemptId, digest,
          facts: { ...event, expectedAttemptId },
        }],
        skipDuplicates: true,
      });
      if (inserted.count === 0) {
        const previous = await tx.paymentInbox.findUniqueOrThrow({
          where: { provider_eventId: key },
        });
        if (previous.digest !== digest) {
          throw new ConflictException('Event identity changed');
        }
        if (previous.decision === 'received') {
          throw new ConflictException('Incomplete committed receipt');
        }
        return previous.decision;
      }

      const finish = async (
        decision: 'applied' | 'ignored' | 'review',
        reason: string | null = null,
      ) => {
        await tx.paymentInbox.update({
          where: { provider_eventId: key },
          data: { decision, reason },
        });
        return decision;
      };
      const attempt = await tx.paymentAttempt.findUnique({
        where: { id: expectedAttemptId },
        include: { order: true },
      });
      if (!attempt) return finish('review', 'attempt_missing');
      const review = async (reason: string) => {
        if (attempt.state !== 'succeeded') {
          await tx.paymentAttempt.update({
            where: { id: attempt.id }, data: { state: 'review', reviewReason: reason },
          });
        }
        return finish('review', reason);
      };
      const order = attempt.order;
      if (
        attempt.provider !== 'local' ||
        attempt.id !== event.attemptId ||
        attempt.orderId !== event.orderId ||
        attempt.currency !== event.currency ||
        order.currency !== event.currency ||
        attempt.totalMinor !== BigInt(event.totalMinor) ||
        order.totalMinor !== attempt.totalMinor ||
        (attempt.paymentId !== null && attempt.paymentId !== event.paymentId)
      ) {
        return review('payment_identity_or_money_mismatch');
      }
      const otherPayment = await tx.paymentAttempt.findFirst({
        where: { provider: 'local', paymentId: event.paymentId, id: { not: attempt.id } },
      });
      if (otherPayment) return review('payment_belongs_to_another_attempt');
      if (attempt.state === 'review') return finish('review', 'manual_review_required');
      if (attempt.state === 'succeeded') return finish('ignored');
      if (event.state === 'pending') {
        if (attempt.state === 'declined') return finish('ignored');
        await tx.paymentAttempt.update({
          where: { id: attempt.id },
          data: { state: 'pending', paymentId: event.paymentId },
        });
        return finish('ignored');
      }
      if (event.state === 'declined') {
        if (attempt.state === 'declined') return finish('ignored');
        await tx.paymentAttempt.update({
          where: { id: attempt.id },
          data: { state: 'declined', paymentId: event.paymentId },
        });
        return finish('applied');
      }
      if (attempt.state === 'declined' || order.status !== 'pending_payment') {
        return review('order_cannot_accept_success');
      }
      const items = await tx.orderItem.findMany({ where: { orderId: order.id } });
      const reservations = await tx.reservation.findMany({
        where: { orderId: order.id }, orderBy: { sku: 'asc' },
      });
      const times = await tx.$queryRaw<Array<{ now: Date }>>`
        SELECT transaction_timestamp() AS "now"
      `;
      const clock = times[0];
      if (!clock) throw new ConflictException('Database clock unavailable');
      const issue = reservationIssue(items, reservations, 'reserved', clock.now);
      if (issue) return review(issue);
      await this.inventory.confirmPayment(
        order.id, order.version, event.currency, BigInt(event.totalMinor),
        { subject: 'system:payment-ledger', scopes: ['payments:confirm'] },
      );
      await tx.paymentAttempt.update({
        where: { id: attempt.id },
        data: { state: 'succeeded', paymentId: event.paymentId },
      });
      return finish('applied');
    }, { isolationLevel: 'ReadCommitted' });
  }
}
```

We do not commit a receipt marker first and change the order later. If the server died between those steps, a retransmission would be discarded as "an event already received." `createMany({ skipDuplicates: true })` uses PostgreSQL's conflict-avoiding insert. This differs from catching a unique exception inside a transaction and then continuing to query. It avoids trying to keep executing after a failed statement has left a PostgreSQL transaction aborted.

Because the `ReadCommitted` boundary reads after locking the order, two successes for the same order check the current attempt in sequence. The order lock is also shared with Chapter 7's reservation, expiration, and cancellation operations. Do not add options to the nested `transaction()` inside `confirmPayment`. In the same global PrismaService context, the order, version, OrderTransition, reservation consumption, attempt, and Inbox commit together. There is no code that deducts saleable units again.

A reservation mismatch is classified as `review` **before any state changes**, and the success evidence and reason are committed. By contrast, do not catch an audit-row insertion failure, DB error, or unexpected `ReservationConflict` inside a nested call and return normally. A nested transaction is not a savepoint, so such a catch risks committing partial writes. The error propagates outward, rolling everything back, including the Inbox. HTTP returns a failure, and the sender retransmits the same event or reconciliation looks up the same external fact again. If the response code is one the real provider does not retry, align the retry policy at the HTTP boundary.

A decline arriving after success is `ignored`. A duplicate success for an order already in `refund_pending` does not move it back to `paid`. In contrast, success after a final decline, or success for a cancelled order, is a contradiction retained as `review`. It is possible to acknowledge receipt of a fact requiring human review with a success response, but an operational procedure for reading those records must follow. Here, 200 means "durably accepted responsibility for receipt," not "ready to ship."

## Wiring the HTTP Entry Point and Module

The following `src/payments/payment-webhooks.controller.ts` is a **complete file**. The handler's second argument is `RequestContext`; it does not use NestJS-style parameter decorators.

```ts
import { createHash } from 'node:crypto';
import { Inject } from '@fluojs/core';
import {
  BadRequestException, Controller, getRequestHeader, HttpCode,
  InternalServerErrorException, PayloadTooLargeException, Post,
  type RequestContext,
} from '@fluojs/http';
import { PaymentLedger } from './payment-ledger.js';
import { WebhookVerifier } from './webhook-verifier.js';

@Controller('/payments')
@Inject(WebhookVerifier, PaymentLedger)
export class PaymentWebhooksController {
  constructor(
    private readonly verifier: WebhookVerifier,
    private readonly ledger: PaymentLedger,
  ) {}

  @Post('/webhooks')
  @HttpCode(200)
  async receive(_input: unknown, context: RequestContext) {
    const request = context.request;
    const contentType = getRequestHeader(request, 'content-type');
    if (typeof contentType !== 'string' ||
        contentType.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
      throw new BadRequestException('Expected application/json');
    }
    if (!request.rawBody) {
      throw new InternalServerErrorException('Raw body capture is required');
    }
    if (request.rawBody.byteLength > 65_536) {
      throw new PayloadTooLargeException('Webhook is too large');
    }
    const event = this.verifier.verify(
      request.rawBody,
      getRequestHeader(request, 'x-payment-timestamp'),
      getRequestHeader(request, 'x-payment-signature'),
    );
    const digest = createHash('sha256').update(request.rawBody).digest('hex');
    await this.ledger.record(event, digest);
    return { accepted: true };
  }
}
```

The following is the **complete module file** updating Chapter 9's `src/payments/payments.module.ts`. The local payment configuration is visible only within this module and does not shadow the existing global AppSettings. Keep the root's `BlogDatabaseModule` registered just once. This module has no DB registration because it uses that asynchronous factory's `strictTransactions: true` and the default global PrismaService.

```ts
import { ConfigModule, ConfigService } from '@fluojs/config';
import { Module } from '@fluojs/core';
import { z } from 'zod';
import { AuthModule } from '../auth/auth.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { LocalPaymentGateway } from './local-payment-gateway.js';
import { PaymentActionsController } from './payment-actions.controller.js';
import { PaymentCoordinator } from './payment-coordinator.js';
import { PAYMENT_GATEWAY } from './payment-gateway.js';
import { PaymentLedger } from './payment-ledger.js';
import { PaymentWebhooksController } from './payment-webhooks.controller.js';
import { WebhookVerifier } from './webhook-verifier.js';

const schema = z.object({
  PAYMENT_MODE: z.literal('local'),
  PAYMENT_WEBHOOK_SECRET: z.string().min(32),
});
export type PaymentConfig = z.infer<typeof schema>;

@Module({
  imports: [
    AuthModule,
    OrdersModule,
    ConfigModule.forRoot({
      global: false,
      envFilePaths: [],
      defaults: { PAYMENT_MODE: 'local' },
      processEnv: {
        PAYMENT_MODE: process.env.PAYMENT_MODE,
        PAYMENT_WEBHOOK_SECRET: process.env.PAYMENT_WEBHOOK_SECRET,
      },
      schema,
    }),
  ],
  providers: [
    {
      provide: PAYMENT_GATEWAY,
      inject: [ConfigService],
      useFactory: (config: ConfigService<PaymentConfig>) => {
        config.getOrThrow('PAYMENT_MODE');
        return new LocalPaymentGateway();
      },
    },
    PaymentCoordinator, PaymentLedger, WebhookVerifier,
  ],
  controllers: [PaymentActionsController, PaymentWebhooksController],
  exports: [PAYMENT_GATEWAY, PaymentCoordinator, PaymentLedger],
})
export class PaymentsModule {}
```

Inject the `OrderInventoryService` exported by OrdersModule; do not register it again in PaymentsModule's providers. Obtain `current()` inside each transaction. Wrapping the same client in two PrismaService instances does not, by itself, share the active context.

Requiring a customer login guard on a webhook prevents the provider from calling it. That does not mean unconditionally disabling the global authentication guard either. In the existing app's guard configuration, classify only this exact route as a provider-signature boundary. A missing raw body is an adapter configuration error rather than the sender's fault, so it is a 500; signature failure is 401, and invalid input format is 400.

## Verifying the Order of Failures Too

Signature verification can be tested without a DB. The following is the **complete test file** `src/payments/webhook-verifier.test.ts`.

```ts
import { createHmac } from 'node:crypto';
import { ConfigService } from '@fluojs/config';
import { BadRequestException, UnauthorizedException } from '@fluojs/http';
import { expect, it } from 'vitest';
import { WebhookVerifier } from './webhook-verifier.js';
import type { PaymentConfig } from './payments.module.js';

it('authenticates bytes rather than a reconstructed object', () => {
  const secret = 'local-test-secret-that-is-not-production';
  const verifier = new WebhookVerifier(new ConfigService<PaymentConfig>({
    PAYMENT_MODE: 'local', PAYMENT_WEBHOOK_SECRET: secret,
  }));
  const timestamp = '1800000000';
  const raw = Buffer.from('{"eventId":"evt-101","attemptId":"attempt-101",' +
    '"orderId":"order-101","paymentId":"local_attempt-101","currency":"KRW",' +
    '"totalMinor":"29000","state":"succeeded"}');
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.`).update(raw).digest('hex');
  expect(verifier.verify(raw, timestamp, signature, 1800000000).eventId)
    .toBe('evt-101');
  const changed = Buffer.concat([raw, Buffer.from(' ')]);
  expect(() => verifier.verify(changed, timestamp, signature, 1800000000))
    .toThrow(UnauthorizedException);
  expect(() => verifier.verify(raw, timestamp, signature, 1800000301))
    .toThrow(UnauthorizedException);
  const invalidAmount = Buffer.from(raw.toString().replace('"29000"', '"oops"'));
  const invalidSignature = createHmac('sha256', secret)
    .update(`${timestamp}.`).update(invalidAmount).digest('hex');
  expect(() => verifier.verify(invalidAmount, timestamp, invalidSignature, 1800000000))
    .toThrow(BadRequestException);
});
```

You can run it in your app with `pnpm exec vitest run src/payments/webhook-verifier.test.ts`. Integration verification requires applying the schema to a separate disposable PostgreSQL DB, seeding one order and attempt, and sending signed bytes to the actual `/payments/webhooks` route. Neither that DB nor the completed app was run here; the results below are what you should observe.

The inventory decision boundary can also run without a DB. The following **complete file**, `src/inventory/reservation-policy.test.ts`, tests the contract that payments and refunds use the same function. Run it with `pnpm exec vitest run src/inventory/reservation-policy.test.ts`.

```ts
import { expect, it } from 'vitest';
import { reservationIssue } from './reservation-policy.js';

it('requires the complete live reservation set before payment', () => {
  const now = new Date('2026-09-01T00:00:00Z');
  const items = [{ sku: 'TEE-BLACK-M', quantity: 1 }];
  const row = {
    ...items[0], sku: 'TEE-BLACK-M', quantity: 1,
    state: 'reserved', expiresAt: new Date(now.getTime() + 1),
  };
  expect(reservationIssue(items, [row], 'reserved', now)).toBeNull();
  expect(reservationIssue(items, [], 'reserved', now)).not.toBeNull();
  expect(reservationIssue(items, [row, { ...row, sku: 'EXTRA' }], 'reserved', now))
    .not.toBeNull();
  expect(reservationIssue(items, [{ ...row, quantity: 2 }], 'reserved', now))
    .not.toBeNull();
  expect(reservationIssue(items, [{ ...row, expiresAt: now }], 'reserved', now))
    .not.toBeNull();
  expect(reservationIssue(items, [{ ...row, state: 'released' }], 'reserved', now))
    .not.toBeNull();
});

it('requires consumed history for refund without reviving its old expiry', () => {
  const now = new Date('2026-09-01T00:00:00Z');
  const items = [{ sku: 'TEE-BLACK-M', quantity: 1 }];
  const row = { sku: 'TEE-BLACK-M', quantity: 1, state: 'consumed', expiresAt: now };
  expect(reservationIssue(items, [row], 'consumed', now)).toBeNull();
  expect(reservationIssue(items, [{ ...row, state: 'released' }], 'consumed', now))
    .not.toBeNull();
});
```

The initial integration-test order has `version=0`, just after creation in Chapter 8. Prepare a `ProductVariant` with its published parent Product, order items, `Stock.available=0`, and a `reserved` reservation of quantity 1 that expires in the future. The version remains 0 after `prepare`. After applying success, check together for version 1, one `payment_confirmed` audit row, a `consumed` reservation, and an unchanged `available=0`.

| Experiment | Expected observation |
| --- | --- |
| Send the same raw body and eventId twice concurrently | One final Inbox row, order `paid`, and one order version increment. If a conflict response occurs, retransmitting the same event completes processing |
| Send the same success with different eventIds | Two Inbox rows, one `ignored`, and no additional order version increment |
| Change the amount for the same eventId and re-sign it correctly | 409; the original Inbox and order amount are retained |
| Combine another order's attemptId with a payment identifier | Receipt is recorded as `review`; the target order's status does not change |
| Raise an error inside the transaction immediately after the order change | Inbox, order, and attempt all roll back; the next retransmission actually applies |
| Cut only the response connection after the DB commits | Retransmission receives 200; the order change is not repeated |
| Deliver success for a cancelled order | `review` without restoring the order; shipping does not start |
| Deliver a validly signed success when reservations are missing or some SKUs, quantities, or states differ | Store Inbox `facts` and a specific `reason`; attempt `review`; no changes to order, version, inventory, or audit |
| Deliver success with `expiresAt` at or before the DB transaction time | Retain `reservation_expired` review evidence; not `paid` |
| Cause a DB failure during audit-row insertion or reservation consumption | Inbox, attempt, order, audit, and reservations all roll back; retransmission of the same event resumes processing |
| Retry the same order after losing the response to `POST /orders/:id/payment` | Perform lookup only with the saved attempt ID; no new charge call or attempt row |

Do not verify this table with an in-memory mock that does not reproduce DB rollback. In particular, control interruptions before and after commit by registering a test boundary signal first and releasing a Promise at that point. A test that sleeps an arbitrary number of milliseconds and kills the process cannot prove exactly which boundary it interrupted.

This chapter's Inbox is an application implementation limited to payment receipt facts. It does not make all event delivery durable or exactly-once. We have not yet notified other modules of order completion either. When a customer requests cancellation in the next chapter, an order whose payment has already been collected needs a new refund operation rather than a simple return to its earlier state.

## Sources and Verification Scope

- [HTTP README](../../packages/http/README.md), [public exports](../../packages/http/src/index.portable.ts), [request and handler types](../../packages/http/src/types.ts), [HTTP exceptions](../../packages/http/src/exceptions.ts).
- [Fastify README](../../packages/platform-fastify/README.md), [adapter regression tests](../../packages/platform-fastify/src/adapter.test.ts): contracts for preserving raw bytes, excluding multipart, and limiting bodies.
- [Prisma README](../../packages/prisma/README.md), [public exports](../../packages/prisma/src/index.ts), [module implementation](../../packages/prisma/src/module.ts), [transaction types](../../packages/prisma/src/types.ts), [service integration tests](../../packages/prisma/src/vertical-slice.test.ts).

The public APIs and source contracts were checked. The signing protocol, schema, and Inbox in this chapter are application designs; no claim is made that real provider signature conformance or PostgreSQL concurrency experiments passed.

[Previous: Keeping the Payment Provider Outside the Application](./ch09-payment-boundary.md) - [Volume 2 Contents](./toc.md) - [Next: Cancellation and Refunds Are Not an Undo Button](./ch11-refunds-and-compensation.md)
