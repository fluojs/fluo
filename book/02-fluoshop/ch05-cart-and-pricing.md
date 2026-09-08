# Why You Cannot Trust Cart Prices

<!-- book:volume=02-fluoshop;chapter=05 -->

[Previous: Connecting the Blog to the Buying Experience](./ch04-storefront.md) | [Volume 2 Contents](./toc.md) | [Next: Designing Orders as a State Machine](./ch06-order-state-machine.md)

## The Total on the Screen and the Amount the Seller Promises

In the previous chapter, FluoBlog readers gained the ability to follow a product link below a post and choose a SKU and quantity for a logo T-shirt. There is no `/cart` route yet, so this chapter connects an authenticated quote request for the first time. Accounts and login still belong to the blog. Opening the shop does not mean asking readers to sign up again. But on the eve of the first sale, the operator changes the T-shirt price from KRW 29,000 to KRW 31,000, and a problem appears. A reader who has kept the page open since morning still sees KRW 29,000. The JSON sent by the purchase button contains that amount, too. Which number should the server trust?

This is not just a matter of malicious price manipulation. Stale tabs, cached product cards, and incorrectly deployed frontends all cause the same discrepancy. A browser might send `unitMinor: 1`, but yesterday's price sent by an ordinary reader is no more authoritative for today's sale. Conversely, if the server silently substitutes the latest price and starts payment, it may charge more than the reader agreed to. Saying that the server is the authority on prices does not mean that customer consent can be skipped.

This chapter separates a cart, which expresses **intent to purchase**, from a quote, which is **an offer calculated by the server**. Cart input consists of SKUs and quantities. The server reads prices for SKUs currently available for sale and calculates discounts and totals. The screen displays that quote. Later, when creating an order, the server performs the same calculation again and stops the purchase if it differs from the quote the reader confirmed. It does not yet secure any products or take payment. The distinction between checking a price, creating an order, and securing inventory is the foundation for the next three chapters.

The execution baseline in this book is Node.js 24 and pnpm 10, with PostgreSQL and Prisma for the database. The following code belongs to the reader-created `fluo-blog` application. It does not imply that this repository contains a shop application completed up to this stage. The existing `examples/fluo-blog` provides evidence for the early HTTP and DI paths, not a checkpoint with the cart schema below already applied.

## Define What the Data Means Before Calculating Prices

The unit of sale is the `ProductVariant` created in Chapter 3. We continue using its `sku`, `priceMinor`, `active`, and parent `Product` relationship. A variant is saleable only when the parent's `status` is `published` and the variant is active. A row whose SKU remains active after the product has been taken down is also rejected from a quote. The `cart` module only reads this data; it does not copy it into a separate SKU table.

The `discountMinor BigInt @default(0)` field added to the model, DTO, and public response in Chapter 3 is a **per-unit discount**. Omitted administrator input is stored as 0, so existing full-price registrations remain valid. The database's `ProductVariant_discountMinor_check` enforces `0 <= discountMinor <= priceMinor`. The screen in Chapter 4 likewise subtracts this per-unit discount and multiplies by the quantity. Here, we convert the existing model into a `PriceRow` for calculation rather than generating it again.

| Stored field | Calculation input | Meaning |
| --- | --- | --- |
| `ProductVariant.priceMinor` | `PriceRow.unitMinor` | List price before discounts, as a `bigint` |
| `ProductVariant.discountMinor` | `PriceRow.discountMinor` | Integer discount per unit |
| `ProductVariant.active` | `PriceRow.active` | Whether the SKU is active |
| `Product.status` | `PriceRow.productStatus` | Whether the parent product is published |

We use `BigInt` on the assumption that values fit PostgreSQL's signed 64-bit integer range. TypeScript's `bigint` can calculate larger values, so a successful calculation does not mean its result can be stored. Check the range of prices, discounts, and totals separately. At this stage of the sale, only KRW is allowed; we do not add other currencies without an exchange rate. Quantities must be positive integers, limited to 99 units per SKU and 20 distinct SKUs per cart. These are product policies for small-scale merchandise sales, not ORM limitations.

For the discounted exercise, use the `FLUO-TEE-BLK-M` row created in Chapter 3. The following is **SQL to update a development database fixture**. First confirm that the SKU exists and its parent product is `published`. The affected row count after applying it must be 1. Do not repopulate the SKU in a new store.

