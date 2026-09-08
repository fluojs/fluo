# Two Clicks on Buy, but Only One Order

<!-- book:volume=02-fluoshop;chapter=08 -->

[Previous: What If Two People Buy the Last T-Shirt?](./ch07-inventory-concurrency.md) | [Volume 2 Contents](./toc.md) | [Next: Keeping the Payment Provider Outside the Application](./ch09-payment-boundary.md)

## It May Be the Response That Failed, Not the Order

We have solved the problem of promising the last T-shirt to two readers at once. But now a reader contacts us: "I bought once, but two orders were created." They pressed the purchase button on their phone, the screen froze, and they pressed it again. The server records show that order creation and inventory reservation for the first request committed. The network dropped while the reader was moving, so only the response failed to arrive; the second request created a separate order.

Disabling the button reduces rapid repeated clicks. But refreshes, proxy retransmissions, and retries after network errors remain possible. Telling a customer who does not know whether the server received the first request to press again if it failed, while treating every POST as a new order, effectively encourages duplicate creation. With sufficient stock, the previous chapter's conditional decrement does not stop these requests either. Both orders have different IDs and legitimate quantity conditions.

This chapter's goal is to return the first successful result without creating a new order when the same customer sends **the same purchase attempt** again. It does not prohibit buying the same products again tomorrow. Instead of a rule that the same customer and cart mean the same order, we use an idempotency key created for each purchase attempt. If the key is the same but the input has changed, respond with a conflict: neither modify the existing order nor create another.

What we complete here is creation of a `pending_payment` order, not payment completion. We combine price revalidation, item snapshots, inventory reservation, and a replayable response in one database transaction. We make no real payments and send no external messages. Using the same blog authentication and database, we add an entry point to `OrdersModule`, which owns `/orders`.

## What Must Match for Requests to Be the Same?

The browser generates one key, using something such as `crypto.randomUUID()`, when it creates a new purchase intent. When retrying because the response is uncertain, it sends that key and request body unchanged. Changing quantities or agreeing to a new quote makes it a new attempt, so generate a new key. Generating a key for every call to `fetch` makes the idempotency store see different requests.

The key is scoped to the authenticated customer and the order creation operation. Another reader sending the same string must not be able to retrieve someone else's order. This implementation uses a `CheckoutRequest` table dedicated to order creation, so the table boundary fixes the operation scope. Reusing the same table for refunds or shipping requests would require including the operation name in the primary key as well. The customer identifier comes from `RequestContext.principal.subject`, not the request body.

The body accepts only `currency`, `lines`, and `quoteHash`. Normalize SKUs and quantities according to Chapter 5's rules. JSON property order and the display order of cart lines do not change purchase intent, so calculate the hash from normalized values. In contrast, `quoteHash` belongs to the price offer confirmed by the customer, so it is included in the input fingerprint. A request agreeing to a new price must not be treated as retransmission of an old attempt.

The following is the **complete file** `src/orders/checkout-input.ts`. `normalizeCart` and `CartLine` are exports from `src/cart/pricing.ts`, created in Chapter 5. TypeScript type assertions alone are no substitute for input validation.

```ts
import { createHash } from 'node:crypto';
import { normalizeCart, type CartLine } from '../cart/pricing.js';

export class CheckoutInputError extends Error {}
export class IdempotencyConflict extends Error {}
export class QuoteChanged extends Error {}

export type CheckoutInput = Readonly<{
  currency: 'KRW';
  lines: readonly CartLine[];
  quoteHash: string;
}>;

export function parseCheckoutKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(value)) {
    throw new CheckoutInputError('Invalid Idempotency-Key.');
  }
  return value;
}

export function parseCheckout(value: unknown): CheckoutInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CheckoutInputError('Checkout body must be an object.');
  }
  const keys = Object.keys(value);
  if (
    keys.length !== 3 ||
    !keys.includes('currency') ||
    !keys.includes('lines') ||
    !keys.includes('quoteHash')
  ) {
    throw new CheckoutInputError('Unexpected checkout fields.');
  }
  const input = value as Record<string, unknown>;
  if (
    input.currency !== 'KRW' ||
    typeof input.quoteHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(input.quoteHash)
  ) {
    throw new CheckoutInputError('Invalid currency or quote hash.');
  }
  return {
    currency: 'KRW',
    lines: normalizeCart(input.lines),
    quoteHash: input.quoteHash,
  };
}

export function checkoutFingerprint(
  customerId: string,
  input: CheckoutInput,
): string {
  return createHash('sha256')
    .update(JSON.stringify([
      'create-order-v1',
      customerId,
      input.currency,
      input.lines.map(line => [line.sku, line.quantity]),
      input.quoteHash,
    ]))
    .digest('hex');
}
```

