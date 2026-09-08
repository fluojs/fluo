# Implementing the Same Repository Contract with Prisma and Drizzle

<!-- book:volume=02-fluoshop;chapter=25 -->

[Previous: A Lab for Choosing a Message Transport](./ch24-transport-lab.md) | [Table of Contents](./toc.md) | [Next: Building Document Models for Reviews and Products with MongoDB](./ch26-mongoose-lab.md)

## A second implementation discovered while changing a sale price

FluoBlog's first merchandise sale is over. Preparing for the next sale, the operator wants to change the displayed price of the logo T-shirt and see who changed prices and when. Unit prices and discounts stored in orders are snapshots taken at the time of ordering, so they must not change. The value to change is the current product price owned by `CatalogModule`. There is no reason to replace the existing `AccountsModule`, `PostsModule`, order state machine, or PostgreSQL database.

A developer familiar with SQL joins the team and suggests evaluating Drizzle. The comparison here is not about how many lines the syntax takes. If two operators viewing the same product save different prices, does a stale edit overwrite a newer one? If writing the price change history fails, is the new price rolled back too? Does application shutdown leave an active transaction on a closed connection? We need to compare implementations that give the same answers to these questions.

This chapter is a separate comparison lab. PostgreSQL and Prisma remain the production defaults in the main application. The `src/catalog/price-lab/` files below belong in a lab directory in the reader's `fluo-blog` application; they do not imply that a complete shop checkpoint already exists in this repository. Rather than replacing the existing price repository directly, we implement the same contract twice in an isolated lab database. We do not put both ORMs into the production path or dual-write prices.

The actual sale SKU is the `ProductVariant` created in Chapter 3. `lab_price` is an experimental table that isolates conditional price changes and atomic audit records, not a new sales ledger. When extending this into a production adapter, continue reading the existing `ProductVariant.priceMinor`, `active`, and the parent `Product`'s publication status, and preserve the existing `PriceRow` conversion. Do not finalize cart prices or decide whether an item can be sold from this experiment's `find()` result alone. No migration that repopulates a separate SKU ledger is required either.

The execution baseline is Node24 and pnpm10. The Prisma side uses the client and configuration generated in earlier chapters. After adding the new models, follow that project's Prisma generation and migration procedure. The Drizzle side requires `@fluojs/drizzle`, `drizzle-orm` 0.45.2 or later, `pg`, and `@types/pg` as a development dependency. Do not equate Drizzle's own support for multiple runtimes with Fluo's support for a Node-only transaction wrapper.

## Make one change the contract, not a generic repository

The initial implementation read the price with `findUnique()` and saved the new value with `update()`. It works when requests run in sequence, but if two requests both read version 3, both can save. Wrapping them in a transaction does not change an unconditional last-write-wins policy. What we need is compare-and-swap, including the version read in the write condition.

In this lab, only an internal service that has already verified permission to edit calls the repository. Do not pass customer-supplied prices or customer IDs into this path. The contract has only two operations: `find()` and `change()`. Both a missing SKU and a stale version produce `conflict`. If the screen needs to distinguish them, a separate read can explain the difference, but first establish whether the atomic change succeeded. Infrastructure errors, such as SQL errors or duplicate history records, remain exceptions rather than being disguised as conflicts.

The following is the complete file `src/catalog/price-lab/price-store.ts`. Money uses `number` because this lab's PostgreSQL `integer` range is narrower than JavaScript's safe integer range. This does not impose that range on payment totals. Domains that exceed it need a separate `bigint` design and conversion to decimal strings for JSON.

```ts
export const PRICE_STORE = Symbol('shop.price-store');

export type Price = {
  sku: string;
  currency: 'KRW';
  priceMinor: number;
  version: number;
};

export type ChangePrice = {
  changeId: string;
  sku: string;
  expectedVersion: number;
  currency: 'KRW';
  priceMinor: number;
};

export type ChangeResult =
  | { kind: 'changed'; value: Price }
  | { kind: 'conflict' };

export interface PriceStore {
  find(sku: string): Promise<Price | null>;
  change(input: ChangePrice): Promise<ChangeResult>;
}

export function assertChange(input: ChangePrice): void {
  if (
    input.sku.trim().length === 0 ||
    input.changeId.trim().length === 0 ||
    input.currency !== 'KRW' ||
    !Number.isInteger(input.priceMinor) ||
    input.priceMinor < 0 ||
    input.priceMinor > 2_147_483_647 ||
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion < 0 ||
    input.expectedVersion >= 2_147_483_647
  ) {
    throw new RangeError('Invalid price change.');
  }
}
```

