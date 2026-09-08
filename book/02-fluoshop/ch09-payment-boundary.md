# Keeping the Payment Provider Outside the Application

<!-- book:volume=02-fluoshop;chapter=09 -->

[Previous: Two Clicks on Buy, One Order](./ch08-idempotent-checkout.md) - [Volume 2 Contents](./toc.md) - [Next: Handling Payment Webhooks Safely](./ch10-payment-webhooks.md)

## One Order Can Still Mean Two Charges

The operator of FluoBlog opens the first T-shirt sale. Readers sign in with the account they use to read posts, review their cart, and make a purchase. The idempotent checkout from the previous chapter returns the same order even when they click the button twice. Product prices are fixed in the order items, and the last units of stock have been reserved. But creating only one order does not mean collecting the money only once. Saving an order is PostgreSQL's job; charging a card is another system's job.

Suppose the operator appends a payment call to the end of the order creation function. The payment provider successfully charges 29,000 KRW, but the connection breaks while the response is on its way back. Our server records a timeout. The reader sees an error and clicks again, and the server finds the existing order and charges it again. The order count test passes. The payment statement now has two entries. Preventing this failure requires treating HTTP request idempotency and payment operation idempotency as separate boundaries.

In this chapter, "outside" does not mean moving PaymentsModule to a separate server. FluoShop is still a modular monolith in the same `fluo-blog` application. We do not rebuild AccountsModule or PostsModule. It means keeping the payment SDK's types, errors, and authentication mechanisms out of the state transition rules in OrdersModule. A system outside our network boundary also belongs beyond an explicit boundary in the code.

The runtime baseline is Node.js 24 and pnpm 10. The code below consists of application files that you write; it does not claim that this repository already contains the complete shop at this stage. We reproduce failures with an adapter that does not connect to a real payment provider. Throughout the chapter, we distinguish what that adapter proves from what must be checked against a real provider's contract.

## The Provider Supplies Results, Not Order Policy

At first, it seems enough for a service to learn whether `charge()` succeeded. But `false` cannot distinguish a card decline from a communication failure. A decline is a final decision made by the payment provider. A communication failure means that we do not know the outcome. Recording both as the same failure can cancel an order for which we actually received payment, or collect the same money again.

The port therefore separates an observed payment state from an outcome we could not observe. Create `src/payments/payment-gateway.ts` as the following **complete type file**. `attemptId` identifies a payment attempt that the server first saves in the DB, and it does not change on retransmission. Rather than exposing the client's checkout key from the previous chapter directly to the provider, we use this internal identifier as the payment operation key.

```ts
export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

export type ChargeCommand = Readonly<{
  attemptId: string;
  orderId: string;
  currency: 'KRW';
  totalMinor: bigint;
}>;

export type PaymentSnapshot = Readonly<{
  attemptId: string;
  orderId: string;
  paymentId: string;
  currency: 'KRW';
  totalMinor: bigint;
  state: 'pending' | 'succeeded' | 'declined';
}>;

export type ChargeResult =
  | { kind: 'observed'; payment: PaymentSnapshot }
  | { kind: 'unknown' };

export interface PaymentGateway {
  charge(command: ChargeCommand): Promise<ChargeResult>;
  lookup(attemptId: string): Promise<PaymentSnapshot | undefined>;
}

export class PaymentKeyConflict extends Error {}
```

`unknown` is not an order status. The order may remain `pending_payment` while a separate payment record awaits confirmation. This distinction avoids continually adding arbitrary order statuses just to represent payment progress. Likewise, `undefined` from `lookup()` does not mean a decline. It is only the limited observation that this lookup did not find a record. Real providers differ in how soon a write becomes visible to a lookup, whether they support lookup by key, and how they define final failure.

Amounts use `bigint`, and the default currency is `KRW`. Pass the amount fixed in the order; do not trust the browser's price or `customerId`. At the JSON boundary, use `totalMinor.toString()` to produce a decimal string. If an SDK requires a `number`, verify that the value is at most `Number.MAX_SAFE_INTEGER` before converting it. Type conversion does not create accuracy. Store only values within PostgreSQL's signed bigint range, and restrict payments for this shop's paid products to amounts greater than zero.