Do not select just the first value when a header arrives as an array. `@fluojs/http`'s `getRequestHeader` performs a case-insensitive lookup while preserving the original `string | string[] | undefined` shape. The validation above rejects arrays, empty values, whitespace, and commas. We narrow the accepted format to reduce the chance of intermediary layers interpreting the same request's key differently. The key itself is not an authentication secret, but there is no need to record its raw value in every log.

## Do Not Commit the In-Progress Record and Success Response Separately

A common implementation first saves an in-progress record, creates the order, and then marks the record complete. If those three stages commit separately, a process crash between them can leave a record in progress forever. Lease durations, ownership changes, and recovery work then become necessary. Such a design may be needed for slow operations such as external payments, but this order creation can finish quickly within one database.

We therefore put everything from claiming the key through saving the response in the same transaction. A committed record always has a completed response. On failure, the key claim also rolls back, allowing another attempt with the same key. The policy stores successful responses only. It does not promise permanent replay of failures due to input errors, out-of-stock items, or price changes.

The following is a **partial model implementation** to add to `prisma/schema.prisma`. Add the reverse field `checkoutRequest CheckoutRequest?` to `Order`, retaining its existing `reservations`, `items`, and `transitions`. `responseJson` is JSON text for a response whose values have already been converted to decimal strings, not an object containing internal `bigint` values.

```prisma
model CheckoutRequest {
  customerId  String
  key         String
  requestHash String
  orderId     String?  @unique
  responseJson String? @db.Text
  createdAt   DateTime @default(now())
  order       Order? @relation(fields: [orderId], references: [id], onDelete: Restrict)

  @@id([customerId, key])
}
```

`orderId` and `responseJson` are nullable so that the key can be claimed first inside the transaction. The normal write path fills both before committing. Administrative code or a batch that commits an incomplete row separately could break this invariant. This is why the table is not exposed through a general CRUD API. Manage the storage format and retention period so that existing response text can still be replayed even after the success response format changes.

## Wait on the Unique Constraint, Then Replay the Successful Result

The following is the **complete file** `src/orders/checkout.service.ts`. It injects `CartService`, `InventoryService`, and the shared `PrismaService` from the preceding chapters. The caller supplies an authenticated customer and validated key and body. The service does not reread HTTP request headers or a client-supplied `customerId`.

```ts
import { randomUUID } from 'node:crypto';
import { Inject } from '@fluojs/core';
import { PrismaService, type PrismaServiceFacade } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import { CartService } from '../cart/cart.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import {
  IdempotencyConflict,
  QuoteChanged,
  checkoutFingerprint,
  type CheckoutInput,
} from './checkout-input.js';

export type CheckoutResult = Readonly<{
  replayed: boolean;
  body: unknown;
}>;

@Inject(PrismaService, CartService, InventoryService)
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaServiceFacade<PrismaClient>,
    private readonly cart: CartService,
    private readonly inventory: InventoryService,
  ) {}

  async create(
    customerId: string,
    key: string,
    input: CheckoutInput,
  ): Promise<CheckoutResult> {
    const requestHash = checkoutFingerprint(customerId, input);
    return this.prisma.transaction(async () => {
      const inserted = await this.prisma.$executeRaw`
        INSERT INTO "CheckoutRequest" ("customerId", "key", "requestHash")
        VALUES (${customerId}, ${key}, ${requestHash})
        ON CONFLICT ("customerId", "key") DO NOTHING
      `;
      if (inserted === 0) {
        const previous = await this.prisma.checkoutRequest.findUnique({
          where: { customerId_key: { customerId, key } },
        });
        if (!previous || !previous.orderId || !previous.responseJson) {
          throw new Error('Committed checkout record is incomplete.');
        }
        if (previous.requestHash !== requestHash) {
          throw new IdempotencyConflict('Key was used with another request.');
        }
        return {
          replayed: true,
          body: JSON.parse(previous.responseJson) as unknown,
        };
      }
      const quote = await this.cart.quote(input.lines);
      if (quote.currency !== input.currency || quote.quoteHash !== input.quoteHash) {
        throw new QuoteChanged('Refresh the cart quote before ordering.');
      }
      const order = await this.prisma.order.create({
        data: {
          id: randomUUID(),
          customerId,
          status: 'pending_payment',
          currency: quote.currency,
          totalMinor: quote.totalMinor,
          version: 0,
          items: {
            create: quote.lines.map(line => ({
              sku: line.sku,
              unitMinor: line.unitMinor,
              quantity: line.quantity,
              discountMinor: line.discountMinor,
              lineTotalMinor: line.lineTotalMinor,
            })),
          },
        },
      });
      await this.inventory.reserve(order.id);
      const body = {
        id: order.id,
        status: order.status,
        currency: order.currency,
        totalMinor: order.totalMinor.toString(),
        version: order.version,
      };
      await this.prisma.checkoutRequest.update({
        where: { customerId_key: { customerId, key } },
        data: { orderId: order.id, responseJson: JSON.stringify(body) },
      });
      return { replayed: false, body };
    }, { isolationLevel: 'ReadCommitted' });
  }
}
```