`changeId` is a unique identifier for an audit record, not an automatic idempotency API. Reusing the same ID violates the history's unique constraint and fails the entire operation. Returning the previous successful response on a retry requires a separate idempotency contract that stores the request contents and result. Mixing the two concepts makes it impossible to explain whether pressing the button again should reproduce a success or reject a stale edit.

## Expressing the same tables in two languages

The SQL table names in this lab are fixed as `lab_price` and `lab_price_change`. The following is the complete DDL for preparing a separate lab database. It is not a deployment command to run against production. The definitions are explicit so that both adapters receive the same data types, unique keys, and check constraints. In a real project, only one migration tool should own the change history of these tables.

```sql
CREATE TABLE lab_price (
  sku text PRIMARY KEY,
  currency text NOT NULL CHECK (currency = 'KRW'),
  price_minor integer NOT NULL CHECK (price_minor >= 0),
  version integer NOT NULL CHECK (version >= 0)
);

CREATE TABLE lab_price_change (
  id text PRIMARY KEY,
  sku text NOT NULL REFERENCES lab_price(sku),
  currency text NOT NULL CHECK (currency = 'KRW'),
  price_minor integer NOT NULL CHECK (price_minor >= 0),
  version integer NOT NULL CHECK (version > 0),
  UNIQUE (sku, version)
);
```

The following is a **partial model implementation** to add to the existing `prisma/schema.prisma`. Keep the project's existing generator and datasource settings. Add check constraints equivalent to the DDL above to the migration SQL. Do not assume that declaring Prisma models automatically generates every SQL check constraint.

```prisma
model LabPrice {
  sku        String           @id
  currency   String
  priceMinor Int              @map("price_minor")
  version    Int
  changes    LabPriceChange[]

  @@map("lab_price")
}

model LabPriceChange {
  id         String   @id
  sku        String
  currency   String
  priceMinor Int      @map("price_minor")
  version    Int
  price      LabPrice @relation(fields: [sku], references: [sku])

  @@unique([sku, version])
  @@map("lab_price_change")
}
```

The complete Drizzle file `src/catalog/price-lab/drizzle-schema.ts` maps to the same tables. Do not deploy this declaration and the SQL independently. This experiment uses two clients to read tables prepared by the DDL above. If you adopt Drizzle, also decide which migration source is authoritative and how to take over the existing migration history.

```ts
import { sql } from 'drizzle-orm';
import { check, integer, pgTable, text, unique } from 'drizzle-orm/pg-core';

export const prices = pgTable('lab_price', {
  sku: text('sku').primaryKey(),
  currency: text('currency').notNull(),
  priceMinor: integer('price_minor').notNull(),
  version: integer('version').notNull(),
}, (table) => [
  check('lab_price_currency', sql`${table.currency} = 'KRW'`),
  check('lab_price_amount', sql`${table.priceMinor} >= 0`),
  check('lab_price_version', sql`${table.version} >= 0`),
]);

export const changes = pgTable('lab_price_change', {
  id: text('id').primaryKey(),
  sku: text('sku').notNull().references(() => prices.sku),
  currency: text('currency').notNull(),
  priceMinor: integer('price_minor').notNull(),
  version: integer('version').notNull(),
}, (table) => [
  unique('lab_price_change_version').on(table.sku, table.version),
  check('lab_change_currency', sql`${table.currency} = 'KRW'`),
  check('lab_change_amount', sql`${table.priceMinor} >= 0`),
  check('lab_change_version', sql`${table.version} > 0`),
]);
```

Product descriptions, stock quantities, and order snapshots are absent from these tables by design, not because features were forgotten. The invariant to prove here is consistency between the current price and its change history. A large repository interface encompassing every product operation would turn an adapter comparison into changes to search, inventory, and order design. It is easier to make a decision after passing a narrow lab and then calculating replacement costs separately for each real domain boundary.

## Prisma: bind the conditional write and history to the same client

The following is the complete file `src/catalog/price-lab/prisma-price-store.ts`. The generated Prisma Client must contain the two models above. Inside a transaction, `current()` returns the transaction client, so the conditional update and audit record insertion share the same boundary. Importing a separate root `PrismaClient` to run queries bypasses this guarantee.