The absence of `createOrder()` and `markPaid()` from the port matters too. The provider supplies payment facts; it cannot decide whether a stock reservation is valid or whether an order has already been cancelled. Both webhooks and reconciliation jobs must evaluate those facts against order policy. Conversely, passing dozens of payment SDK error codes into the order service would force us to review the state machine again whenever we change providers.

## A Small Provider That Loses a Response

A fake implementation that always returns success hides the most important failure. The following **complete file**, `src/payments/local-payment-gateway.ts`, creates a situation in which a payment is recorded and exactly one response is lost. It makes no external calls and accepts no card information. This implementation is for development and testing only.

```ts
import {
  PaymentKeyConflict,
  type ChargeCommand,
  type ChargeResult,
  type PaymentGateway,
  type PaymentSnapshot,
} from './payment-gateway.js';

export class LocalPaymentGateway implements PaymentGateway {
  private readonly payments = new Map<string, PaymentSnapshot>();
  private loseNextReply = false;

  loseNextResponse(): void {
    this.loseNextReply = true;
  }

  async charge(command: ChargeCommand): Promise<ChargeResult> {
    if (
      !command.attemptId || !command.orderId ||
      command.currency !== 'KRW' ||
      command.totalMinor <= 0n ||
      command.totalMinor > 9_223_372_036_854_775_807n
    ) {
      throw new RangeError('Invalid charge command');
    }

    const existing = this.payments.get(command.attemptId);
    if (existing && (
      existing.orderId !== command.orderId ||
      existing.currency !== command.currency ||
      existing.totalMinor !== command.totalMinor
    )) {
      throw new PaymentKeyConflict('Payment key reused with different input');
    }

    const payment: PaymentSnapshot = existing ?? Object.freeze({
      ...command,
      paymentId: `local_${command.attemptId}`,
      state: 'succeeded',
    });
    this.payments.set(command.attemptId, payment);

    if (this.loseNextReply) {
      this.loseNextReply = false;
      return { kind: 'unknown' };
    }
    return { kind: 'observed', payment };
  }

  async lookup(attemptId: string): Promise<PaymentSnapshot | undefined> {
    return this.payments.get(attemptId);
  }
}
```

The same key with the same input returns the stored payment identifier. The same key with a different amount produces a conflict instead of returning the existing result. A rule that merely says "treat duplicates as success" cannot catch the mistake of reusing an earlier payment receipt after the order amount has changed. Idempotency covers not just the key, but also the identity of the input that key represents.

The in-memory `Map` is deliberately confined to this provider model. It cannot prevent duplicates across application instances or preserve records after a process restart. In a real adapter, the provider's idempotency store and lookup contract take on that responsibility. Saving a key in our DB is no reason to assume that the provider understands it too.

Before connecting a real SDK, answer three questions: How long is the key valid? What happens when the same key is sent with a different amount? Can an operation whose response was lost be looked up by its key? If lookup accepts only a payment identifier and that identifier is available only in the response, there is no recovery path after losing the response. Check whether the contract also lets you store and search for the shop's identifier in provider metadata.

## Bringing Configuration and DI to the Same Assembly Point

Reading production keys from configuration instead of embedding them in code does not complete the boundary. If a service constructs the SDK directly in its constructor, that setup follows it into tests. PaymentsModule selects the implementation, and consumers receive an actual injection token. TypeScript interfaces disappear at runtime, so the type name `PaymentGateway` alone cannot provide DI.

The following is the **complete module file for this chapter's stage**, `src/payments/payments.module.ts`. You can merge the same entries into the existing app configuration. If you have already registered a global ConfigModule, do not register it again; add the payment settings below to that registration's schema and explicit environment snapshot. The example shows a local ConfigModule so that the payment boundary can be understood in isolation. `zod` is a direct dependency of the application.

```ts
import { ConfigModule, ConfigService } from '@fluojs/config';
import { Module } from '@fluojs/core';
import { z } from 'zod';
import { LocalPaymentGateway } from './local-payment-gateway.js';
import { PAYMENT_GATEWAY } from './payment-gateway.js';

const schema = z.object({
  PAYMENT_MODE: z.literal('local'),
  PAYMENT_WEBHOOK_SECRET: z.string().min(32),
});

export type PaymentConfig = z.infer<typeof schema>;

@Module({
  imports: [
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
  ],
  exports: [PAYMENT_GATEWAY],
})
export class PaymentsModule {}
```