When two requests arrive with the same customer and key, both may initially believe no row exists. That is why we do not query and then create if absent. `INSERT ... ON CONFLICT` selects a winner through the primary key. If another transaction holds the same key, the database waits until its outcome is known. If the first request commits, the second insert affects 0 rows, and the next query reads the committed, completed response. If the first request rolls back, the second can insert successfully and perform the operation.

This flow is written for PostgreSQL `ReadCommitted` statement-level visibility. The next query statement must be able to see what another transaction committed while the insert statement was waiting. This is why the outer isolation level is explicit. Do not call this method inside an already-open transaction. Fluo's nested `transaction` does not create a separate transaction, and it rejects nested options. The HTTP entry point creates the outermost boundary here, while the internal inventory methods reuse the context without options.

We also do not catch every Prisma unique-constraint error and convert it into "already processed." A unique-constraint violation on order items or another table is not evidence for idempotency replay. Here, the conflict target is fixed to `("customerId", "key")`, and the request fingerprint is compared against that record. Unrelated data errors are not hidden as normal duplicate requests.

The ordering of the replay branch before price recalculation and inventory reservation matters, too. If the first request reserved the last T-shirt and only lost its response, current stock on retry is 0. Checking prices and inventory again first would turn a previously successful request into an out-of-stock failure. A key that already succeeded returns that successful response. Even if the order later becomes `paid`, the creation response replays the original `pending_payment`. Retrieving the current status is the responsibility of authenticated `GET /orders/:id`.

Quote comparison applies only to new attempts. Even if the operator changes the catalog after the statement that reads prices, the order is created from the snapshot already calculated. This is the price commitment point defined in Chapter 5. A stronger policy that the catalog must remain unchanged until commit would require additional catalog locking or version checks. The current policy is that the customer's confirmed quote and the new order's calculated result must match.

## HTTP Explicitly Connects Identity and Errors

The following is the **complete file** `src/orders/orders.controller.ts`. It obtains a principal by running the existing blog authentication strategy with `@UseAuth('blog-jwt')`. If that boundary is not registered, or authentication fails and there is no principal, this controller ends with 401. Adding another customer's ID to the body is rejected by input validation, and neither passwords nor raw JWTs are included in responses.