```ts
import { Inject } from '@fluojs/core';
import { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import {
  assertChange,
  type ChangePrice,
  type ChangeResult,
  type Price,
  type PriceStore,
} from './price-store.js';

@Inject(PrismaService)
export class PrismaPriceStore implements PriceStore {
  constructor(private readonly prisma: PrismaService<PrismaClient>) {}

  async find(sku: string): Promise<Price | null> {
    const row = await this.prisma.current().labPrice.findUnique({ where: { sku } });
    if (!row) return null;
    if (row.currency !== 'KRW') throw new Error('Unsupported stored currency.');
    return { ...row, currency: row.currency };
  }

  async change(input: ChangePrice): Promise<ChangeResult> {
    assertChange(input);
    return this.prisma.transaction(async () => {
      const tx = this.prisma.current();
      const updated = await tx.labPrice.updateMany({
        where: {
          sku: input.sku,
          version: input.expectedVersion,
          currency: input.currency,
        },
        data: { priceMinor: input.priceMinor, version: { increment: 1 } },
      });
      if (updated.count !== 1) return { kind: 'conflict' };
      const value: Price = {
        sku: input.sku,
        currency: input.currency,
        priceMinor: input.priceMinor,
        version: input.expectedVersion + 1,
      };
      await tx.labPriceChange.create({
        data: { id: input.changeId, ...value },
      });
      return { kind: 'changed', value };
    });
  }
}
```

We construct the return object without rereading the price because this table's change rules are fully defined. If a database trigger calculates a different price, or the response needs a server default, return the actual stored values through `returning` or a reread inside the transaction. For now, the lab contract says that no writer changes the version in any way other than `expectedVersion + 1`.

We chose `transaction()` to make the boundary explicit for this comparison. Fluo's service-level `@Transaction()` is also available, but each ORM has its own target resolution rules, so this experiment does not mix the two wrappers by merely changing method names. In particular, the fallback to direct execution with the default `strictTransactions: false` is not atomicity. Be sure to set it to `true` in the registration below.

## Drizzle: the returned row is evidence of the write

The complete file `src/catalog/price-lab/drizzle-price-store.ts` implements the same contract. This example uses the Node PostgreSQL driver's `NodePgDatabase` and `returning()`. Before copying it to another SQL driver, revalidate the returned rows and transaction types. An ORM wrapping SQL syntax does not eliminate driver differences.

```ts
import { Inject } from '@fluojs/core';
import { DrizzleDatabase } from '@fluojs/drizzle';
import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { changes, prices } from './drizzle-schema.js';
import {
  assertChange,
  type ChangePrice,
  type ChangeResult,
  type Price,
  type PriceStore,
} from './price-store.js';

@Inject(DrizzleDatabase)
export class DrizzlePriceStore implements PriceStore {
  constructor(private readonly db: DrizzleDatabase<NodePgDatabase>) {}

  async find(sku: string): Promise<Price | null> {
    const [row] = await this.db.current().select().from(prices)
      .where(eq(prices.sku, sku));
    if (!row) return null;
    if (row.currency !== 'KRW') throw new Error('Unsupported stored currency.');
    return { ...row, currency: row.currency };
  }

  async change(input: ChangePrice): Promise<ChangeResult> {
    assertChange(input);
    return this.db.transaction(async () => {
      const tx = this.db.current();
      const [row] = await tx.update(prices).set({
        priceMinor: input.priceMinor,
        version: sql`${prices.version} + 1`,
      }).where(and(
        eq(prices.sku, input.sku),
        eq(prices.version, input.expectedVersion),
        eq(prices.currency, input.currency),
      )).returning();
      if (!row) return { kind: 'conflict' };
      if (row.currency !== 'KRW') throw new Error('Unsupported stored currency.');
      const value: Price = { ...row, currency: row.currency };
      await tx.insert(changes).values({ id: input.changeId, ...value });
      return { kind: 'changed', value };
    });
  }
}
```

The crucial detail is the version condition in `where`. Even when two requests send the same version, only one update returns a row. At PostgreSQL's default `READ COMMITTED` isolation level, a competing update reevaluates its condition after the preceding write finishes, so the stale version no longer matches. Choosing another isolation level can introduce different errors, such as serialization failures; in that case, change the contract tests and retry policy together.

Neither implementation catches a history insertion failure and returns success. The exception must propagate to the outer transaction for the price update to roll back as well. We also do not write the price and history concurrently with `Promise.all()`. The audit record depends on a successful price update, and parallelizing on the same connection in one transaction offers no benefit.

