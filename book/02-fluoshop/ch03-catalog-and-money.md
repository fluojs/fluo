# Modeling a T-shirt as a Product

<!-- book:volume=02-fluoshop;chapter=03 -->

[Previous: Separating Content, Catalog, and Order Boundaries](./ch02-domain-boundaries.md) - [Volume 2 Contents](./toc.md) - [Next: Building the Journey from Blog to Purchase](./ch04-storefront.md)

## The Same Name Does Not Mean the Same Item

After the T-shirt introduction post is published, a reader asks whether they can buy one black shirt in size M and another in size L. The product from the previous chapter has only an ID and a name, so it cannot distinguish the two shirts. Adding a single `size` string to the product limits each product to one size; duplicating the name to create two products means editing their shared description and publication status separately. It is time to separate the unit that describes a product from the unit people actually select and whose stock we count.

The product `fluo-logo-tee` represents one kind of T-shirt as readers understand it. The actual sales units are SKUs such as `FLUO-TEE-BLK-M` and `FLUO-TEE-BLK-L`. The two SKUs can have different stock levels even at the same price. In this chapter, we separate products from sales units and give each sales unit an exact currency and amount. We do not temporarily tuck inventory quantities into this model. Inventory reservations and contention have a separate lifecycle.

Another question arrives: "The site says 29,000 won, so why does the order confirmation show a different amount?" We do not have orders yet, but the paths that lead to this error are already clear. Stripping commas from a display string to calculate a price, repeatedly adding floating-point values, or directly storing a client-supplied price loses the amount's origin and unit. We therefore decide how prices are stored, calculated, and transmitted before displaying them on a screen.

The base currency in this chapter is KRW. We store integers in minor currency units, use `bigint` for TypeScript calculations, and use decimal strings at the JSON boundary. In KRW, the integer 29,000 means 29,000 won. We do not yet generalize the decimal-place rules of other currencies. We also avoid building a screen that accepts multiple currencies first and then incorrectly interpreting them all in the same integer unit.

## A Schema for Products and Sales Units

The following is a **schema fragment** that replaces the existing `Product` and adds `ProductVariant` in `prisma/schema.prisma`. Reuse the `ProductStatus` enum from Chapter 1, and leave the PostgreSQL datasource and existing blog models intact.

```prisma
model Product {
  id       String           @id @default(cuid())
  slug     String           @unique
  name     String
  status   ProductStatus    @default(draft)
  version  Int              @default(1)
  variants ProductVariant[]

  @@index([status, id])
}

model ProductVariant {
  id         String  @id @default(cuid())
  productId  String
  product    Product @relation(fields: [productId], references: [id], onDelete: Restrict)
  sku        String  @unique @db.VarChar(40)
  label      String  @db.VarChar(60)
  currency   String  @db.VarChar(3)
  priceMinor BigInt  @db.BigInt
  discountMinor BigInt @default(0) @db.BigInt
  active     Boolean @default(true)
  version    Int     @default(1)

  @@index([productId, active])
}
```

The product name and `label` have different roles. The name describes the T-shirt itself; a label such as `Black / M` describes that SKU's option. Because the SKU is an identifier used by inventory and orders, do not recreate it when the name changes. Reusing an incorrectly registered SKU for a genuinely different item changes the meaning of past records. This chapter's add API only creates SKUs; it does not edit or recycle them.

`active` determines whether to expose that sales unit in the listing. It does not mean stock is available. If `Product.status` is `draft`, the product is not public even if it has active sales units; if a product is `published` but has no active sales units, it is excluded from public reads. This rule prevents the name-only product registered in Chapter 1 from appearing as a card with neither prices nor options.

`onDelete: Restrict` makes us consider the relationship when deleting a product with sales units. It does not, by itself, protect future order records. There is no order table yet, and orders need a separate rule for copying values at the time of purchase. A relationship constraint protects the existence of a relationship; a snapshot protects the meaning of a transaction. Do not confuse their responsibilities.

`discountMinor` is the discount per unit, and its default of 0 preserves the existing full-price sale. The cart in Chapter 5 reads this field too, so we do not create another SKU table. There are no coupons or percentage discounts yet; we use only a fixed discount amount entered by the operator.

Create a migration draft and include the following **additional SQL fragment** in the generated SQL. Manage business constraints that the Prisma model does not express through application-owned migrations.

