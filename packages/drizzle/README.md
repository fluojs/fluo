# @konekti/drizzle

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>


Official Drizzle integration baseline for Konekti — wraps a Drizzle database handle with a transaction-aware `current()` seam and an optional dispose hook.

## See also

- `../../docs/concepts/transactions.md`
- `../../docs/concepts/lifecycle-and-shutdown.md`

## What this package does

`@konekti/drizzle` connects a Drizzle database handle to Konekti's module, DI, and lifecycle model. Unlike Prisma, Drizzle doesn't expose `$connect`/`$disconnect` lifecycle methods — so this integration is shaped around **handle wrapping + optional cleanup** rather than connection lifecycle management.

Key responsibilities:
- Provide the `DrizzleDatabase` wrapper with `current()` / `transaction()` / `requestTransaction()`
- Register `DRIZZLE_DATABASE`, `DRIZZLE_DISPOSE`, and `DRIZZLE_OPTIONS` tokens in the DI container
- Wire the optional `dispose` hook into `onApplicationShutdown`
- Expose `DrizzleTransactionInterceptor` for opt-in automatic request-scoped transactions

## Installation

```bash
npm install @konekti/drizzle
```

## Quick Start

```typescript
import { Module } from '@konekti/core';
import { createDrizzleModule } from '@konekti/drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

@Module({
  imports: [
    createDrizzleModule({
      database: db,
      dispose: async (database) => {
        await pool.end();
      },
    }),
  ],
})
export class AppModule {}
```

### Using the database in a repository

```typescript
import { Inject } from '@konekti/core';
import { DrizzleDatabase } from '@konekti/drizzle';
import { users } from './schema';
import { eq } from 'drizzle-orm';

export class UserRepository {
  constructor(private db: DrizzleDatabase) {}

  async findById(id: string) {
    // current() returns the tx handle if inside a transaction, root db otherwise
    return this.db.current().select().from(users).where(eq(users.id, id));
  }
}
```

### Explicit transaction

```typescript
await this.db.transaction(async () => {
  // db.current() returns the tx handle inside this callback
  await userRepo.create(data);
  await auditRepo.log(data.id);
});
```

### Automatic request-scoped transaction (opt-in)

```typescript
import { UseInterceptor } from '@konekti/http';
import { DrizzleTransactionInterceptor } from '@konekti/drizzle';

@UseInterceptor(DrizzleTransactionInterceptor)
class UsersController {}
```

## Key API

| Export | Location | Description |
|---|---|---|
| `DrizzleDatabase` | `src/database.ts` | Wrapper with `current()`, `transaction()`, `requestTransaction()`, `onApplicationShutdown()` |
| `createDrizzleModule(options)` | `src/module.ts` | Creates an importable Konekti module with all providers |
| `createDrizzleProviders(options)` | `src/module.ts` | Returns the raw provider array for manual registration |
| `DrizzleTransactionInterceptor` | `src/transaction.ts` | Opt-in interceptor for automatic per-request transactions |
| `DRIZZLE_DATABASE` | `src/tokens.ts` | DI token for the raw Drizzle database handle |
| `DRIZZLE_DISPOSE` | `src/tokens.ts` | DI token for the optional cleanup hook |
| `DRIZZLE_OPTIONS` | `src/tokens.ts` | DI token for normalized Drizzle module options |
| `DrizzleDatabaseLike` | `src/types.ts` | Seam type — any object with a `transaction` callback |
| `DrizzleModuleOptions` | `src/types.ts` | `{ database, dispose?, strictTransactions? }` |
| `DrizzleHandleProvider` | `src/types.ts` | Public transaction-aware handle contract |

## Architecture

```
createDrizzleModule({ database, dispose?, strictTransactions? })
  → registers DRIZZLE_DATABASE, DRIZZLE_DISPOSE, and DRIZZLE_OPTIONS tokens
  → registers DrizzleDatabase and DrizzleTransactionInterceptor as exported providers

service/repository code
  → DrizzleDatabase.current()
  → returns tx handle (if inside transaction) or root db

DrizzleDatabase.transaction(fn)
  → calls database.transaction(callback) if available
  → AsyncLocalStorage stores tx handle
  → current() returns tx handle within the callback

app.close()
  → onApplicationShutdown()
  → calls dispose(database) if provided
```

### Why DRIZZLE_DISPOSE is a separate token

Separating the cleanup hook from the database value means:
- The database object stays clean
- Shutdown cleanup can be selectively wired without touching the handle
- Tests can verify dispose behavior independently

### Transaction semantics

`DrizzleDatabase` uses `AsyncLocalStorage` to track the active transaction context. Service and repository code calls `current()` without knowing whether they are inside a transaction or not — the ALS store handles the switch transparently.

## File reading order for contributors

1. `src/types.ts` — `DrizzleDatabaseLike`, `DrizzleModuleOptions`, `DrizzleHandleProvider`
2. `src/tokens.ts` — `DRIZZLE_DATABASE`, `DRIZZLE_DISPOSE`
3. `src/database.ts` — `DrizzleDatabase` wrapper, ALS-based tx context
4. `src/module.ts` — `createDrizzleProviders`, `createDrizzleModule`
5. `src/transaction.ts` — `DrizzleTransactionInterceptor`
6. `src/module.test.ts` — root handle usage, tx handle inside callback, dispose hook

## Related packages

- `@konekti/runtime` — module import/export and shutdown lifecycle
- `@konekti/prisma` — the same problem solved for Prisma; compare for perspective
- `@konekti/cli` — scaffold includes this package when Drizzle is selected

## One-liner mental model

```text
@konekti/drizzle = Drizzle handle → tx-aware wrapper + optional cleanup hook → Konekti runtime
```
