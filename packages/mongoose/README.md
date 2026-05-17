# @fluojs/mongoose

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Mongoose integration for fluo with session-aware transaction handling and lifecycle-friendly connection management.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Lifecycle and Shutdown](#lifecycle-and-shutdown)
- [Common Patterns](#common-patterns)
- [Public API](#public-api)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
pnpm add @fluojs/mongoose
pnpm add mongoose
```

## When to Use

- when Mongoose should plug into the same DI and application lifecycle as the rest of the app
- when MongoDB sessions and transactions need one shared wrapper instead of ad hoc session plumbing in every service
- when request-scoped transactions should be opt-in through an interceptor

## Quick Start

```ts
import { Module } from '@fluojs/core';
import { MongooseModule } from '@fluojs/mongoose';
import mongoose from 'mongoose';

const connection = mongoose.createConnection('mongodb://localhost:27017/test');

@Module({
  imports: [
    MongooseModule.forRoot({
      connection,
      dispose: async (conn) => conn.close(),
    }),
  ],
})
class AppModule {}
```

`MongooseModule.forRootAsync(...)` accepts injected dependencies and a `useFactory` that may return options synchronously or asynchronously. Use the exported `MongooseAsyncModuleOptions<TConnection>` type when sharing async registration helpers across modules. Pass `global` on the top-level async registration when the providers should be visible globally. The resolved options are reused within one application container, so connection setup and disposal hooks stay consistent across that container's providers. Reusing the same async module definition across tests or multi-app processes resolves fresh options per application container instead of sharing a memoized connection.

## Lifecycle and Shutdown

`MongooseModule` registers `MongooseConnection` with the fluo application lifecycle. The package does not create or own the raw Mongoose connection for you; pass a `dispose` hook when the application should close that external connection during shutdown.

Shutdown preserves transaction cleanup order and rejects new manual or request-scoped transaction boundaries once shutdown begins:

1. Open request-scoped transactions are aborted with `Application shutdown interrupted an open request transaction.`
2. Active ambient sessions are tracked until their transaction callback and session cleanup settle.
3. Their Mongoose sessions finish `abortTransaction()` and `endSession()` cleanup.
4. The configured `dispose(connection)` hook runs only after active request transactions and ambient session scopes have settled.

`createMongoosePlatformStatusSnapshot(...)` reports `ready` while serving traffic, `shutting-down` while request transactions are draining, and `stopped` after the dispose hook completes. The status details include `sessionStrategy`, `transactionContext: 'als'`, active request/session counts, resource ownership, and strict/session support diagnostics. Manual `transaction()` calls still use the same explicit-session contract as request-scoped transactions: repository code must pass `conn.currentSession()` into Mongoose model operations that participate in the transaction. If the wrapped Mongoose connection exposes `connection.transaction(...)`, fluo delegates the transaction boundary to that API so Mongoose's own ambient-session scope is preserved while still exposing the same session through `currentSession()`. Request-scoped transactions observe the request `AbortSignal` while acquiring sessions and while starting delegated `connection.transaction(...)` work, so request cancellation can interrupt those startup phases before user callbacks run.
Nested `requestTransaction(...)` calls opened inside an existing manual `transaction(...)` boundary reuse the ambient session, stay visible in `details.activeRequestTransactions`, and are aborted during shutdown so the outer manual transaction can roll back before `dispose(connection)` runs.

## Common Patterns

### Access the connection through `MongooseConnection`

```ts
import { MongooseConnection } from '@fluojs/mongoose';

export class UserRepository {
  constructor(private readonly conn: MongooseConnection) {}

  async findById(id: string) {
    const User = this.conn.current().model('User');
    return User.findById(id);
  }
}
```

### Manual transactions still need explicit sessions

```ts
await this.conn.transaction(async () => {
  const session = this.conn.currentSession();
  const User = this.conn.current().model('User');

  await User.create([{ name: 'Ada' }], { session });
});
```

If the wrapped connection implements `connection.transaction(...)`, fluo treats that as the strict transaction boundary even when `startSession()` is not exposed directly. Otherwise, when the connection does not implement `startSession()`, transactions fall back to direct execution by default. Set `strictTransactions: true` to throw `Transaction not supported: Mongoose connection does not implement startSession.` instead of falling back.

Fluo never rewrites Mongoose operation options. If a model call passes an explicit `{ session }`, that option is left intact; if it omits one, repositories should not assume fluo will attach a session for them. Keep same-session parallel work and nested transaction expectations conservative: nested `MongooseConnection.transaction(...)` calls reuse the active boundary rather than opening a second MongoDB transaction on the same session.

### Request-scoped transactions

```ts
import { UseInterceptors } from '@fluojs/http';
import { MongooseTransactionInterceptor } from '@fluojs/mongoose';

@UseInterceptors(MongooseTransactionInterceptor)
class UserController {}
```

Use `MongooseConnection.requestTransaction(...)` directly when you need the same request-aware transaction boundary outside an HTTP interceptor. Nested service transactions reuse the active session boundary, and nested request boundaries opened inside a manual transaction still participate in request abort and shutdown tracking.

## Public API

- `MongooseModule.forRoot(options)` / `MongooseModule.forRootAsync(options)`
- `MongooseConnection`
- `MongooseTransactionInterceptor`
- `MONGOOSE_CONNECTION`, `MONGOOSE_DISPOSE`, `MONGOOSE_OPTIONS`
- `createMongooseProviders(options)` — compatibility/manual composition helper; prefer `MongooseModule.forRoot(...)` or `MongooseModule.forRootAsync(...)` for application-facing registration so module exports and provider visibility stay aligned.
- `createMongoosePlatformStatusSnapshot(...)`
- `connection` must be a concrete object/function handle for both sync and async registration; missing handles are rejected during module registration or async bootstrap.

### Related exported types

- `MongooseModuleOptions<TConnection>`
- `MongooseAsyncModuleOptions<TConnection>`
- `MongooseConnectionLike`
- `MongooseSessionLike`
- `MongooseHandleProvider`
- `MongoosePlatformStatusSnapshotInput`

## Related Packages

- `@fluojs/runtime`: manages startup and shutdown hooks
- `@fluojs/http`: provides the interceptor chain for request transactions
- `@fluojs/prisma` and `@fluojs/drizzle`: alternate database integrations with different transaction models

## Example Sources

- `packages/mongoose/src/vertical-slice.test.ts`
- `packages/mongoose/src/module.test.ts`
- `packages/mongoose/src/public-api.test.ts`