```sql
UPDATE "ProductVariant"
SET "priceMinor" = 29000, "discountMinor" = 1000
WHERE "sku" = 'FLUO-TEE-BLK-M';
```

There is also a reason to validate again on the server. Database constraints are the last line of defense for stored values, while the calculation function must uphold the meaning of the data it receives. Unit tests and other input paths may not pass through database constraints. Treat invalid catalog values as server-side data errors, not as the reader's 400 errors. An operator's invalid price and a customer's invalid quantity have different causes and different parties responsible for recovery.

## Complete the Pure Calculation First

The following is the **complete file** `src/cart/pricing.ts`. It can run without HTTP or DI. The function that normalizes network input is separate from the function that calculates prices already read. This is not an exercise in creating more interfaces; it separates the parts that need a database to reproduce a failure from those that do not.

```ts
import { createHash } from 'node:crypto';

export const MAX_MINOR = 9_223_372_036_854_775_807n;

export class CartInputError extends Error {}
export class CatalogDataError extends Error {}
export class SkuUnavailable extends Error {}

export type CartLine = Readonly<{ sku: string; quantity: number }>;
export type PriceRow = Readonly<{
  sku: string;
  currency: string;
  unitMinor: bigint;
  discountMinor: bigint;
  active: boolean;
  productStatus: string;
}>;
export type PricedLine = Readonly<{
  sku: string;
  quantity: number;
  unitMinor: bigint;
  discountMinor: bigint;
  lineTotalMinor: bigint;
}>;
export type PriceQuote = Readonly<{
  currency: 'KRW';
  totalMinor: bigint;
  lines: readonly PricedLine[];
  quoteHash: string;
}>;

export function normalizeCart(value: unknown): CartLine[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    throw new CartInputError('Cart must contain 1 to 20 distinct items.');
  }
  const seen = new Set<string>();
  const lines = value.map((item: unknown): CartLine => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new CartInputError('Invalid cart item.');
    }
    const keys = Object.keys(item);
    if (keys.length !== 2 || !keys.includes('sku') || !keys.includes('quantity')) {
      throw new CartInputError('Only sku and quantity are accepted.');
    }
    if (!('sku' in item) || !('quantity' in item)) {
      throw new CartInputError('Missing cart item fields.');
    }
    const { sku, quantity } = item;
    if (typeof sku !== 'string' || !/^[A-Z0-9][A-Z0-9-]{2,39}$/.test(sku)) {
      throw new CartInputError('Invalid SKU.');
    }
    if (
      typeof quantity !== 'number' ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 99
    ) {
      throw new CartInputError('Quantity must be an integer from 1 to 99.');
    }
    if (seen.has(sku)) {
      throw new CartInputError('Duplicate SKU.');
    }
    seen.add(sku);
    return { sku, quantity };
  });
  return lines.sort((a, b) => a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0);
}

export function priceCart(
  cart: readonly CartLine[],
  rows: readonly PriceRow[],
): PriceQuote {
  const bySku = new Map(rows.map(row => [row.sku, row]));
  let totalMinor = 0n;
  const lines = cart.map((item): PricedLine => {
    const row = bySku.get(item.sku);
    if (!row || !row.active || row.productStatus !== 'published') {
      throw new SkuUnavailable(item.sku);
    }
    if (
      row.currency !== 'KRW' ||
      row.unitMinor < 0n ||
      row.unitMinor > MAX_MINOR ||
      row.discountMinor < 0n ||
      row.discountMinor > row.unitMinor
    ) {
      throw new CatalogDataError(row.sku);
    }
    const lineTotalMinor =
      (row.unitMinor - row.discountMinor) * BigInt(item.quantity);
    totalMinor += lineTotalMinor;
    if (lineTotalMinor > MAX_MINOR || totalMinor > MAX_MINOR) {
      throw new CartInputError('Order total exceeds the storage range.');
    }
    return {
      sku: item.sku,
      quantity: item.quantity,
      unitMinor: row.unitMinor,
      discountMinor: row.discountMinor,
      lineTotalMinor,
    };
  });
  const material = [
    'price-v1',
    'KRW',
    lines.map(line => [
      line.sku,
      line.quantity,
      line.unitMinor.toString(),
      line.discountMinor.toString(),
      line.lineTotalMinor.toString(),
    ]),
    totalMinor.toString(),
  ];
  const quoteHash = createHash('sha256')
    .update(JSON.stringify(material))
    .digest('hex');
  return { currency: 'KRW', totalMinor, lines, quoteHash };
}

export function quoteJson(quote: PriceQuote) {
  return {
    currency: quote.currency,
    totalMinor: quote.totalMinor.toString(),
    quoteHash: quote.quoteHash,
    lines: quote.lines.map(line => ({
      sku: line.sku,
      quantity: line.quantity,
      unitMinor: line.unitMinor.toString(),
      discountMinor: line.discountMinor.toString(),
      lineTotalMinor: line.lineTotalMinor.toString(),
    })),
  };
}
```