```sql
ALTER TABLE "ProductVariant"
  ADD CONSTRAINT "ProductVariant_priceMinor_nonnegative"
  CHECK ("priceMinor" >= 0),
  ADD CONSTRAINT "ProductVariant_currency_krw"
  CHECK ("currency" = 'KRW'),
  ADD CONSTRAINT "ProductVariant_discountMinor_check"
  CHECK ("discountMinor" BETWEEN 0 AND "priceMinor");
```

PostgreSQL's signed `BIGINT` has a maximum of `9223372036854775807`. The type itself enforces the upper bound, while the CHECK rejects negative values. Administrative scripts or data imports can bypass API validation, so we add database constraints too. Conversely, showing database errors alone makes it hard to explain which input is wrong. Validation on both sides is not accidental duplicate implementation; each guards a different entry point.

Review the migration draft against the development database, apply it, and regenerate Prisma Client. Even when products already exist, do not fill in an arbitrary price of 0 just because they do not yet have sales units. Zero can be a valid price, but it does not mean "the price has not been decided yet." Keep products without sales units hidden and let the operator register actual prices.

## Define a Boundary for Money, Not Just Numbers

The following is the **complete file** `src/catalog/money.ts`. This small module clarifies input representation and integer limits rather than expanding the scope of calculations. The codes and fields in `DtoValidationError` are application-defined values, not a built-in Fluo money validator.

```ts
import { DtoValidationError } from '@fluojs/validation';

export const MAX_MINOR = 9223372036854775807n;

export type Money = {
  readonly currency: 'KRW';
  readonly minor: bigint;
};

function invalid(field: string, code: string): never {
  throw new DtoValidationError('Invalid catalog amount', [{
    field,
    code,
    message: code,
  }]);
}

export function parseMoney(
  currency: unknown,
  priceMinor: unknown,
  field = 'priceMinor',
): Money {
  if (currency !== 'KRW') {
    invalid('currency', 'UNSUPPORTED_CURRENCY');
  }
  if (typeof priceMinor !== 'string'
    || !/^(0|[1-9][0-9]{0,18})$/.test(priceMinor)) {
    invalid(field, 'MONEY_FORMAT');
  }
  const minor = BigInt(priceMinor);
  if (minor > MAX_MINOR) {
    invalid(field, 'MONEY_RANGE');
  }
  return { currency, minor };
}

export function discountPrice(price: Money, discountMinor: unknown): Money {
  const discount = parseMoney(price.currency, discountMinor, 'discountMinor');
  if (discount.minor > price.minor) {
    invalid('discountMinor', 'DISCOUNT_RANGE');
  }
  return { currency: price.currency, minor: price.minor - discount.minor };
}

export function lineTotal(price: Money, quantity: number): Money {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
    invalid('quantity', 'QUANTITY_RANGE');
  }
  const minor = price.minor * BigInt(quantity);
  if (minor > MAX_MINOR) {
    invalid('totalMinor', 'MONEY_RANGE');
  }
  return { currency: price.currency, minor };
}

export function moneyJson(money: Money) {
  return {
    currency: money.currency,
    amountMinor: money.minor.toString(),
  };
}
```

`parseMoney()` accepts `"29000"` but rejects `29000`, `"29,000"`, `"2.9e4"`, `"-1"`, and `"029000"`. We choose one canonical representation over the convenience of normalizing different notations to the same value. The API does not accept thousands separators, so parsing does not vary with locale settings. Limiting length before calling `BigInt()` also avoids a path that converts enormous strings into unbounded integers.

The regular expression alone cannot guarantee the database range: some 19-digit numbers exceed signed `BIGINT`. Conversely, going through `Number()` first just to check the range can change a value as soon as it exceeds the safe integer range. The order matters: go directly from string to `bigint`, then check the range.

The quantity limit of 99 in `lineTotal()` is this initial merchandise shop's per-line order limit. It does not mean there are 99 units in stock or that wholesale orders are supported. Calling `Number.isInteger()` first keeps fractions, infinity, and NaN from reaching `BigInt()`. Even when one price fits within the range, its total after multiplication by a quantity may not, so check the result too. The internal contract for this function takes a `Money` created by `parseMoney()`, not an arbitrary object constructed outside that boundary.

`bigint` is not a JSON number. Passing it directly to `JSON.stringify()` fails. `moneyJson()` explicitly creates a decimal string. Changing the global `BigInt.prototype.toJSON` or converting every `bigint` to `Number` either changes serialization for other code too or loses precision. Converting only the necessary fields at the boundary keeps internal calculations and external representations from contaminating each other.