This configuration does not allow a real provider mode. Nor does it silently fall back to `local` for an unimplemented production adapter. An invalid mode must fail schema validation. The webhook secret is used in the local signing experiment in the next chapter. Supply a secure temporary value through the environment, and keep the value itself out of logs, responses, and the repository.

`ConfigModule.forRoot()` is synchronous registration and does not automatically scan `process.env`. Environment values participate only through an explicit `processEnv`. `envFilePaths: []` also disables the default `.env` discovery. This keeps tests from depending on incidental files on a developer's computer. If you use files in production, specify the path list and remember the precedence: `runtimeOverrides`, `processEnv`, environment files, then `defaults`. Finish remote secret retrieval at the application boundary before constructing the module graph.

The following `src/payments/payment-probe.ts` is a **complete experiment file**. It is a small experimental tool that calls the boundary wired through DI, not a service registered in the order API. For real orders, the `PaymentCoordinator` below uses the saved attempt and amount. Dependencies run from `PaymentsModule -> OrdersModule -> InventoryModule`; OrdersModule does not import PaymentsModule back.

```ts
import { Inject } from '@fluojs/core';
import {
  PAYMENT_GATEWAY,
  type ChargeCommand,
  type PaymentGateway,
} from './payment-gateway.js';

@Inject(PAYMENT_GATEWAY)
export class PaymentProbe {
  constructor(private readonly gateway: PaymentGateway) {}

  run(command: ChargeCommand) {
    return this.gateway.charge(command);
  }
}
```

## Keeping the Network Outside the Transaction

Calling the provider while a DB transaction is open may look atomic. In reality, the DB can roll back after the provider has collected the money. Meanwhile, a long network wait merely holds order and inventory locks longer. Nothing in this code combines the commits of the two systems into one.

The shop's processing sequence has three stages. First, a short transaction checks the existing order's `pending_payment` status and `version`, then saves a payment attempt. Next, outside the transaction, it calls the provider with the saved attempt key and amount. Finally, another short transaction applies the observation to the order. The next chapter implements this last stage together with webhooks.

An attempt record needs at least `id`, `orderId`, `provider`, `currency`, `totalMinor`, `state`, `paymentId`, and `createdAt`. The initial implementation across these four chapters allows one attempt per order. A policy for trying another card after a provider decline is more involved than attaching unlimited attempts to the same order. For now, an order with a final decline is not shipped, and the customer must create a new order. Creating a new payment key for an order whose outcome is already uncertain is prohibited.

If the server stops after saving but before calling, only a `prepared` record remains. If it stops after calling but before saving the result, the DB retains the same state, but the provider may have succeeded. Local records alone cannot distinguish these cases. An HTTP cancellation signal is not evidence that a charge reaching the provider was withdrawn either. Show the browser an order awaiting confirmation, and obtain the facts through a webhook or lookup. The small type-level decision not to turn a timeout into a card decline becomes an operational policy here.

## Connecting the Experimental Port to Real Order Operations

The following **complete file**, `src/payments/payment-coordinator.ts`, is the actual use case assembled with `PaymentLedger.prepare/recordObservation`, which the next chapter defines. That chapter completes the persistence layer used by this file rather than switching to a separate payment service. `prepare(orderId, proposedId)` saves a new attempt or returns the attempt already saved for the order. The initial charge runs only when the returned ID matches the ID just proposed. If an attempt already exists, it performs a lookup only. When the process dies between saving and calling, preventing a new charge takes priority over automatic progress, and reconciliation in Chapter 12 looks up the same ID and leaves cases it cannot verify for review.