```ts
import { Inject } from '@fluojs/core';
import {
  BadRequestException,
  Controller,
  Header,
  HttpCode,
  HttpException,
  Post,
  UnauthorizedException,
  getRequestHeader,
  type RequestContext,
} from '@fluojs/http';
import { UseAuth } from '@fluojs/passport';
import { CartInputError, SkuUnavailable } from '../cart/pricing.js';
import {
  OutOfStock,
  ReservationConflict,
} from '../inventory/inventory.service.js';
import {
  CheckoutInputError,
  IdempotencyConflict,
  QuoteChanged,
  parseCheckout,
  parseCheckoutKey,
} from './checkout-input.js';
import { CheckoutService } from './checkout.service.js';

@Controller('/orders')
@Inject(CheckoutService)
export class OrdersController {
  constructor(private readonly checkout: CheckoutService) {}

  @Post('/')
  @UseAuth('blog-jwt')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  async create(_input: unknown, context: RequestContext) {
    const customerId = context.principal?.subject;
    if (!customerId) throw new UnauthorizedException();
    try {
      const key = parseCheckoutKey(
        getRequestHeader(context.request, 'Idempotency-Key'),
      );
      const input = parseCheckout(context.request.body);
      const result = await this.checkout.create(customerId, key, input);
      context.response.setHeader(
        'Idempotency-Replayed', result.replayed ? 'true' : 'false',
      );
      return result.body;
    } catch (error) {
      if (error instanceof CartInputError || error instanceof CheckoutInputError) {
        throw new BadRequestException(error.message);
      }
      if (error instanceof IdempotencyConflict) {
        throw new HttpException(409, error.message, { code: 'IDEMPOTENCY_CONFLICT' });
      }
      if (error instanceof QuoteChanged) {
        throw new HttpException(409, error.message, { code: 'QUOTE_CHANGED' });
      }
      if (error instanceof SkuUnavailable || error instanceof OutOfStock) {
        throw new HttpException(409, 'Requested items are unavailable.', {
          code: 'ITEMS_UNAVAILABLE',
        });
      }
      if (error instanceof ReservationConflict) {
        throw new HttpException(409, error.message, { code: 'RESERVATION_CONFLICT' });
      }
      throw error;
    }
  }
}
```

Both creation and replay use the original success status, 201. The body is identical, but the diagnostic `Idempotency-Replayed` header differs. This is a contract preserving the status and body of the successful response, not a promise that all HTTP bytes are identical. There is no need to make request IDs or transmission times match the initial request. `no-store` explicitly prevents caches from retaining a response containing personal information.

`HttpException(409, message, { code })` is an actual public Fluo constructor. Do not assume the framework inspects a general `Error` name and automatically selects 409. Invalid structure is 400, unauthenticated access is 401, and unavailable items or changed quotes at purchase time are business conflicts represented by 409. Because this route is the boundary for attempting order creation, discontinuing a previously existing SKU is also reported as a conflict. When a specific order or product is retrieved by its address, a nonexistent resource is handled as 404 at that separate query boundary.

The following is the **updated registration file** `src/orders/orders.module.ts`. `CartModule` and `InventoryModule` each export their required services and share the same `BlogDatabaseModule` registration. Import `AuthModule` directly as well, so that this module's guard can see the existing `BlogJwtStrategy`. Do not assume the authentication strategy imported by `CartModule` is automatically re-exported. With the root `src/app.ts` importing `OrdersModule` as before, the order route is added to the same application.

```ts
import { Module } from '@fluojs/core';
import { AuthModule } from '../auth/auth.module.js';
import { CartModule } from '../cart/cart.module.js';
import { BlogDatabaseModule } from '../database/blog-database.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { CheckoutService } from './checkout.service.js';
import { OrderInventoryService } from './order-inventory.service.js';
import { OrderTransitionsService } from './order-transitions.service.js';
import { OrdersController } from './orders.controller.js';

@Module({
  imports: [BlogDatabaseModule, AuthModule, CartModule, InventoryModule],
  providers: [CheckoutService, OrderTransitionsService, OrderInventoryService],
  controllers: [OrdersController],
  exports: [OrderInventoryService],
})
export class OrdersModule {}
```

## Send the Confirmed Cart Response as an Order

If you agree to the per-item amounts and total in `cartQuote.quote` from Chapter 5's product detail console experiment, continue with the following **browser execution snippet**. Use `token` and `cartQuote` from the same tab. The body to retain is `cartQuote.request`, not the whole `quote` or `customerId`. This stage requires the migrations from Chapters 6-8 to be applied and sufficient saleable quantity for `Stock.sku = FLUO-TEE-BLK-M`.

```js
const checkoutKey = crypto.randomUUID();
const checkoutBody = JSON.stringify(cartQuote.request);
const submitCheckout = () => fetch('/orders', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': checkoutKey,
  },
  body: checkoutBody,
});
const orderReply = await submitCheckout();
const orderResult = await orderReply.json();
console.log(orderReply.status, orderResult);
```