`priceCart` is an internal function that accepts the sorted, duplicate-free input returned by `normalizeCart`. Instead of copying the same quantity checks into every function, we make the trust boundary explicit. External entry points, including HTTP and batch processing, must normalize input first. We reject extra fields rather than silently ignoring client-supplied unit prices so that a faulty frontend deployment is discovered early. A request that violates the input contract should not succeed by accident.

The sort does not use locale-dependent string ordering. Restricting SKUs to ASCII and fixing the code-unit order makes identical input produce an identical sequence regardless of the server's locale. Combining duplicate SKUs is another possible policy, but it requires redefining the quantity limit and the meaning of the hash. Here, the screen combines quantities for the same SKU first, and the server rejects duplicates. This also makes it easier to maintain a one-to-one correspondence between an order line and an inventory reservation line.

Using a fixed per-unit discount rather than a discount rate is a choice for this stage that avoids rounding problems. If we later introduce a 15% coupon, we will need new policies for multiplication order, truncation units, and allocation of order-level discounts to individual items. Multiplying a number by `0.85` and patching things up with `Math.round` is not an extension of this design. The calculation must use integers and be able to explain how much discount was allocated to a particular unit when it is refunded.

`quoteHash` is not an authentication token. It is not signed with a secret key, and readers can know how it is calculated. The hash is a tool for comparing whether the quote the server calculates now is the same as the quote confirmed on the screen. Even if an attacker generates a different hash, they cannot change the server's amount calculation. Hashing only the total would miss a change where a T-shirt price increase and a sticker price decrease cancel each other out. That is why the array of unit prices, discounts, and quantities is included, too. `price-v1` allows a changed calculation policy to be distinguished from earlier quotes.

## Connect Prisma Without Handing It the Pricing Rules

For the database connection, reuse `BlogDatabaseModule` in `src/database/blog-database.module.ts`, already registered by the root. The `forRootAsync({ global: true, inject: [AppSettings], useFactory: ... })` from Chapter 1 is the sole registration. Do not create a new client variable or wrapper. This chapter's single query has no atomic writes, but the orders and inventory in Chapters 6-8 must share the active transaction context of the same `PrismaService`.

The following is the **complete file** `src/cart/cart.service.ts`. The generated Prisma Client must know about the `ProductVariant` model from Chapter 3. `PrismaServiceFacade` is a type; the DI token is `PrismaService`, an actual value. Using an interface name as a constructor parameter type does not cause injection to happen.

```ts
import { Inject } from '@fluojs/core';
import { PrismaService, type PrismaServiceFacade } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import { normalizeCart, priceCart } from './pricing.js';

@Inject(PrismaService)
export class CartService {
  constructor(private readonly prisma: PrismaServiceFacade<PrismaClient>) {}

  async quote(rawLines: unknown) {
    const cart = normalizeCart(rawLines);
    const rows = await this.prisma.productVariant.findMany({
      where: { sku: { in: cart.map(line => line.sku) } },
      select: {
        sku: true,
        currency: true,
        priceMinor: true,
        discountMinor: true,
        active: true,
        product: { select: { status: true } },
      },
    });
    return priceCart(cart, rows.map(row => ({
      sku: row.sku,
      currency: row.currency,
      unitMinor: row.priceMinor,
      discountMinor: row.discountMinor,
      active: row.active,
      productStatus: row.product.status,
    })));
  }
}
```

The price query passes both the parent status and SKU activation flag to the calculation boundary. Because `priceCart` checks every requested line, it does not return a successful partial quote with an unavailable line removed. This rule matches the `published + active` condition used by the public listing and detail pages.

## Expose an Authenticated Cart Quote Through a Real Route

This chapter's `POST /cart` neither persists a cart nor reserves inventory. It is a read operation that quotes the selection for an existing authenticated account. Do not put a JWT in a GET form or trust a `customerId` in the form body. Use the existing `BlogJwtStrategy` exported by `AuthModule` to obtain `principal.subject`.