```ts
import { randomUUID } from 'node:crypto';
import { Inject } from '@fluojs/core';
import {
  ConflictException, ForbiddenException, NotFoundException,
} from '@fluojs/http';
import { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import {
  PAYMENT_GATEWAY, type ChargeResult, type PaymentGateway,
} from './payment-gateway.js';
import { PaymentLedger } from './payment-ledger.js';

@Inject(PrismaService, PaymentLedger, PAYMENT_GATEWAY)
export class PaymentCoordinator {
  constructor(
    private readonly db: PrismaService<PrismaClient>,
    private readonly ledger: PaymentLedger,
    private readonly gateway: PaymentGateway,
  ) {}

  async pay(orderId: string, customerId: string) {
    const order = await this.db.current().order.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.customerId !== customerId) {
      throw new ForbiddenException('Order belongs to another customer');
    }
    const proposedId = randomUUID();
    const saved = await this.ledger.prepare(orderId, proposedId);
    let decision: 'waiting' | 'applied' | 'ignored' | 'review' =
      saved.state === 'review' ? 'review'
        : saved.state === 'succeeded' || saved.state === 'declined'
          ? 'ignored' : 'waiting';
    if (saved.state === 'prepared' || saved.state === 'pending') {
      if (saved.currency !== 'KRW') {
        throw new ConflictException('Unsupported stored currency');
      }
      let result: ChargeResult;
      if (saved.id === proposedId) {
        result = await this.gateway.charge({
          attemptId: saved.id, orderId: saved.orderId,
          currency: saved.currency, totalMinor: saved.totalMinor,
        });
      } else {
        const observed = await this.gateway.lookup(saved.id);
        result = observed
          ? { kind: 'observed', payment: observed }
          : { kind: 'unknown' };
      }
      switch (result.kind) {
        case 'observed':
          decision = await this.ledger.recordObservation(saved.id, result.payment);
          break;
        case 'unknown':
          break;
      }
    }
    const current = await this.db.current().paymentAttempt.findUniqueOrThrow({
      where: { id: saved.id }, include: { order: true },
    });
    return {
      attemptId: current.id,
      orderId: current.orderId,
      status: current.order.status,
      paymentState: current.state,
      decision: current.state === 'review' ? 'review' : decision,
      currency: current.currency,
      totalMinor: current.totalMinor.toString(),
      version: current.order.version,
    };
  }
}
```

Do not wrap this entire method in a request transaction or `@Transaction()`. Call `charge` or `lookup` after `prepare` commits, then open another short transaction to record the observation. If the adapter classifies a timeout as `unknown`, the attempt remains eligible for lookup. Even if the adapter throws an unexpected exception or the final DB write fails, the saved ID remains, and the caller retries with the same order. Do not add an exception handler that issues a new ID and repeats the charge.

We also connect the customer request entry point through an actual file. The following `src/payments/payment-actions.controller.ts` is a **complete file** using the `blog-jwt` strategy registration from Volume 1. The DTO for starting payment contains only the order ID from the path. It accepts no price, currency, attempt ID, or customer ID, and the body must be empty or `{}`.

```ts
import { Inject } from '@fluojs/core';
import {
  BadRequestException, Controller, Header, HttpCode, Post,
  UnauthorizedException, type RequestContext,
} from '@fluojs/http';
import { UseAuth } from '@fluojs/passport';
import { z } from 'zod';
import { PaymentCoordinator } from './payment-coordinator.js';

const actionInput = z.object({
  orderId: z.string().min(1).max(160),
  body: z.object({}).strict().optional(),
});

@Controller('/orders')
@Inject(PaymentCoordinator)
export class PaymentActionsController {
  constructor(private readonly payments: PaymentCoordinator) {}

  @Post('/:id/payment')
  @UseAuth('blog-jwt')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async pay(_input: unknown, context: RequestContext) {
    const subject = context.principal?.subject;
    if (!subject) throw new UnauthorizedException();
    const input = actionInput.safeParse({
      orderId: context.request.params.id, body: context.request.body,
    });
    if (!input.success) throw new BadRequestException('Invalid payment request');
    return this.payments.pay(input.data.orderId, subject);
  }
}
```

The existing root continues to import the **same `BlogDatabaseModule` registration object** exported from Volume 1's `src/database/blog-database.module.ts`. That object is `PrismaModule.forRootAsync({ global: true, inject: [AppSettings], useFactory: ... })`, and its factory owns `strictTransactions: true` and the client. Do not create a new `prisma` variable or DB wrapper for payments. At sale time, the SKU was already validated using the existing `ProductVariant` and its `Product.status = published`, `active`, and `priceMinor`; payment reads the Order snapshot, not the current product price. The inventory authority remains Chapter 7's `Stock.available` and `(orderId, sku)` reservations.

