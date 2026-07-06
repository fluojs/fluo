# @fluojs/mongoose

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Mongoose integration for fluo with session-aware transaction handling and lifecycle-friendly connection management.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Lifecycle and Shutdown](#lifecycle-and-shutdown)
- [Common Patterns](#common-patterns)
  - [Service Transaction Boundary (@Transaction)](#service-transaction-boundary-transaction)
  - [Manual Transactions and currentSession()](#manual-transactions-and-currentsession)
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
- when request-scoped transactions need explicit `requestTransaction(...)` boundaries
- when an application already creates and configures its concrete Mongoose connection and wants fluo to observe, not replace, that ownership

The root `@fluojs/mongoose` wrapper uses Node.js `node:async_hooks` for ambient transaction context and supports Node.js 20 or newer, matching the package manifest `engines.node >=20.0.0`. For non-Node runtimes, register raw Mongoose-compatible handles behind application-owned providers instead of importing the root wrapper until a runtime-specific transaction-context adapter is documented.

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

`MongooseModule` registers `MongooseConnection` with the fluo application lifecycle. The package does not create or own the raw Mongoose connection for you; pass a concrete Mongoose connection object/function as `connection`, keep connection-string, pool, plugin, and model compilation ownership in the application, and provide a `dispose` hook when the application should close that external connection during shutdown.

Shutdown preserves transaction cleanup order and rejects new manual or request-scoped transaction boundaries once shutdown begins:

1. Open request-scoped transactions are aborted with `Application shutdown interrupted an open request transaction.`
2. Active ambient sessions and fail-open direct-execution transaction callbacks are tracked until their work settles.
3. Their Mongoose sessions finish `abortTransaction()` and `endSession()` cleanup.
4. The configured `dispose(connection)` hook runs only after active request transactions and ambient session scopes have settled.

`MongooseConnection.createPlatformStatusSnapshot()` and the exported low-level `createMongoosePlatformStatusSnapshot(...)` helper report `ready` while serving traffic, `shutting-down` while request transactions are draining, and `stopped` after the dispose hook completes. The status details include `sessionStrategy`, `transactionContext: 'als'`, active request/session counts, resource ownership, and strict/session support diagnostics. Manual `transaction()` calls and service `@Transaction()` methods expose the same ambient session to `conn.model(...)`; supported facade methods (`create`, `find`, `findOne`, `aggregate`, and `bulkWrite`) automatically attach that session. Automatic session injection is scoped to the `MongooseConnection.model(...)` wrapper method and does not replace or mutate the raw `connection.model(...)` cache/compile path returned by `conn.current()`. Use `conn.currentSession()` for unsupported model methods, `doc.save()`, or external utilities that need explicit session plumbing. If the wrapped Mongoose connection exposes `connection.transaction(...)`, fluo delegates the transaction boundary to that API so Mongoose's own ambient-session scope is preserved while still exposing the same session through `currentSession()`. Request-scoped transactions observe the request `AbortSignal` while acquiring sessions and while starting delegated `connection.transaction(...)` work, so request cancellation can interrupt those startup phases before user callbacks run.
Nested `requestTransaction(...)` calls opened inside an existing manual `transaction(...)` boundary reuse the ambient session, stay visible in `details.activeRequestTransactions`, and are aborted during shutdown so the outer manual transaction can roll back before `dispose(connection)` runs.

## Common Patterns

### Service Transaction Boundary (@Transaction)

The `@Transaction()` decorator is the recommended way to define transaction boundaries in your service layer. It ensures that all repository calls made within the decorated method share the same MongoDB session.

```ts
import { Transaction } from '@fluojs/mongoose';
import { UserRepository } from './user.repository';

export class UserService {
  constructor(private readonly repo: UserRepository) {}

  @Transaction()
  async onboardUser(dto: CreateUserDto) {
    const user = await this.repo.create(dto);
    await this.repo.initProfile(user._id);
    return user;
  }
}

export class UserRepository {
  constructor(private readonly conn: MongooseConnection) {}

  async create(data: any) {
    // model() returns a session-aware facade inside @Transaction().
    // Operations like create, find, findOne, aggregate, and bulkWrite
    // automatically participate in the ambient transaction.
    return this.conn.model('User').create(data);
  }

  async initProfile(userId: any) {
    return this.conn.model('Profile').create({ userId });
  }
}
```

Calls to `@Transaction()` methods are reentrant. If a decorated method calls another decorated method, they share the same underlying MongoDB session. Note that `doc.save()` is not automatically session-aware in v1; use the supported facade operations (`model.create()`, `model.find()`, `model.findOne()`, `model.aggregate()`, or `model.bulkWrite()`) for automatic transaction participation.

### Manual Transactions and currentSession()

The `MongooseConnection` provides `currentSession()` to access the ambient MongoDB session and `current()` to access the root connection handle. Use these as escape hatches when you need to pass sessions to external utilities or perform advanced manual plumbing.

```ts
import { MongooseConnection } from '@fluojs/mongoose';

export class AdvancedRepository {
  constructor(private readonly conn: MongooseConnection) {}

  async customOperation() {
    const session = this.conn.currentSession();
    const User = this.conn.current().model('User');
    
    // Explicitly passing the session
    return User.find({ status: 'active' }).session(session || null);
  }
}
```

Use `conn.transaction()` for manual transaction blocks:

```ts
await this.conn.transaction(async () => {
  const User = this.conn.model('User');
  await User.create([{ name: 'Ada' }]);
});
```

If the wrapped connection implements `connection.transaction(...)`, fluo treats that as the strict transaction boundary. Otherwise, when the connection does not implement `startSession()`, transactions use fail-open direct callback execution by default (`strictTransactions: false`), which is useful for local fakes and staged migrations but provides no rollback atomicity. Open fail-open manual `transaction(...)` callbacks still drain during shutdown before `dispose(connection)` runs. Set `strictTransactions: true` for production flows that require MongoDB transaction guarantees; missing transaction support then makes readiness `not-ready` and causes transaction helpers to throw.

For supported facade methods, fluo preserves existing Mongoose operation options and only merges the ambient `{ session }` into the correct options argument. If a model call passes an explicit `{ session: null }` or a different session object inside an ambient transaction, fluo throws a session conflict error to prevent accidental transaction escapes.

## Public API

- `MongooseModule.forRoot(options)` / `MongooseModule.forRootAsync(options)`
- `MongooseConnection`
- `MongooseConnection.createPlatformStatusSnapshot()` — reports health/readiness, resource ownership, active request/session drain counts, and strict transaction support diagnostics for platform observability surfaces.
- `MongooseConnection.model(name, ...args)` — returns the raw model outside transactions or a session-aware facade for `create`, `find`, `findOne`, `aggregate`, and `bulkWrite` inside an active transaction without mutating the underlying Mongoose connection.
- `Transaction`
- `MONGOOSE_CONNECTION`, `MONGOOSE_DISPOSE`, `MONGOOSE_OPTIONS`
- `createMongooseProviders(options)` — compatibility/manual composition helper; prefer `MongooseModule.forRoot(...)` or `MongooseModule.forRootAsync(...)` for application-facing registration so module exports and provider visibility stay aligned.
- `createMongoosePlatformStatusSnapshot(...)`
- `connection` must be a concrete object/function handle for both sync and async registration; missing handles are rejected during module registration or async bootstrap.
- `Transaction` is a standard TC39 method decorator for service-layer session transaction boundaries. It resolves `this.conn`, the decorated instance itself, or one unique nested `this.*.conn` collaborator by default; pass an accessor when the `MongooseConnection` lives under a different field or resolution would be ambiguous.

### Related exported types

- `MongooseModuleOptions<TConnection>`
- `MongooseAsyncModuleOptions<TConnection>`
- `MongooseConnectionLike`
- `MongooseSessionLike`
- `MongooseHandleProvider`
- `MongoosePlatformStatusSnapshotInput`

## Related Packages

- `@fluojs/runtime`: manages startup and shutdown hooks
- `@fluojs/http`: provides request lifecycle primitives that can be paired with explicit `requestTransaction(...)` boundaries
- `@fluojs/prisma` and `@fluojs/drizzle`: alternate database integrations with different transaction models

## Example Sources

- `packages/mongoose/src/vertical-slice.test.ts`
- `packages/mongoose/src/module.test.ts`
- `packages/mongoose/src/public-api.test.ts`