The following is the **complete file** `src/cart/cart-input.ts`. The body accepts only `lines`. In the response, `quote` is the calculated result for the customer to read, and `request` contains the values to send unchanged to Chapter 8's `POST /orders` after agreeing to that result. `customerId` identifies the authenticated subject of the response, but is not included in the checkout body.

```ts
import {
  CartInputError,
  normalizeCart,
  quoteJson,
  type PriceQuote,
} from './pricing.js';

export function parseCartRequest(value: unknown) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || Object.keys(value).length !== 1 || !('lines' in value)) {
    throw new CartInputError('Only lines are accepted.');
  }
  return normalizeCart(value.lines);
}

export function cartResponse(customerId: string, quote: PriceQuote) {
  return {
    customerId,
    request: {
      currency: quote.currency,
      lines: quote.lines.map(line => ({ sku: line.sku, quantity: line.quantity })),
      quoteHash: quote.quoteHash,
    },
    quote: quoteJson(quote),
  };
}
```

The following is the **complete file** `src/cart/cart.controller.ts`. `@UseAuth('blog-jwt')` runs the existing strategy, and only the principal of a successful request is passed to the service boundary. Invalid body structure produces 400, a discontinued or nonexistent SKU produces 409 for the entire quote, and authentication failure produces 401. Incorrectly stored amounts and database connection failures are not converted into customer input failures.

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
  type RequestContext,
} from '@fluojs/http';
import { UseAuth } from '@fluojs/passport';
import { cartResponse, parseCartRequest } from './cart-input.js';
import { CartService } from './cart.service.js';
import { CartInputError, SkuUnavailable } from './pricing.js';

@Controller('/cart')
@Inject(CartService)
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Post('/')
  @UseAuth('blog-jwt')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async quote(_input: unknown, context: RequestContext) {
    const customerId = context.principal?.subject;
    if (!customerId) throw new UnauthorizedException();
    try {
      const lines = parseCartRequest(context.request.body);
      return cartResponse(customerId, await this.cart.quote(lines));
    } catch (error) {
      if (error instanceof CartInputError) {
        throw new BadRequestException(error.message);
      }
      if (error instanceof SkuUnavailable) {
        throw new HttpException(409, 'Requested items are unavailable.', {
          code: 'ITEMS_UNAVAILABLE',
        });
      }
      throw error;
    }
  }
}
```

The following is the **complete file** `src/cart/cart.module.ts`. Add `CartModule` to the existing imports in the root `src/app.ts`. Import `AuthModule` here so this module's authentication guard can see the exported `BlogJwtStrategy`. Do not create a separate Passport registration or a new account service.

```ts
import { Module } from '@fluojs/core';
import { AuthModule } from '../auth/auth.module.js';
import { BlogDatabaseModule } from '../database/blog-database.module.js';
import { CartController } from './cart.controller.js';
import { CartService } from './cart.service.js';

