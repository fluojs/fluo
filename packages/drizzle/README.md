# @konekti/drizzle

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Drizzle ORM integration for Konekti with a transaction-aware database wrapper and an optional dispose hook.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
- [Public API Overview](#public-api-overview)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @konekti/drizzle
```

## When to Use

- when Drizzle should participate in the same module, DI, and lifecycle model as the rest of the app
- when repositories need a single `current()` seam that switches between the root handle and the active transaction handle
- when application shutdown should also run an explicit cleanup hook for the underlying driver resources

## Quick Start

```ts
import { ConfigService } from '@konekti/config';
import { Module } from '@konekti/core';
import { DrizzleModule } from '@konekti/drizzle';
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
import { DrizzleDatabase } from '@konekti/drizzle';
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
import { UseInterceptors } from '@konekti/http';
import { DrizzleTransactionInterceptor } from '@konekti/drizzle';

@UseInterceptors(DrizzleTransactionInterceptor)
class UsersController {}
```

## Public API Overview

- `DrizzleModule.forRoot(options)` / `DrizzleModule.forRootAsync(options)`
- `createDrizzleProviders(options)`
- `DrizzleDatabase`
- `DrizzleTransactionInterceptor`
- `DRIZZLE_DATABASE`, `DRIZZLE_DISPOSE`, `DRIZZLE_OPTIONS`
- `createDrizzlePlatformStatusSnapshot(...)`

## Related Packages

- `@konekti/runtime`: owns module startup and shutdown sequencing
- `@konekti/http`: provides the interceptor pipeline used for request transactions
- `@konekti/prisma` and `@konekti/mongoose`: alternate ORM/ODM integrations with the same Konekti runtime model

## Example Sources

- `packages/drizzle/src/vertical-slice.test.ts`
- `packages/drizzle/src/module.test.ts`
- `packages/drizzle/src/public-api.test.ts`