Register this coordinator and controller in the final PaymentsModule in Chapter 10. The root keeps the existing AccountsModule, PostsModule, AuthModule, and OrdersModule, and adds PaymentsModule once. The payment result screen checks the returned `paymentState` and `decision`; it must not interpret `waiting` or `review` as permission to ship.

## An Experiment That Actually Checks Response Loss

The following `src/payments/payment-gateway.test.ts` is a **complete test file** using the earlier two files and `PaymentProbe`. Run it with the existing Fluo project's Vitest configuration, which applies the standard decorator transform. Enabling `experimentalDecorators` or `emitDecoratorMetadata` is not a substitute.

```ts
import { Container } from '@fluojs/di';
import { expect, it } from 'vitest';
import { LocalPaymentGateway } from './local-payment-gateway.js';
import { PAYMENT_GATEWAY, PaymentKeyConflict } from './payment-gateway.js';
import { PaymentProbe } from './payment-probe.js';

it('keeps the charge identity after a lost reply', async () => {
  const gateway = new LocalPaymentGateway();
  const container = new Container().register(
    { provide: PAYMENT_GATEWAY, useValue: gateway },
    PaymentProbe,
  );
  try {
    const probe = await container.resolve(PaymentProbe);
    const command = {
      attemptId: 'attempt-101',
      orderId: 'order-101',
      currency: 'KRW' as const,
      totalMinor: 29_000n,
    };
    gateway.loseNextResponse();
    expect(await probe.run(command)).toEqual({ kind: 'unknown' });
    const observed = await gateway.lookup(command.attemptId);
    expect(observed?.paymentId).toBe('local_attempt-101');
    expect(await probe.run(command)).toEqual({
      kind: 'observed',
      payment: observed,
    });
    await expect(probe.run({ ...command, totalMinor: 30_000n }))
      .rejects.toBeInstanceOf(PaymentKeyConflict);
  } finally {
    await container.dispose();
  }
});
```

Run `pnpm exec vitest run src/payments/payment-gateway.test.ts` in the app you generated. The expected result is that, even though the first call cannot confirm the outcome, lookup finds a success record, a repeated call returns the same payment identifier, and changing the amount is rejected. No fixed waits or fortunate network ordering are needed. These app files were not created and tested during the writing of this manuscript, so no passing result is claimed.

In configuration tests, also check that `PAYMENT_MODE=production` or a short webhook secret makes the app fail before it accepts requests. In DI tests, removing the token registration must make resolution fail. For a provider replacement experiment, use `override()` rather than attempting to overwrite an existing registration with `register()`. The container's replacement API and the application's payment retries are separate concepts.

Abstraction has a cost too. With only one provider, building a general financial framework first can make interface maintenance more expensive than handling actual failures. That is why this port contains only the charge and lookup operations currently needed. Add installments, partial cancellations, and foreign currencies together with their contracts when they become necessary. Uncertain outcomes and stable operation keys, however, are needed from the start. Even a small shop can lose a response.

The order service can now save a payment attempt and observe facts without knowing the payment SDK directly. But browser responses alone cannot finish that observation. In the next chapter, we receive webhooks initiated by the provider and turn untrusted HTTP requests into order state transitions that remain safe under duplication.

## Sources and Verification Scope

- [DI README](../../packages/di/README.md), [public exports](../../packages/di/src/index.ts): contracts for tokens, `register`, `override`, asynchronous `resolve`, and `dispose`.
- [Config README](../../packages/config/README.md), [public exports](../../packages/config/src/index.ts), [ConfigService implementation](../../packages/config/src/service.ts): synchronous registration, single-key access, and isolated configuration snapshots.
- [Configuration loading tests](../../packages/config/src/load.test.ts): evidence for explicit environment input, precedence, and synchronous Standard Schema validation.
- [Editorial contract](../EDITORIAL.md), [finalized contents](../series.json): extending the same blog, order and currency names, and the runtime baseline.

The package contracts were compared with the public source. Provider-specific key retention periods, lookup consistency, and real charging behavior were not verified. Do not use the local adapter's in-memory records as a production payment store.

[Previous: Two Clicks on Buy, One Order](./ch08-idempotent-checkout.md) - [Volume 2 Contents](./toc.md) - [Next: Handling Payment Webhooks Safely](./ch10-payment-webhooks.md)