@Module({
  imports: [BlogDatabaseModule, AuthModule],
  providers: [CartService],
  controllers: [CartController],
  exports: [CartService],
})
export class CartModule {}
```

The service makes one `findMany` query, not repeated queries for each SKU. Under PostgreSQL's usual `ReadCommitted` setup, the calculation uses the set of prices visible to that statement. Nothing prevents the operator from changing a price after the quote is returned. Holding a database transaction open while the customer reads the screen would turn their deliberation time into lock time. Recalculation and quote comparison at order time take responsibility for that gap.

`CartService` does not force a transaction of its own. If the order service later calls it inside a transaction on the same `PrismaService`, the facade uses the active client. Outside a transaction, it uses the root client. Separate `forRoot` registrations in `CartModule` and `OrdersModule` could break this sharing, so retain the structure that references the same `BlogDatabaseModule` object from the root.

## Continue from the Product Detail Selection to a Quote Request

After confirming the selection at `/products/fluo-logo-tee?sku=FLUO-TEE-BLK-M&quantity=2` from Chapter 4, run the following **browser execution snippet** in the console of the same tab in the development application. Enter the access token for the existing test account obtained through `POST /auth/login`. Send the token only in the Authorization header, not in a URL or HTML. Do not pretend that a GET form alone sends a Bearer header. This snippet directly verifies the request connection at a stage where hydration and a persistent cart UI have not yet been installed.

```js
const selection = new URL(location.href).searchParams;
const token = prompt('Paste the access token from /auth/login');
if (!token) throw new Error('Sign in before requesting a quote.');
const quoteReply = await fetch('/cart', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    lines: [{ sku: selection.get('sku'), quantity: Number(selection.get('quantity')) }],
  }),
});
if (!quoteReply.ok) throw new Error(`Quote failed: ${quoteReply.status}`);
const cartQuote = await quoteReply.json();
console.log(cartQuote.quote);
```

For the fixture with a list price of KRW 29,000, a per-unit discount of KRW 1,000, and a quantity of 2, `quote.totalMinor === "56000"` must hold. The response consists of `customerId`, `request`, and `quote`. `request` contains `currency: "KRW"`, `lines` with only SKUs and quantities, and the calculated 64-character `quoteHash`. All unit prices, discounts, and totals in `quote` are decimal strings. Show the response amounts first, and send `request` to the order route in Chapter 8 only after the customer agrees. Do not call `/orders` yet.

Changing the product to `draft` or `archived` and sending the same request again must produce 409 even if its SKU remains active. Omitting the token must produce 401; inserting `customerId` or a unit price into the body must produce 400. The quote request must perform no writes to `Stock`, `Reservation`, or `Order`. Those models do not exist yet in this chapter, and the quote remains read-only after they are added later.

## Test a Stale Quote Before a Tampered Amount

The following is the **complete pure unit test file** `src/cart/pricing.test.ts`. It can run with Node's test runner and does not require standard decorator transformation. Use the existing application build configuration, whose TypeScript build handles relative imports with `.js` extensions, and run the resulting artifact with `node --test`; alternatively, use the TypeScript loading path of the existing test runner.

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CartInputError,
  MAX_MINOR,
  SkuUnavailable,
  normalizeCart,
  priceCart,
  quoteJson,
} from './pricing.js';

const tee = {
  sku: 'FLUO-TEE-BLK-M',
  currency: 'KRW',
  unitMinor: 29_000n,
  discountMinor: 1_000n,
  active: true,
  productStatus: 'published',
};

test('applies per-unit discounts and emits decimal strings', () => {
  const cart = normalizeCart([{ sku: tee.sku, quantity: 2 }]);
  const quote = priceCart(cart, [tee]);
  assert.equal(quote.totalMinor, 56_000n);
  assert.equal(quoteJson(quote).totalMinor, '56000');
  assert.doesNotThrow(() => JSON.stringify(quoteJson(quote)));
});

test('rejects client prices, duplicate SKUs, and fractional quantities', () => {
  for (const input of [
    [{ sku: tee.sku, quantity: 1, unitMinor: '1' }],
    [{ sku: tee.sku, quantity: 1 }, { sku: tee.sku, quantity: 1 }],
    [{ sku: tee.sku, quantity: 1.5 }],
  ]) {
    assert.throws(() => normalizeCart(input), CartInputError);
  }
});

test('changes the quote hash without mutating the earlier quote', () => {
  const cart = normalizeCart([{ sku: tee.sku, quantity: 1 }]);
  const before = priceCart(cart, [tee]);
  const after = priceCart(cart, [{ ...tee, unitMinor: 31_000n }]);
  assert.notEqual(before.quoteHash, after.quoteHash);
  assert.equal(before.totalMinor, 28_000n);
  assert.equal(after.totalMinor, 30_000n);
});

test('rejects an active variant when its parent is not published', () => {
  const cart = normalizeCart([{ sku: tee.sku, quantity: 1 }]);
  for (const productStatus of ['draft', 'archived']) {
    assert.throws(() => priceCart(cart, [{ ...tee, productStatus }]), SkuUnavailable);
  }
});

test('rejects inactive SKUs and totals outside the storage range', () => {
  const cart = normalizeCart([{ sku: tee.sku, quantity: 2 }]);
  assert.throws(
    () => priceCart(cart, [{ ...tee, active: false }]),
    SkuUnavailable,
  );
  assert.throws(
    () => priceCart(cart, [{ ...tee, unitMinor: MAX_MINOR, discountMinor: 0n }]),
    CartInputError,
  );
});
```

Verify the request-to-response connection with the **complete pure test file** `src/cart/cart-input.test.ts`. Do not fake a passing authentication strategy here. This test covers only the value boundary that constructs a response from an already authenticated subject.

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { cartResponse, parseCartRequest } from './cart-input.js';
import { CartInputError, priceCart } from './pricing.js';