## Persist Only Validated Sales Units

Operator input is external input too. The following is the **complete file** `src/catalog/create-variant.dto.ts`. DTO fields are populated during materialization, so declare them writable. Give required strings initial values and also add `@IsDefined()` to reject explicitly supplied `null` and `undefined`.

```ts
import {
  Equals,
  IsDefined,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from '@fluojs/validation';

export class CreateVariantDto {
  @IsDefined()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  productId = '';

  @IsDefined()
  @IsString()
  @Matches(/^[A-Z0-9][A-Z0-9-]{2,39}$/)
  sku = '';

  @IsDefined()
  @IsString()
  @Matches(/\S/)
  @MaxLength(60)
  label = '';

  @IsDefined()
  @Equals('KRW')
  currency = '';

  @IsDefined()
  @IsString()
  @Matches(/^(0|[1-9][0-9]{0,18})$/)
  priceMinor = '';

  @IsDefined()
  @IsString()
  @Matches(/^(0|[1-9][0-9]{0,18})$/)
  discountMinor = '0';
}
```

The package contract says ordinary field validators skip `null` and `undefined`. Therefore, `@IsString()` alone is not a declaration that an input is required. When an omitted required string retains its empty default, length and format checks apply; for explicit nullish values, `@IsDefined()` applies. Only `discountMinor` is optional, using `"0"` when omitted. Existing full-price registration requests continue to work, while explicit `null` is rejected. There is no implicit conversion that automatically turns numeric strings into numbers either. We chose amount strings as the contract from the outset, so we do not expect conversion here.

The following is the **complete file** `src/catalog/catalog.writer.ts`. Explicitly inject the `PrismaService` from the existing shared database registration and the actual validation engine. Administrator authentication is not an input field to this method. This service is called from internal administrative operations; we do not install a public HTTP write path in this chapter.

```ts
import { Inject } from '@fluojs/core';
import { PrismaService } from '@fluojs/prisma';
import { DefaultValidator } from '@fluojs/validation';
import { Prisma, type PrismaClient } from '@prisma/client';
import { CreateVariantDto } from './create-variant.dto.js';
import { discountPrice, parseMoney } from './money.js';

export type CreateVariantResult =
  | { readonly kind: 'created'; readonly id: string; readonly sku: string }
  | { readonly kind: 'duplicate-sku' }
  | { readonly kind: 'missing-product' };

@Inject(PrismaService, DefaultValidator)
export class CatalogWriter {
  constructor(
    private readonly db: PrismaService<PrismaClient>,
    private readonly validator: DefaultValidator,
  ) {}

  async createVariant(raw: unknown): Promise<CreateVariantResult> {
    const dto = await this.validator.materialize(raw, CreateVariantDto, {
      undeclaredProperties: 'reject',
    });
    const price = parseMoney(dto.currency, dto.priceMinor);
    const net = discountPrice(price, dto.discountMinor);

    try {
      const created = await this.db.current().productVariant.create({
        data: {
          productId: dto.productId,
          sku: dto.sku,
          label: dto.label,
          currency: price.currency,
          priceMinor: price.minor,
          discountMinor: price.minor - net.minor,
          active: true,
        },
        select: { id: true, sku: true },
      });
      return { kind: 'created', id: created.id, sku: created.sku };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          return { kind: 'duplicate-sku' };
        }
        if (error.code === 'P2003') {
          return { kind: 'missing-product' };
        }
      }
      throw error;
    }
  }
}
```

By default, `materialize()` preserves safe additional own enumerable properties. Do not assume that `active`, `version`, or `customerId` will silently disappear because they are absent from the DTO class. Here we choose `undeclaredProperties: 'reject'` and also specify each field to persist individually. We do not pass `data: { ...dto }`, so adding an administrative input to the DTO later will not automatically broaden database write permissions.

The two error branches follow the current schema. In this create path, the caller-supplied unique value is the SKU, and the foreign key is the product ID. If requirements arise to handle generated-ID collisions or other unique constraints added later, the error classification must be narrowed again. Unexpected connection errors and timeouts are rethrown, not converted into `duplicate-sku`. Treating all database errors as 409 would misdiagnose outages as input conflicts.

The database creates a single row atomically, so we do not open a separate `transaction()` here. There is also no need to check for a duplicate SKU before inserting. Even with a preliminary check, two operations can both read that the SKU is absent. Interpreting the unique constraint's result is the final arbiter of consistency. The foreign key likewise makes the final decision about whether the product exists.

