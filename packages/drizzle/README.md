# @fluojs/drizzle

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Node.js-only Drizzle ORM integration for fluo with a transaction-aware database wrapper and an optional dispose hook.

## Table of Contents

- [Installation](#installation)
- [Runtime Support](#runtime-support)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
  - [Service Transaction Boundary (@Transaction)](#service-transaction-boundary-transaction)
  - [Manual Transactions and current()](#manual-transactions-and-current)
  - [Request-Wide Controller Boundaries](#request-wide-controller-boundaries)
  - [Shutdown and Status Contracts](#shutdown-and-status-contracts)
- [Manual Module Composition](#manual-module-composition)
- [Public API Overview](#public-api-overview)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @fluojs/drizzle drizzle-orm
# Install the driver for your Drizzle adapter as well, for example:
npm install pg
```

## Runtime Support

The root `@fluojs/drizzle` package is currently a Node.js 20+ integration. It imports Node's `node:async_hooks` module to maintain the ambient transaction context and the package manifest declares `engines.node >=20.0.0`.

Drizzle ORM itself can target drivers such as Bun SQL or Cloudflare D1, but those driver runtimes are outside this fluo wrapper until a non-Node transaction-context adapter is documented.

Non-Node runtimes should not import the root package. For Bun, Deno, Cloudflare Workers, or other non-Node Drizzle drivers, register the raw Drizzle driver handle behind application-owned fluo providers such as `{ provide, useFactory }` or `{ provide, useValue }`, then inject that application token into repositories. The canonical package chooser/surface docs and the Bun/Cloudflare book chapters show those raw-provider patterns.

## When to Use

- when a Node.js 20+ application needs Drizzle to participate in the same module, DI, and lifecycle model as the rest of the app
- when repositories need a single `current()` seam that switches between the root handle and the active transaction handle
- when application shutdown should also run an explicit cleanup hook for the underlying driver resources

## Quick Start

```ts
import { ConfigService } from '@fluojs/config';
import { Module } from '@fluojs/core';
import { DrizzleModule } from '@fluojs/drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

@Module({
  imports: [
    DrizzleModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        const pool = new Pool({
          connectionString: config.getOrThrow<string>('DATABASE_URL'),
        });

        return {
          database: drizzle(pool),
          dispose: async () => {
            await pool.end();
          },
        };
      },
    }),
  ],
})
export class AppModule {}
```

## Common Patterns

### Service Transaction Boundary (@Transaction)

The `@Transaction()` decorator is the recommended way to define transaction boundaries in your service layer. It ensures that all repository calls made within the decorated method share the same Drizzle transaction.

```ts
import { Transaction, DrizzleDatabase, type DrizzleDatabaseFacade } from '@fluojs/drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';
import { users, profiles } from './schema';

type AppDatabase = ReturnType<typeof drizzle>;

export class UserService {
  constructor(private readonly repo: UserRepository) {}

  @Transaction()
  async onboardUser(dto: any) {
    const user = await this.repo.create(dto);
    await this.repo.initProfile(user.id);
    return user;
  }
}

export class UserRepository {
  constructor(private readonly db: DrizzleDatabaseFacade<AppDatabase>) {}

  async create(data: any) {
    // The facade type exposes standard Drizzle methods.
    // When called inside @Transaction(), they automatically participate in the ambient transaction.
    return this.db.insert(users).values(data);
  }

  async initProfile(userId: string) {
    return this.db.insert(profiles).values({ userId });
  }
}
```

Calls to `@Transaction()` methods are reentrant. If a decorated method calls another decorated method, they share the same underlying Drizzle transaction.

By default, `@Transaction()` selects its target with a small host-object heuristic: it first checks `this.db`, then direct properties on the decorated instance, then a nested `.db` property on those values, and uses the first value that exposes a `transaction(...)` method. If none of those candidates match, the decorated instance itself becomes the transaction target. This keeps common `constructor(private readonly db: DrizzleDatabase<...>)` services and self-contained facade hosts concise, but services with more than one Drizzle wrapper should not rely on property order. Pass an explicit accessor such as `@Transaction((self) => self.ordersDb)` or `@Transaction((self) => self.analyticsDb, options)` whenever the decorated host owns multiple transaction-capable clients or wraps a repository that also exposes `.db`.

### Manual Transactions and current()

The `DrizzleDatabase` provides a `current()` method that returns the active transaction handle if inside a transaction scope, or the root handle otherwise. Use this as an escape hatch when you need to pass the handle to external utilities or perform advanced manual transaction plumbing.

```ts
import { DrizzleDatabase } from '@fluojs/drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';
import { users } from './schema';

type AppDatabase = ReturnType<typeof drizzle>;

export class AdvancedRepository {
  constructor(private readonly db: DrizzleDatabase<AppDatabase>) {}

  async customOperation() {
    const tx = this.db.current();
    // Use tx for operations that fluo doesn't automatically wrap,
    // or when passing to an external utility that expects a Drizzle database handle.
    return tx.select().from(users);
  }
}
```

Use `db.transaction()` for manual transaction blocks:

```ts
await this.db.transaction(async () => {
  const current = this.db.current();

  await current.insert(users).values(user);
  await current.insert(profiles).values(profile);
});
```

Nested calls reuse the active transaction boundary. If a nested call passes transaction options while a boundary is already active, the package rejects those nested options instead of silently changing the existing transaction.

When `database.transaction(...)` is unavailable and `strictTransactions` is `false` (the default), `transaction()` and `requestTransaction()` intentionally fail open (fail-open fallback) by running the callback directly against the root handle. This is useful for local fakes, read-only adapters, or gradual migrations, but it is not atomic and should not be treated as a real database transaction. Set `strictTransactions: true` in production paths that require rollback guarantees; startup and readiness diagnostics then surface missing `database.transaction(...)` support and transaction helpers throw instead of silently running without a transaction. Request-scoped fallback still honors `AbortSignal`, so a cancelled request can stop before or during direct execution even though no Drizzle transaction runner exists.

### Request-Wide Controller Boundaries

Prefer service-level `@Transaction()` for business operations. If you are migrating a NestJS controller/interceptor pattern where an entire request must be transactional, call `requestTransaction(...)` explicitly at the controller, route adapter, or request orchestration boundary and pass the request `AbortSignal` when one is available:

```ts
import { Controller, Post } from '@fluojs/http';
import { DrizzleDatabase } from '@fluojs/drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';

type AppDatabase = ReturnType<typeof drizzle>;

@Controller('/checkout')
export class CheckoutController {
  constructor(
    private readonly db: DrizzleDatabase<AppDatabase>,
    private readonly checkout: CheckoutService,
  ) {}

  @Post()
  create(input: CheckoutInput, requestSignal?: AbortSignal) {
    return this.db.requestTransaction(
      () => this.checkout.createOrder(input),
      requestSignal,
    );
  }
}
```

There is no Drizzle `*TransactionInterceptor` export to import. Existing NestJS interceptor designs should move most transaction boundaries to services and reserve explicit `requestTransaction(...)` for rare controller-level compatibility cases where all request work, not just a service method, must share the same boundary. Decorating a controller method with `@Transaction()` remains a compatibility path when the controller owns an explicit `DrizzleDatabase` target, but `requestTransaction(...)` is the clearer request-wide API because it can receive the request `AbortSignal` directly.

### Shutdown and status contracts

During application shutdown, `DrizzleDatabase` aborts any still-active request transaction, waits for open request and manual transaction callbacks to settle or roll back, and only then runs the optional `dispose(database)` hook. This includes fail-open manual `transaction(...)` callbacks when `database.transaction(...)` is unavailable and `strictTransactions` is `false`, so direct-execution fallbacks still drain before pools or externally managed resources are closed.
Nested `requestTransaction(...)` calls opened inside an existing request boundary observe the ambient request abort signal while still reusing the active Drizzle transaction. Nested `requestTransaction(...)` calls opened inside an existing manual transaction boundary also join shutdown settlement tracking without opening a second Drizzle transaction, and their settlement handle remains tracked until the outer manual transaction settles so shutdown drains that outer boundary before `dispose(database)` runs. The platform status activity count is intentionally shorter lived: once the nested request callback settles, `details.activeRequestTransactions` is decremented even if the outer manual transaction continues running.
New `transaction(...)` and `requestTransaction(...)` calls are rejected once shutdown begins, so disposal cannot overtake a late transaction that starts after the shutdown boundary is crossed.
If the request signal aborts after the request callback has completed but before the underlying Drizzle transaction runner finishes committing or rolling back, `requestTransaction(...)` waits for that runner to settle first and then rejects with the abort reason. This keeps Drizzle cleanup serialized with request cancellation while making the late request abort visible to the caller instead of returning the completed callback result.

`createDrizzlePlatformStatusSnapshot(...)` and `DrizzleDatabase.createPlatformStatusSnapshot()` expose the same contract to diagnostics surfaces:

- `readiness.status` is `not-ready` while Drizzle is shutting down or stopped, and when `strictTransactions` is enabled without `database.transaction(...)` support.
- `health.status` is `degraded` while request transactions are draining during shutdown and `unhealthy` after disposal.
- `details.activeRequestTransactions`, `details.lifecycleState`, `details.strictTransactions`, and `details.supportsTransaction` describe the current request transaction and transaction-capability state.
- `details.transactionContext: 'als'` identifies the async-local transaction context used by request and service transaction boundaries.
- `ownership.externallyManaged: true` and `ownership.ownsResources: false` mean the package runs your configured dispose hook but does not claim ownership of the underlying driver resources.

## Manual Module Composition

Use `DrizzleModule.forRoot(...)` / `forRootAsync(...)` to register Drizzle. When you need to compose Drizzle support inside a custom `defineModule(...)` registration, import the module entrypoint there as well.

```ts
import { defineModule } from '@fluojs/runtime';
import { DrizzleModule } from '@fluojs/drizzle';

const database = {
  transaction: async <T>(callback: (tx: typeof database) => Promise<T>) => callback(database),
};

class ManualDrizzleModule {}

defineModule(ManualDrizzleModule, {
  imports: [DrizzleModule.forRoot({ database })],
});
```

## Public API Overview

- `DrizzleModule.forRoot(options)` / `DrizzleModule.forRootAsync(options)`
- `DrizzleDatabase`
- `DrizzleDatabaseFacade<TDatabase>`
- `Transaction`
- `DRIZZLE_DATABASE`, `DRIZZLE_DISPOSE`, `DRIZZLE_HANDLE_PROVIDER`, `DRIZZLE_OPTIONS`
- `DrizzleDatabase.createFacade(...)` (compatibility-only provider wiring helper; prefer `DrizzleModule.forRoot(...)` / `forRootAsync(...)` for application registration)
- `createDrizzlePlatformStatusSnapshot(...)`
- `DrizzleDatabaseLike`
- `DrizzleModuleOptions`
- `DrizzleHandleProvider`

`DRIZZLE_HANDLE_PROVIDER` is an alias token for the lifecycle-aware `DrizzleDatabase` wrapper. Health integrations such as `@fluojs/terminus` use this token to read `createPlatformStatusSnapshot()` before falling back to raw database pings.

Use `DrizzleDatabase<TDatabase>` when a provider only needs wrapper methods such as `current()`, `transaction(...)`, `requestTransaction(...)`, or `createPlatformStatusSnapshot()`. Use `DrizzleDatabaseFacade<TDatabase>` for repository injections that call Drizzle query methods directly; the facade forwards those calls to the active transaction handle when one exists and to the root handle otherwise. `DrizzleDatabase.createFacade(...)` is retained as a low-level compatibility helper for module-provider wiring; application code should prefer `DrizzleModule.forRoot(...)` / `forRootAsync(...)`.

`Transaction` is a standard TC39 method decorator for service-layer transaction boundaries. It resolves a transaction-capable target from the decorated host by checking `this.db`, then direct properties, then nested `.db` properties, then falling back to the decorated instance itself; it also accepts an accessor for explicit client selection and can forward Drizzle transaction options to the outer boundary.

### `DrizzleModule`

- `DrizzleModule.forRoot(options)` / `DrizzleModule.forRootAsync(options)`
- `forRootAsync(...)` accepts DI-aware Drizzle options whose factory returns the database/dispose/transaction settings; pass `global` on the top-level async registration when the providers should be visible globally.
- `forRootAsync(...)` resolves options once per application container. Reusing the same module definition across tests or multi-app processes creates isolated database/dispose results for each container instead of sharing a memoized factory result.
- Supports `strictTransactions: true` to throw if transaction support is missing.
- `database` must be a concrete object/function handle for both sync and async registration; missing handles are rejected during module registration or async bootstrap.

## Related Packages

- `@fluojs/runtime`: owns module startup and shutdown sequencing
- `@fluojs/http`: provides request lifecycle primitives that can be paired with explicit `requestTransaction(...)` boundaries
- `@fluojs/prisma` and `@fluojs/mongoose`: alternate ORM/ODM integrations with the same fluo runtime model

## Example Sources

- `packages/drizzle/src/vertical-slice.test.ts`
- `packages/drizzle/src/module.test.ts`
- `packages/drizzle/src/public-api.test.ts`