Success is 201, and the creation response contains `pending_payment`, `version: 0`, and `totalMinor: "56000"` for the fixture above. This does not mean payment succeeded. If the response is lost and the outcome is unknown, run `submitCheckout()` again without generating a new key. On 409 `QUOTE_CHANGED`, obtain a new quote through Chapter 5's `/cart`, agree to it again, and then generate a new key. Do not silently retry an increased amount that has not been agreed to.

## Check That Discarding the Response Does Not Decrement Inventory Twice

First, test the input fingerprint without a database. The following is the **complete pure test file** `src/orders/checkout-input.test.ts`. Build it in the same way as Chapter 5's calculation tests, then run it with Node.js 24's test runner. It verifies that the same meaning produces the same fingerprint, not which letters are used.

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { cartResponse, parseCartRequest } from '../cart/cart-input.js';
import { priceCart } from '../cart/pricing.js';
import {
  CheckoutInputError,
  checkoutFingerprint,
  parseCheckout,
  parseCheckoutKey,
} from './checkout-input.js';

const body = {
  currency: 'KRW',
  lines: [
    { sku: 'FLUO-TEE-BLK-M', quantity: 1 },
    { sku: 'STICKER-LOGO', quantity: 2 },
  ],
  quoteHash: 'a'.repeat(64),
};

test('accepts the cart response request without prices or customer identity', () => {
  const lines = parseCartRequest({ lines: [{ sku: 'FLUO-TEE-BLK-M', quantity: 2 }] });
  const quote = priceCart(lines, [{
    sku: 'FLUO-TEE-BLK-M', currency: 'KRW', unitMinor: 29000n,
    discountMinor: 1000n, active: true, productStatus: 'published',
  }]);
  const response = cartResponse('reader-1', quote);
  const input = parseCheckout(JSON.parse(JSON.stringify(response.request)));
  assert.deepEqual(input.lines, lines);
  assert.equal(input.quoteHash, quote.quoteHash);
  assert.equal(response.quote.totalMinor, '56000');
  assert.throws(() => parseCheckout(response), CheckoutInputError);
});

test('line order does not change the request fingerprint', () => {
  const first = parseCheckout(body);
  const second = parseCheckout({ ...body, lines: [...body.lines].reverse() });
  assert.equal(
    checkoutFingerprint('reader-1', first),
    checkoutFingerprint('reader-1', second),
  );
});

test('customer and accepted quote belong to the request identity', () => {
  const input = parseCheckout(body);
  assert.notEqual(
    checkoutFingerprint('reader-1', input),
    checkoutFingerprint('reader-2', input),
  );
  assert.notEqual(
    checkoutFingerprint('reader-1', input),
    checkoutFingerprint('reader-1', { ...input, quoteHash: 'b'.repeat(64) }),
  );
});

test('rejects duplicate header values and client-supplied identity', () => {
  assert.throws(
    () => parseCheckoutKey(['checkout-key-0001', 'checkout-key-0002']),
    CheckoutInputError,
  );
  assert.throws(
    () => parseCheckout({ ...body, customerId: 'another-reader' }),
    CheckoutInputError,
  );
});
```

An experiment covering HTTP and the database together is also necessary. The following is the **complete experiment function file** `src/orders/checkout.probe.ts`. It accepts the URL of a running development application, a test token obtained through the existing authentication path, and a valid `CheckoutInput` calculated from the current catalog. Prepare enough inventory to attempt the order. No actual payment is made. This code neither selects an external URL automatically nor creates a server.

```ts
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { CheckoutInput } from './checkout-input.js';