HTTP and internal results are separate. When connecting this to the existing administrator-authorized path later, map validation failure to 400, a missing product to 404, and a duplicate SKU to 409. We do not claim that the `kind` strings or `DtoValidationError` objects returned here automatically produce those HTTP responses in every calling environment. Internal administrative callers handle the result directly; we do not send `curl` to an address without a route and claim success.

## Convert Back to a Public Model for the Screen

Consumers now need prices and options. Keep the existing `CatalogCard`, `CatalogListing`, and `CATALOG_LISTING`, and add the following **type fragment** to `src/catalog/catalog.port.ts`.

```ts
export type CatalogVariant = {
  readonly sku: string;
  readonly label: string;
  readonly currency: 'KRW';
  readonly priceMinor: string;
  readonly discountMinor: string;
};

export type CatalogProduct = CatalogCard & {
  readonly variants: readonly CatalogVariant[];
};

export interface CatalogBrowser extends CatalogListing {
  list(): Promise<readonly CatalogProduct[]>;
  findBySlug(slug: string): Promise<CatalogProduct | null>;
}
```

Chapter 2's `CatalogPromotion` still requires `CatalogListing` because it uses only the narrow listing. Its test double remains valid too. The actual implementation returns richer results, allowing the screen to use the `CatalogBrowser` contract. Connect it to the same `CATALOG_LISTING` token without creating a second client or a separate provider. The following `implements` declaration and module registration establish that the actual implementation injected through the token satisfies the extended contract.

The following **complete file** replaces `src/catalog/catalog.reader.ts`.

```ts
import { Inject } from '@fluojs/core';
import { PrismaService } from '@fluojs/prisma';
import { DtoValidationError } from '@fluojs/validation';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { CatalogBrowser, CatalogProduct } from './catalog.port.js';
import { discountPrice, parseMoney } from './money.js';

const publicProductSelect = {
  id: true,
  slug: true,
  name: true,
  variants: {
    where: { active: true },
    select: { sku: true, label: true, currency: true, priceMinor: true, discountMinor: true },
    orderBy: { sku: 'asc' },
  },
} satisfies Prisma.ProductSelect;

type PublicProductRow = Prisma.ProductGetPayload<{
  select: typeof publicProductSelect;
}>;

function toPublicProduct(row: PublicProductRow): CatalogProduct {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    variants: row.variants.map((variant) => {
      try {
        const price = parseMoney(variant.currency, variant.priceMinor.toString());
        const net = discountPrice(price, variant.discountMinor.toString());
        return {
          sku: variant.sku,
          label: variant.label,
          currency: price.currency,
          priceMinor: price.minor.toString(),
          discountMinor: (price.minor - net.minor).toString(),
        };
      } catch (error) {
        if (error instanceof DtoValidationError) {
          throw new Error('Invalid persisted catalog price', { cause: error });
        }
        throw error;
      }
    }),
  };
}

@Inject(PrismaService)
export class CatalogReader implements CatalogBrowser {
  constructor(private readonly db: PrismaService<PrismaClient>) {}

  async list(): Promise<readonly CatalogProduct[]> {
    const rows = await this.db.current().product.findMany({
      where: { status: 'published', variants: { some: { active: true } } },
      select: publicProductSelect,
      orderBy: { id: 'asc' },
      take: 24,
    });
    return rows.map(toPublicProduct);
  }

  async findBySlug(slug: string): Promise<CatalogProduct | null> {
    const row = await this.db.current().product.findFirst({
      where: { slug, status: 'published', variants: { some: { active: true } } },
      select: publicProductSelect,
    });
    return row === null ? null : toPublicProduct(row);
  }
}
```

The detail query does not use `find()` on the listing's 24 results. Even the 25th active product, absent from the listing, must be found correctly when someone knows its direct address. Apply the same public visibility conditions to listings and details. This avoids a gap where a draft is hidden only from the listing but exposed by a detail query using its slug.

Check the currency read from the database with `parseMoney()` too. This is the boundary where database results enter TypeScript; do not silently assert that values produced by an external import or an incorrect earlier schema are KRW. A `DtoValidationError` here is not an input error in the current request. Convert it to an ordinary error while preserving the cause so that later HTTP validation-error classification does not treat invalid persisted data as a customer's input failure. Investigate values that cannot become valid product cards through the existing server-error observability path.