## The replacement point is module registration, not a type

The `PriceStore` interface disappears at runtime. The complete file `src/catalog/price-lab/price-editor.ts` below passes an actual token to class-level `@Inject`. This small application service accepts commands that have passed the existing operator authorization boundary and returns their results. It has no ORM imports.

```ts
import { Inject } from '@fluojs/core';
import { PRICE_STORE, type ChangePrice, type PriceStore } from './price-store.js';

@Inject(PRICE_STORE)
export class PriceEditor {
  constructor(private readonly store: PriceStore) {}

  change(input: ChangePrice) {
    return this.store.change(input);
  }
}
```

Choose **only one** of the following two files at the lab entry point. These examples do not replace the entire existing `src/app.ts`. When `CatalogModule` imports the selected module, it can use that module's exported `PriceEditor`. The Prisma lab imports the same `BlogDatabaseModule` from Volume 1's `src/database/blog-database.module.ts`. That module's `PrismaModule.forRootAsync` receives `AppSettings` through injection, creates a client per container, and shares it with `global: true`. For the lab run, verify that the configuration points to an isolated database and that the existing registration has `strictTransactions` set to `true`. Do not wrap the same client again with a separate `forRoot`.

`src/catalog/price-lab/prisma-lab.module.ts`:

```ts
import { Module } from '@fluojs/core';
import { BlogDatabaseModule } from '../../database/blog-database.module.js';
import { PriceEditor } from './price-editor.js';
import { PRICE_STORE } from './price-store.js';
import { PrismaPriceStore } from './prisma-price-store.js';

@Module({
  imports: [BlogDatabaseModule],
  providers: [
    PrismaPriceStore,
    { provide: PRICE_STORE, useExisting: PrismaPriceStore },
    PriceEditor,
  ],
  exports: [PRICE_STORE, PriceEditor],
})
export class PrismaPriceLabModule {}
```

`src/catalog/price-lab/drizzle-lab.module.ts` is a complete module factory run in a separate process with separate configuration from the Prisma lab. It does not add a second database wrapper to the production app.

```ts
import { Module } from '@fluojs/core';
import { DrizzleModule } from '@fluojs/drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { DrizzlePriceStore } from './drizzle-price-store.js';
import { PriceEditor } from './price-editor.js';
import { PRICE_STORE } from './price-store.js';

export function createDrizzlePriceLab(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl });
  @Module({
    imports: [DrizzleModule.forRoot({
      database: drizzle(pool),
      strictTransactions: true,
      dispose: async () => { await pool.end(); },
    })],
    providers: [
      DrizzlePriceStore,
      { provide: PRICE_STORE, useExisting: DrizzlePriceStore },
      PriceEditor,
    ],
    exports: [PRICE_STORE, PriceEditor],
  })
  class PriceLabModule {}
  return PriceLabModule;
}
```

The Prisma integration manages the registered client's connection and disconnection hooks within the Fluo lifecycle. Passing the same raw client to a different Prisma wrapper does not merge their transaction contexts, so registration must retain a single owner. The Drizzle integration does not take ownership of driver resources created by the application. That is why we pass `dispose`. Both implementations wait for active boundaries to finish disposal and reject new transactions once shutdown begins, but this must not be generalized into a guarantee that all raw queries are cancelled.

## Injecting the same failures into both implementations

The complete file `src/catalog/price-lab/price-store.contract.ts` below is an experiment shared by both adapters. `Pool` is a separate observation connection and must point only to the prepared lab database. The function empties the tables, so do not pass a production connection. Pass the repository instance resolved from the preceding module. The test runner must configure each module once, invoke this function, and shut each one down. Do not run both executions concurrently against the same tables.

