# @fluojs/drizzle

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Drizzle ORM integration for fluo with a transaction-aware database wrapper and an optional dispose hook.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
  - [Use `DrizzleDatabase.current()` inside repositories](#use-drizzledatabasecurrent-inside-repositories)
  - [Manual transaction boundaries](#manual-transaction-boundaries)
  - [Request-scoped transactions with an interceptor](#request-scoped-transactions-with-an-interceptor)
  - [Shutdown and status contracts](#shutdown-and-status-contracts)
- [Manual Module Composition](#manual-module-composition)
- [Public API Overview](#public-api-overview)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @fluojs/drizzle
```

## When to Use

- when Drizzle should participate in the same module, DI, and lifecycle model as the rest of the app
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

### Use `DrizzleDatabase.current()` inside repositories

```ts
import { DrizzleDatabase } from '@fluojs/drizzle';
import { eq } from 'drizzle-orm';
import { users } from './schema';

export class UserRepository {
  constructor(private readonly db: DrizzleDatabase) {}

  async findById(id: string) {
    return this.db.current().select().from(users).where(eq(users.id, id));
  }
}
```

### Manual transaction boundaries

```ts
await this.db.transaction(async () => {
  const tx = this.db.current();
  await tx.insert(users).values(user);
  await tx.insert(profiles).values(profile);
});
```

### Request-scoped transactions with an interceptor

```ts
import { UseInterceptors } from '@fluojs/http';
import { DrizzleTransactionInterceptor } from '@fluojs/drizzle';

@UseInterceptors(DrizzleTransactionInterceptor)
class UsersController {}
```

### Shutdown and status contracts

`DrizzleTransactionInterceptor` runs each HTTP request through `DrizzleDatabase.requestTransaction(...)`. During application shutdown, `DrizzleDatabase` aborts any still-active request transaction, waits for its transaction callback to settle or roll back, and only then runs the optional `dispose(database)` hook. This ordering lets drivers finish rollback/cleanup work before pools or externally managed resources are closed.

`createDrizzlePlatformStatusSnapshot(...)` and `DrizzleDatabase.createPlatformStatusSnapshot()` expose the same contract to diagnostics surfaces:

- `readiness.status` is `not-ready` while Drizzle is shutting down or stopped, and when `strictTransactions` is enabled without `database.transaction(...)` support.
- `health.status` is `degraded` while request transactions are draining during shutdown and `unhealthy` after disposal.
- `details.activeRequestTransactions`, `details.lifecycleState`, `details.strictTransactions`, and `details.supportsTransaction` describe the current request transaction and transaction-capability state.
- `ownership.externallyManaged: true` and `ownership.ownsResources: false` mean the package runs your configured dispose hook but does not claim ownership of the underlying driver resources.

## Manual Module Composition

Use `DrizzleModule.forRoot(...)` / `forRootAsync(...)` to register Drizzle. When you need to compose Drizzle support inside a custom `defineModule(...)` registration, import the module entrypoint there as well.

```ts
import { defineModule } from '@fluojs/runtime';
import { DrizzleDatabase, DrizzleModule, DrizzleTransactionInterceptor } from '@fluojs/drizzle';

const database = {
  transaction: async <T>(callback: (tx: typeof database) => Promise<T>) => callback(database),
};

class ManualDrizzleModule {}

defineModule(ManualDrizzleModule, {
  exports: [DrizzleDatabase, DrizzleTransactionInterceptor],
  imports: [DrizzleModule.forRoot({ database })],
});
```

## Public API Overview

- `DrizzleModule.forRoot(options)` / `DrizzleModule.forRootAsync(options)`
- `DrizzleDatabase`
- `DrizzleTransactionInterceptor`
- `DRIZZLE_DATABASE`, `DRIZZLE_DISPOSE`, `DRIZZLE_OPTIONS`
- `createDrizzlePlatformStatusSnapshot(...)`

### `DrizzleModule`

- `DrizzleModule.forRoot(options)` / `DrizzleModule.forRootAsync(options)`
- `forRootAsync(...)` accepts `AsyncModuleOptions<DrizzleModuleOptions<...>>`.
- Supports `strictTransactions: true` to throw if transaction support is missing.

## Related Packages

- `@fluojs/runtime`: owns module startup and shutdown sequencing
- `@fluojs/http`: provides the interceptor pipeline used for request transactions
- `@fluojs/prisma` and `@fluojs/mongoose`: alternate ORM/ODM integrations with the same fluo runtime model

## Example Sources

- `packages/drizzle/src/vertical-slice.test.ts`
- `packages/drizzle/src/module.test.ts`
- `packages/drizzle/src/public-api.test.ts`
