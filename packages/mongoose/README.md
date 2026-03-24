# @konekti/mongoose

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Official Mongoose integration for Konekti — wraps a Mongoose connection with a session-aware transaction seam and an optional dispose hook.

## See also

- `../../docs/concepts/transactions.md`
- `../../docs/concepts/lifecycle-and-shutdown.md`

## What this package does

`@konekti/mongoose` connects a Mongoose connection to Konekti's module, DI, and lifecycle model. Unlike Prisma, Mongoose doesn't automatically inject sessions into model operations — so this integration provides a clean transaction context while keeping the `{ session }` propagation responsibility with application code.

Key responsibilities:
- Provide the `MongooseConnection` wrapper with `current()` / `currentSession()` / `transaction()` / `requestTransaction()`
- Register `MONGOOSE_CONNECTION`, `MONGOOSE_DISPOSE`, and `MONGOOSE_OPTIONS` tokens in the DI container
- Wire the optional `dispose` hook into `onApplicationShutdown`
- Expose `MongooseTransactionInterceptor` for opt-in automatic request-scoped transactions

## Installation

```bash
npm install @konekti/mongoose
```

## Quick Start

```typescript
import { Module } from '@konekti/core';
import { createMongooseModule } from '@konekti/mongoose';
import mongoose from 'mongoose';

const connection = mongoose.createConnection(process.env.MONGODB_URI);

@Module({
  imports: [
    createMongooseModule({
      connection,
      dispose: async (conn) => {
        await conn.close();
      },
    }),
  ],
})
export class AppModule {}
```

### Using the connection in a repository

```typescript
import { Inject } from '@konekti/core';
import { MongooseConnection } from '@konekti/mongoose';
import { Model } from 'mongoose';

export class UserRepository {
  constructor(private conn: MongooseConnection) {}

  async findById(id: string) {
    // current() returns the Mongoose connection
    const connection = this.conn.current();
    const User = connection.model('User');
    return User.findById(id);
  }
}
```

### Explicit transaction

```typescript
await this.conn.transaction(async () => {
  // currentSession() returns the active session inside this callback
  const session = this.conn.currentSession();
  
  // You must pass { session } to Mongoose operations that should participate
  await User.create([{ email: 'ada@example.com' }], { session });
  await AuditLog.create([{ userId: user.id }], { session });
});
```

### Automatic request-scoped transaction (opt-in)

```typescript
import { UseInterceptor } from '@konekti/http';
import { MongooseTransactionInterceptor } from '@konekti/mongoose';

@UseInterceptor(MongooseTransactionInterceptor)
class UsersController {}
```

## Key API

| Export | Location | Description |
|---|---|---|
| `MongooseConnection` | `src/connection.ts` | Wrapper with `current()`, `currentSession()`, `transaction()`, `requestTransaction()`, `onApplicationShutdown()` |
| `createMongooseModule(options)` | `src/module.ts` | Creates an importable Konekti module with all providers |
| `createMongooseProviders(options)` | `src/module.ts` | Returns the raw provider array for manual registration |
| `MongooseTransactionInterceptor` | `src/transaction.ts` | Opt-in interceptor for automatic per-request transactions |
| `MONGOOSE_CONNECTION` | `src/tokens.ts` | DI token for the raw Mongoose connection |
| `MONGOOSE_DISPOSE` | `src/tokens.ts` | DI token for the optional cleanup hook |
| `MONGOOSE_OPTIONS` | `src/tokens.ts` | DI token for normalized Mongoose module options |
| `MongooseConnectionLike` | `src/types.ts` | Seam type — any object with optional `startSession()` |
| `MongooseSessionLike` | `src/types.ts` | Session contract with `startTransaction()`, `commitTransaction()`, `abortTransaction()`, `endSession()` |
| `MongooseModuleOptions` | `src/types.ts` | `{ connection, dispose?, strictTransactions? }` |
| `MongooseHandleProvider` | `src/types.ts` | Public connection-aware handle contract |

## Architecture

```
createMongooseModule({ connection, dispose?, strictTransactions? })
  → registers MONGOOSE_CONNECTION, MONGOOSE_DISPOSE, and MONGOOSE_OPTIONS tokens
  → registers MongooseConnection and MongooseTransactionInterceptor as exported providers

service/repository code
  → MongooseConnection.current()
  → returns the Mongoose connection

MongooseConnection.transaction(fn)
  → calls connection.startSession() if available
  → starts a transaction on the session
  → AsyncLocalStorage stores the session
  → currentSession() returns the session within the callback
  → application code must pass { session: conn.currentSession() } to Mongoose operations

app.close()
  → onApplicationShutdown()
  → aborts open request transactions
  → calls dispose(connection) if provided
```

### Why MONGOOSE_DISPOSE is a separate token

Separating the cleanup hook from the connection value means:
- The connection object stays clean
- Shutdown cleanup can be selectively wired without touching the connection handle
- Tests can verify dispose behavior independently

### Transaction semantics

`MongooseConnection` uses `AsyncLocalStorage` to track the active session context. Service and repository code calls `currentSession()` to obtain the session, then passes `{ session }` to Mongoose operations that should participate in the transaction.

**Important**: Unlike Prisma, Mongoose operations do not automatically use the ambient session. Application code must explicitly pass `{ session: mongooseConnection.currentSession() }` to each operation.

### Nested transaction behavior

When `transaction()` or `requestTransaction()` is called inside an existing transaction, the ambient session is reused rather than starting a new nested transaction. This matches Mongoose's actual nested transaction semantics.

## File reading order for contributors

1. `src/types.ts` — `MongooseConnectionLike`, `MongooseSessionLike`, `MongooseModuleOptions`, `MongooseHandleProvider`
2. `src/tokens.ts` — `MONGOOSE_CONNECTION`, `MONGOOSE_DISPOSE`, `MONGOOSE_OPTIONS`
3. `src/connection.ts` — `MongooseConnection` wrapper, ALS-based session context
4. `src/module.ts` — `createMongooseProviders`, `createMongooseModule`
5. `src/transaction.ts` — `MongooseTransactionInterceptor`
6. `src/module.test.ts` — connection usage, session transactions, dispose hook

## Related packages

- `@konekti/runtime` — module import/export and shutdown lifecycle
- `@konekti/drizzle` — the same problem solved for Drizzle; compare for perspective
- `@konekti/prisma` — the same problem solved for Prisma; compare for perspective
- `@konekti/cli` — scaffold includes this package when Mongoose is selected

## One-liner mental model

```text
@konekti/mongoose = Mongoose connection → session-aware tx wrapper + optional cleanup hook → Konekti runtime
```