```ts
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import type { PriceStore } from './price-store.js';

export async function verifyPriceStore(store: PriceStore, observer: Pool) {
  await observer.query('DELETE FROM lab_price_change');
  await observer.query('DELETE FROM lab_price');
  await observer.query(
    'INSERT INTO lab_price VALUES ($1, $2, $3, $4)',
    ['shirt-logo-m', 'KRW', 25_000, 0],
  );

  const input = {
    sku: 'shirt-logo-m',
    currency: 'KRW' as const,
    expectedVersion: 0,
    priceMinor: 23_000,
  };
  const results = await Promise.all([
    store.change({ ...input, changeId: 'change-a' }),
    store.change({ ...input, priceMinor: 22_000, changeId: 'change-b' }),
  ]);
  assert.equal(results.filter((result) => result.kind === 'changed').length, 1);
  assert.equal(results.filter((result) => result.kind === 'conflict').length, 1);

  const before = await store.find(input.sku);
  assert.ok(before);
  assert.equal(before.version, 1);
  const audit = await observer.query<{ id: string }>(
    'SELECT id FROM lab_price_change WHERE sku = $1', [input.sku],
  );
  assert.equal(audit.rows.length, 1);
  const first = audit.rows[0];
  assert.ok(first);

  await assert.rejects(store.change({
    ...input,
    expectedVersion: 1,
    priceMinor: 20_000,
    changeId: first.id,
  }));
  assert.deepEqual(await store.find(input.sku), before);
  const count = await observer.query<{ count: string }>(
    'SELECT count(*) FROM lab_price_change WHERE sku = $1', [input.sku],
  );
  assert.equal(count.rows[0]?.count, '1');

  await assert.rejects(store.change({
    ...input, changeId: 'invalid', priceMinor: 1.5,
  }), RangeError);
  assert.equal(await store.find('missing-sku'), null);
}
```

This experiment examines the number of stored history records and the restoration of the price, rather than treating two successful responses as evidence. Deliberately reusing an existing audit ID for the second change makes the insertion fail after the price update. An implementation without a transaction leaves the price at 20,000 and fails at `deepEqual`. One without the version condition produces two successes in the first part and fails there. Only when you can explain which mistake a test catches can it serve as evidence of adapter equivalence.

`Promise.all()` starts both calls concurrently, but does not prove that a database lock wait actually occurred. This test's invariant holds regardless of execution order. Measuring real contention wait time requires a separate experiment: hold the first update's lock on one of two database connections, observe the second request waiting on the server, and then release the first transaction. Do not claim that a fixed delay establishes contention.

The shutdown experiment distinguishes package transaction and lifecycle tests from real database verification. After receiving a callback-entry signal, start shutdown, verify that a new change request is rejected, and then release the callback. Finally, observe whether Prisma disconnect or Drizzle dispose occurred after callback cleanup. A simple in-memory fake can prove this call order, but cannot prove actual PostgreSQL rollback. The database experiments above were not run while writing this manuscript, and no passing result is assumed.

## The outcome of a comparison lab is a replacement decision record

The Prisma implementation suits a team familiar with generated model delegates and affected-row counts. The Drizzle implementation exposes conditions and returned columns in a form close to SQL, making complex queries easier to review. This chapter cannot decide which is faster. Unless data, connection pools, isolation levels, indexes, and query plans are aligned, a speed comparison can easily measure differences unrelated to the ORM.

Replacement costs include not only queries but migrations, generated code, money conversions, authorization boundaries, failure analysis, and connection shutdown. There is no need to maintain repositories for every ORM in advance when the actual product has only one choice. Introduce a small port when evaluating a concrete alternative, as here, or when tests need a data access boundary. Abstracting all orders into generic CRUD instead obscures where state transitions and atomicity belong.

The shop still has the same users and the same orders. After the experiment, exclude the unselected adapter from production registration and retain the agreed contract tests and the reasons for the decision. In the next chapter, instead of moving the entire SQL repository, we express only product descriptions and reader reviews as document models. The principle remains the same: when storage changes, first establish which data is the authoritative source.

## Evidence and further source reading

- [Prisma registration, transaction, and shutdown contracts](../../packages/prisma/README.md), [public exports](../../packages/prisma/src/index.ts), [module and token wiring](../../packages/prisma/src/module.ts), [transaction service](../../packages/prisma/src/service.ts)
- [Drizzle registration and driver ownership contracts](../../packages/drizzle/README.md), [public exports](../../packages/drizzle/src/index.ts), [public types](../../packages/drizzle/src/types.ts), [transaction wrapper](../../packages/drizzle/src/database.ts)
- [Prisma service boundary experiments](../../packages/prisma/src/vertical-slice.test.ts), [Drizzle service boundary experiments](../../packages/drizzle/src/vertical-slice.test.ts), [Drizzle concurrent boundary regression tests](../../packages/drizzle/src/concurrent-boundaries.test.ts)

[Previous](./ch24-transport-lab.md) | [Table of Contents](./toc.md) | [Next](./ch26-mongoose-lab.md)