test('returns checkout fields without forwarding client identity or prices', () => {
  const lines = parseCartRequest({ lines: [{ sku: 'FLUO-TEE-BLK-M', quantity: 2 }] });
  const quote = priceCart(lines, [{
    sku: 'FLUO-TEE-BLK-M', currency: 'KRW', unitMinor: 29000n,
    discountMinor: 1000n, active: true, productStatus: 'published',
  }]);
  const response = cartResponse('reader-1', quote);
  assert.equal(response.customerId, 'reader-1');
  assert.deepEqual(response.request, {
    currency: 'KRW', lines, quoteHash: quote.quoteHash,
  });
  assert.equal(response.quote.totalMinor, '56000');
  assert.doesNotThrow(() => JSON.stringify(response));
});

test('rejects identity and extra fields at the cart body boundary', () => {
  for (const body of [
    { lines: [{ sku: 'FLUO-TEE-BLK-M', quantity: 1 }], customerId: 'reader-2' },
    { lines: [{ sku: 'FLUO-TEE-BLK-M', quantity: 1, unitMinor: '1' }] },
    { lines: [{ sku: 'FLUO-TEE-BLK-M', quantity: 1 }], currency: 'USD' },
  ]) {
    assert.throws(() => parseCartRequest(body), CartInputError);
  }
});
```

Database integration tests establish different facts. Put a T-shirt and stickers into a development-only PostgreSQL database and call the real `CartService.quote`. If even one nonexistent SKU is included, the entire quote must fail. Returning one of two requested rows from `findMany` must not result in success based on that one row alone. A write attempting to change the currency to `USD` must be rejected by the database constraint, while passing mock catalog data directly to the function must produce `CatalogDataError`.

For the stale-quote test, retain a quote, commit a price change in a separate transaction, and query again. There is no need to wait for a fixed amount of time. Completion of the price-change commit is the signal to start the next query. The two quote hashes must differ, and the retained first quote's amount must remain unchanged. This chapter does not include execution results for this PostgreSQL integration experiment. Even if the pure calculation tests pass, do not extend that claim to cover database connectivity, generated delegates, or transaction sharing.

## Persisting a Cart and Guaranteeing a Price Are Different Decisions

At first, it is enough to store only SKUs and quantities in the signed-in reader's browser. When readers need to continue a cart across devices, add persistent carts to the `cart` module. At that point, obtain `customerId` from the existing authenticated principal; do not read another reader's cart using an ID supplied in the request body. Do not put an authoritative total in the stored cart, either. You may cache the last quote for display, but recalculate when deciding whether a purchase can proceed.

By contrast, a promise to guarantee the price for 30 minutes after an item is added to the cart is not a matter of storage location. It requires persisting a server-issued quote tied to the customer, an expiration time, and a pricing policy version. You must also decide whether to bind discount budgets and inventory to it. FluoShop makes no such promise at present. The quote on the screen is an offer whose changes can be detected, not a contract guaranteed to remain valid until the next order confirmation.

By the end of this chapter, the operator is prepared both to distrust customer-supplied prices and to avoid proceeding with an increased amount the customer has not confirmed. A quote is still not an order. Once recorded as an order, an item's historical unit price and discount must not change when the product's unit price changes. In the next chapter, we attach an order ID and status to that snapshot and use code to restrict which events can take it from awaiting payment to which subsequent states.

## Evidence and Further Reading

- [Prisma public usage and strict transaction contract](../../packages/prisma/README.md)
- [Prisma public exports](../../packages/prisma/src/index.ts), [facade and active transaction selection implementation](../../packages/prisma/src/service.ts)
- [Module registration and client ownership implementation](../../packages/prisma/src/module.ts), [module and type contract tests](../../packages/prisma/src/module.test.ts)
- [Existing accounts, JWT authentication, and AuthModule](../01-fluoblog/ch14-authentication.md), [UseAuth and strategy visibility](../../packages/passport/README.md)
- [HTTP requests, responses, and error codes](../../packages/http/README.md)
- [Class-level Inject and module boundaries](../../packages/core/README.md)
- [Transaction context contract](../../docs/architecture/transactions.md)

[Previous: Connecting the Blog to the Buying Experience](./ch04-storefront.md) | [Volume 2 Contents](./toc.md) | [Next: Designing Orders as a State Machine](./ch06-order-state-machine.md)