The final registration in `src/catalog/catalog.module.ts` is the following **complete file**. Importing the name `DefaultValidator` alone does not make it injectable, so register it as a provider. Keep the writer inside this module and export only the public read token.

```ts
import { Module } from '@fluojs/core';
import { DefaultValidator } from '@fluojs/validation';
import { BlogDatabaseModule } from '../database/blog-database.module.js';
import { CATALOG_LISTING } from './catalog.port.js';
import { CatalogReader } from './catalog.reader.js';
import { CatalogWriter } from './catalog.writer.js';

@Module({
  imports: [BlogDatabaseModule],
  providers: [
    DefaultValidator,
    CatalogReader,
    CatalogWriter,
    { provide: CATALOG_LISTING, useExisting: CatalogReader },
  ],
  exports: [CATALOG_LISTING],
})
export class CatalogModule {}
```

## Check Value Failures Separately from Database Failures

The following is the **complete test file** `src/catalog/money.test.ts`. It checks the money and DTO boundaries with the actual validation engine, but does not thereby prove PostgreSQL's constraints.

```ts
import { DefaultValidator, DtoValidationError } from '@fluojs/validation';
import { expect, it } from 'vitest';
import { CreateVariantDto } from './create-variant.dto.js';
import { discountPrice, lineTotal, MAX_MINOR, moneyJson, parseMoney } from './money.js';

it('keeps exact minor units through calculation and JSON', () => {
  const price = parseMoney('KRW', '29000');
  const result = lineTotal(price, 3);
  expect(result.minor).toBe(87000n);
  expect(JSON.parse(JSON.stringify(moneyJson(result)))).toEqual({
    currency: 'KRW',
    amountMinor: '87000',
  });
});

it.each(['29,000', '2.9e4', '1.5', '-1', '029000', '', '9223372036854775808'])(
  'rejects an invalid minor-unit value: %s',
  (value) => {
    expect(() => parseMoney('KRW', value)).toThrow(DtoValidationError);
  },
);

it('does not lose integer precision above the Number safe range', () => {
  expect(parseMoney('KRW', '9007199254740993').minor)
    .toBe(9007199254740993n);
});

it('rejects an unsupported currency', () => {
  expect(() => parseMoney('USD', '29000')).toThrow(DtoValidationError);
});

it('rejects a total that cannot fit in the database', () => {
  const price = parseMoney('KRW', MAX_MINOR.toString());
  expect(() => lineTotal(price, 2)).toThrow(DtoValidationError);
});

it.each([0, -1, 1.5, 100, NaN, Infinity])(
  'rejects an invalid quantity: %s',
  (quantity) => {
    expect(() => lineTotal(parseMoney('KRW', '29000'), quantity))
      .toThrow(DtoValidationError);
  },
);

it('rejects undeclared control fields before persistence', async () => {
  const validator = new DefaultValidator();
  const payload = {
    productId: 'product-tee',
    sku: 'FLUO-TEE-BLK-M',
    label: 'Black / M',
    currency: 'KRW',
    priceMinor: '29000',
    active: false,
  };
  await expect(validator.materialize(payload, CreateVariantDto, {
    undeclaredProperties: 'reject',
  })).rejects.toMatchObject({
    issues: expect.arrayContaining([
      expect.objectContaining({ code: 'UNDECLARED_PROPERTY', field: 'active' }),
    ]),
  });
});

it('defaults an omitted discount to zero and rejects explicit null', async () => {
  const validator = new DefaultValidator();
  const payload = {
    productId: 'product-tee', sku: 'FLUO-TEE-BLK-M', label: 'Black / M',
    currency: 'KRW', priceMinor: '29000',
  };
  const dto = await validator.materialize(payload, CreateVariantDto);
  expect(dto.discountMinor).toBe('0');
  await expect(validator.materialize({ ...payload, discountMinor: null },
    CreateVariantDto)).rejects.toBeInstanceOf(DtoValidationError);
});

it('subtracts the per-unit discount before multiplying', () => {
  const price = parseMoney('KRW', '29000');
  expect(lineTotal(discountPrice(price, '1000'), 2).minor).toBe(56000n);
  expect(() => discountPrice(price, '29001')).toThrow(DtoValidationError);
});

it('rejects null for a required amount', async () => {
  const validator = new DefaultValidator();
  await expect(validator.materialize({
    productId: 'product-tee',
    sku: 'FLUO-TEE-BLK-M',
    label: 'Black / M',
    currency: 'KRW',
    priceMinor: null,
  }, CreateVariantDto)).rejects.toBeInstanceOf(DtoValidationError);
});
```