export async function probeCheckout(
  baseUrl: string,
  token: string,
  input: CheckoutInput,
) {
  const key = randomUUID();
  const url = new URL('/orders', baseUrl);
  const send = (payload: CheckoutInput) => fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  const replies = await Promise.all([send(input), send(input)]);
  assert.deepEqual(replies.map(reply => reply.status), [201, 201]);
  const bodies: unknown[] = await Promise.all(replies.map(reply => reply.json()));
  assert.deepEqual(bodies[0], bodies[1]);
  assert.deepEqual(
    replies.map(reply => reply.headers.get('Idempotency-Replayed')).sort(),
    ['false', 'true'],
  );
  const retry = await send(input);
  assert.equal(retry.status, 201);
  assert.equal(retry.headers.get('Idempotency-Replayed'), 'true');
  assert.deepEqual(await retry.json(), bodies[0]);
  const changed = await send({
    ...input,
    quoteHash: input.quoteHash === 'a'.repeat(64) ? 'b'.repeat(64) : 'a'.repeat(64),
  });
  assert.equal(changed.status, 409);
  assert.equal(
    (await changed.json() as { error: { code: string } }).error.code,
    'IDEMPOTENCY_CONFLICT',
  );
  return { key, body: bodies[0] };
}
```

The concurrent calls in this function are an HTTP integration check, not proof that the two transactions necessarily tried to claim the key at the same time. In a deterministic contention test, use two development connections to insert the same primary key, and confirm through database lock observation that the second waits for the first's uncommitted key. Verify separately that committing the first takes the replay branch and rolling it back takes the new-execution branch. Do not insert arbitrary delays and assume contention occurred.

Inspecting the database using the key returned by the experiment function must show one `CheckoutRequest` row and one linked `Order`. There must also be one `Reservation` per item in that order, and inventory must have decreased by each quantity only once. For an account with existing orders, inspect the order linked to this key rather than checking that the total order count is 1. Matching IDs in two responses are not enough. A faulty implementation could send the same response while still adding separate reservations.

Test response loss by obtaining a signal that the server has completed its commit, then retransmitting the same key without using the first response body. Cutting the client connection arbitrarily early may cancel the order transaction itself, testing a different case. Separately, force insufficient inventory: the key claim, order, items, and reservations must all roll back. After replenishing the product, retrying with the same input and key must allow a new execution.

This manuscript does not contain results showing this experiment run against a completed, running shop or a PostgreSQL connection. Pure input tests, HTTP replay verification, and database row and lock inspection are different kinds of evidence. Do not substitute the previously verified early `examples/fluo-blog` execution for an integration pass on this order path.

## Define the Guarantee Period and Responsibility for Failures

Deleting an idempotency record allows the same key to create a new order again. This example therefore has no automatic deletion job. If storage volume becomes a problem, first define the customer's retry window and the order retention policy. One option is to reduce the stored response while retaining the key-to-order link longer, but that would require changing the response replay contract. Adding a number such as deletion after 24 hours without a basis effectively designs in duplicate purchases after 25 hours.

There are also limits to how long a request with the same key can wait in the database. Connection pool exhaustion, transaction timeouts, or deadlocks can make it fail. Do not convert those errors into success or forcibly delete the existing record. The customer retries with the same key, and the next request checks the committed facts in the database again. The key principle is not to infer that the original order does not exist merely from a network error.

This approach fits order creation within a single database. Extending the same transaction to include calling a payment provider and saving its response would make database locks wait for an external network, and a database rollback could not cancel a successful external payment. That stage needs payment attempt identifiers, the provider's idempotency contract, webhook evidence, and reconciliation. One local idempotency table does not make processing happen exactly once across every system.

FluoShop can now reliably turn purchase intent into an order. A new attempt succeeds only after checking server prices and the customer's consent to the quote, fixing the order items, and reserving inventory. Retransmitting the same attempt shows that order again. In the next chapter, we pass this `pending_payment` order ID to the payment boundary while keeping the order module separate from a particular payment provider's SDK and network failure behavior.

## Evidence and Further Reading

- [HTTP public API and preservation of header shapes](../../packages/http/README.md)
- [HTTP public exports](../../packages/http/src/index.portable.ts), [Principal and RequestContext types](../../packages/http/src/types.ts)
- [HTTP error constructors and serialization](../../packages/http/src/exceptions.ts), [header helper contract tests](../../packages/http/src/header-helpers.test.ts)
- [Prisma facade, strict mode, and transaction options](../../packages/prisma/README.md)
- [Transaction implementation](../../packages/prisma/src/service.ts), [module and transaction contract tests](../../packages/prisma/src/module.test.ts)
- [Price quotes and fingerprints](./ch05-cart-and-pricing.md), [inventory reservations and rollback](./ch07-inventory-concurrency.md)

[Previous: What If Two People Buy the Last T-Shirt?](./ch07-inventory-concurrency.md) | [Volume 2 Contents](./toc.md) | [Next: Keeping the Payment Provider Outside the Application](./ch09-payment-boundary.md)