Run `pnpm exec vitest run src/catalog/money.test.ts` with the existing standard-decorator test configuration. Three shirts at 29,000 won must total exactly 87,000 won. The large-integer test is not meant to resemble a typical selling price; it catches a regression that introduces an intermediate conversion to `Number`. Checking failures just above the boundary alongside precision within the valid range distinguishes an implementation that is correct from one that is merely "right for most prices."

Database experiments require a separate development PostgreSQL database with the migrations applied. Create one draft product, then register two distinct SKUs under its ID. `createVariant()` must return `created` for each, while public reads must still return zero products as long as the product is a draft. Once the product is activated, one product with two options should appear. Deactivating one sales unit should remove only that option; deactivating both must remove the entire product from public results.

For the duplicate experiment, start two `createVariant()` calls for the same SKU together with `Promise.all()`. No special delays or sleeps are needed. Only one should return `created` and the other `duplicate-sku`, and the database must contain exactly one row for that SKU. Do not assume which call finishes first. This check is meaningful only if it actually goes through the database's unique constraint; checking duplicates in an array-backed double does not verify PostgreSQL contention.

Finally, in a separate SQL session that bypasses the API, try storing a negative price and `USD` in separate operations. Each must be rejected with a CHECK violation. If a create operation runs with the connection down, the original database failure must reach the caller rather than a duplicate result. This manuscript does not claim to have executed these database-connection and concurrent-create experiments. Distinguish the unit tests above and the package contracts provided by the references below from the database experiments the reader will perform.

## Publishing a Price Is Not Finalizing It

The public model carries `priceMinor` as a string. The browser can display it, but it does not become authoritative for order pricing. The operator may change a price after a reader sees the screen, and a user can alter the price in a request body. The cart and orders in the next stages must accept SKUs and quantities, reread current prices on the server, and preserve the values at acceptance time as snapshots.

If a price change overlaps public reads, one request may see the old price while another sees the new one. This is a normal possibility because we have not promised the read screen a single, fixed point in time. Wrapping a listing query that does not yet finalize payment or an order in a long transaction cannot freeze the time a user spends thinking. You must state when the terms become final.

This is also why we have not introduced a generic money library or an exchange-rate service. The current contract covers integer KRW amounts and fixed per-unit discounts; it does not yet include percentage discounts, taxes, or exchange-rate rounding. Percentage discounts will require a separate rounding unit, and additional currencies will require explicit minor units for each currency. Mixing `number` and `bigint` or processing all amounts through one string utility before those requirements exist adds ambiguity, not extensibility.

The T-shirt now has actual selectable SKUs and exact prices. In the next chapter, we connect this public model to React screens. We complete the experience of moving from a post to a product and viewing its options, without using buttons to fabricate cart persistence or payment success that the server does not yet provide. Honestly expressing what a screen promises is part of the money model too.

## Implementation References

- [`@fluojs/prisma` README](../../packages/prisma/README.md), [Prisma public exports](../../packages/prisma/src/index.ts), [registration options and handle types](../../packages/prisma/src/types.ts): Contracts for explicit registration and `current()`.
- [Prisma module implementation](../../packages/prisma/src/module.ts), [service boundary tests](../../packages/prisma/src/vertical-slice.test.ts): The scope owned by the database integration and the boundaries of application operations.
- [`@fluojs/validation` README](../../packages/validation/README.md), [public exports](../../packages/validation/src/index.ts): `materialize`, additional-property policy, required nullish values, and limits on scalar conversion.
- [Validation decorator implementation](../../packages/validation/src/decorators.ts), [validation error types](../../packages/validation/src/errors.ts), [validation contract tests](../../packages/validation/src/validation-migration-contract.test.ts): Evidence for `IsDefined`, `Equals`, `UNDECLARED_PROPERTY`, and `DtoValidationError`.
- [Shared money and order contracts](../EDITORIAL.md): KRW, integer amounts, JSON decimal strings, and order-time snapshots.

[Previous: Separating Content, Catalog, and Order Boundaries](./ch02-domain-boundaries.md) - [Volume 2 Contents](./toc.md) - [Next: Building the Journey from Blog to Purchase](./ch04-storefront.md)
