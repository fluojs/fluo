# @fluojs/mongoose

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>
<!-- fluo-mongoose-contract: application-owned-connection, ambient-session-merge, preserves-operation-options, strict-fail-open, explicit-target -->

Mongoose integration for fluo with session-aware transaction handling and lifecycle-friendly connection management.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Lifecycle and Shutdown](#lifecycle-and-shutdown)
- [Common Patterns](#common-patterns)
  - [Service Transaction Boundary (@Transaction)](#service-transaction-boundary-transaction)
  - [Saving an Existing Document](#saving-an-existing-document)
  - [Request Transaction Interceptor Compatibility](#request-transaction-interceptor-compatibility)
  - [Manual Transactions and currentSession()](#manual-transactions-and-currentsession)
  - [Cache Invalidation After Commit](#cache-invalidation-after-commit)
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

The root `@fluojs/mongoose` wrapper uses Node.js `node:async_hooks` for ambient transaction context and requires Node.js `>=24.0.0 <27` as its package-owned support contract. Upgrade Node 20 and Node 22 hosts to Node.js `>=24.0.0 <27`; Node versions below 24 and Node 27+ are unsupported. For non-Node runtimes, register raw Mongoose-compatible handles behind application-owned providers instead of importing the root wrapper until a runtime-specific transaction-context adapter is documented.

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
2. Active ambient sessions, original request callbacks, and fail-open direct-execution transaction callbacks are tracked until their work settles.
3. Their Mongoose sessions finish `abortTransaction()` and `endSession()` cleanup only after started callbacks settle.
4. The configured `dispose(connection)` hook runs only after active request transactions and ambient session scopes have settled.

When request cancellation or shutdown aborts a boundary after its callback has started, the boundary preserves the abort result but waits for the original callback to settle before rolling back, ending the session, or disposing the connection. This prevents ALS-backed work from continuing against an already-cleaned-up session or connection.

`MongooseConnection.createPlatformStatusSnapshot()` and the exported low-level `createMongoosePlatformStatusSnapshot(...)` helper report `ready` while serving traffic, `shutting-down` while request transactions are draining, and `stopped` after the dispose hook completes. The status details include `sessionStrategy`, `transactionContext: 'als'`, active request/session counts, resource ownership, and strict/session support diagnostics. Manual `transaction()` calls and service `@Transaction()` methods expose the same ambient session to `conn.model(...)`; supported facade methods (`create`, `find`, `findOne`, `aggregate`, and `bulkWrite`) automatically attach that session. Automatic session injection is scoped to the `MongooseConnection.model(...)` wrapper method and does not replace or mutate the raw `connection.model(...)` cache/compile path returned by `conn.current()`. Use `conn.currentSession()` for unsupported model methods, `doc.save()`, or external utilities that need explicit session plumbing. If the wrapped Mongoose connection exposes `connection.transaction(...)`, fluo delegates the transaction boundary to that API so Mongoose's own ambient-session scope is preserved while still exposing the same session through `currentSession()`. Request-scoped transactions observe the request `AbortSignal` while acquiring sessions and while starting delegated `connection.transaction(...)` work, so request cancellation can interrupt those startup phases before user callbacks run.
Nested `requestTransaction(...)` calls opened inside an existing manual `transaction(...)` boundary reuse the ambient session, stay visible in `details.activeRequestTransactions`, and are aborted during shutdown so the outer manual transaction can roll back before `dispose(connection)` runs.

## Common Patterns

### Service Transaction Boundary (@Transaction)

The `@Transaction()` decorator is the recommended way to define transaction boundaries in your service layer. It ensures that all repository calls made within the decorated method share the same MongoDB session.

```ts
import { Inject } from '@fluojs/core';
import { MongooseConnection, Transaction, type MongooseModelFacade } from '@fluojs/mongoose';

type UserDocumentSaveOptions = {
  readonly validateBeforeSave?: boolean;
  readonly session?: object | null;
};
type UserDocument = {
  readonly _id: string;
  readonly name: string;
  save(options?: UserDocumentSaveOptions): Promise<UserDocument>;
};
type UserCreateModel = MongooseModelFacade<Promise<readonly [UserDocument]>>;
type ProfileCreateModel = MongooseModelFacade<Promise<readonly { readonly userId: string }[]>>;

@Inject(MongooseConnection)
export class UserRepository {
  constructor(private readonly conn: MongooseConnection) {}

  async create(data: CreateUserDto) {
    // model() returns a session-aware facade inside @Transaction().
    // Operations like create, find, findOne, aggregate, and bulkWrite
    // automatically participate in the ambient transaction.
    return this.conn.model<UserCreateModel>('User').create([data]);
  }

  async initProfile(userId: string) {
    return this.conn.model<ProfileCreateModel>('Profile').create([{ userId }]);
  }
}

@Inject(UserRepository)
export class UserService {
  constructor(private readonly repo: UserRepository) {}

  @Transaction()
  async onboardUser(dto: CreateUserDto) {
    const [user] = await this.repo.create(dto);
    await this.repo.initProfile(user._id);
    return user;
  }
}
```

Calls to `@Transaction()` methods are reentrant. If a decorated method calls another decorated method, they share the same underlying MongoDB session. Note that `doc.save()` is not automatically session-aware in v1; use the supported facade operations (`model.create()`, `model.find()`, `model.findOne()`, `model.aggregate()`, or `model.bulkWrite()`) for automatic transaction participation.

`@Transaction()` resolves `this.conn`, the decorated instance when it is transaction-capable, or one unique nested `this.*.conn` collaborator. It does not select arbitrary connection fields. When a service owns multiple connections or stores its connection elsewhere, select the boundary explicitly:

```ts
@Inject(MongooseConnection)
export class AnalyticsService {
  constructor(private readonly analyticsConnection: MongooseConnection) {}

  @Transaction((self: AnalyticsService) => self.analyticsConnection)
  async rebuildReports() {
    // Uses analyticsConnection rather than an inferred connection.
  }
}
```

### Saving an Existing Document

<!-- fluo-mongoose-save-document-contract: opt-in, active-session, save-compatible-document -->

Use the opt-in `MongooseConnection.saveDocument(...)` helper when an existing Mongoose document must save inside an active `@Transaction()`, `transaction()`, or `requestTransaction()` boundary:

```ts
@Transaction()
async rename(document: UserDocument) {
  return this.conn.saveDocument(document, { validateBeforeSave: false });
}
```

The helper forwards native Mongoose save options, attaches the ambient session, and returns the same document instance. It fails closed outside an active transaction and rejects `{ session: null }` or a different explicit session so a save cannot leave the current transaction accidentally. It never patches documents, prototypes, or model caches: calling `doc.save()` directly remains native Mongoose behavior and does not receive an automatic session.

### Request Transaction Interceptor Compatibility

`MongooseTransactionInterceptor` is restored as a deprecated 1.x compatibility export for existing request-wide `@UseInterceptors(...)` boundaries. `MongooseModule.forRoot(...)` and `forRootAsync(...)` provide and export it. It delegates to `MongooseConnection.requestTransaction(...)` and forwards the request `AbortSignal`.

```ts
import { Controller, Post, UseInterceptors } from '@fluojs/http';
import { MongooseTransactionInterceptor } from '@fluojs/mongoose';

@Controller('/orders')
export class OrdersController {
  @Post('/')
  @UseInterceptors(MongooseTransactionInterceptor)
  createOrder() {
    return this.orders.create();
  }
}
```

Prefer service-layer `@Transaction()` for new business operations. Keep this interceptor only while migrating existing request-wide boundaries, or replace it with an explicit `requestTransaction(...)` call when request orchestration must make the boundary visible.

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

For supported facade methods, fluo preserves existing Mongoose operation options and only merges the ambient `{ session }` into the correct options argument. `create(...)` injects the session only through Mongoose's array overload, `create([docs], options?)`. Positional `create(docA, docB)` arguments are forwarded unchanged—even when the last document contains option-like fields such as `timestamps`—and therefore do not receive automatic session injection. Use the array overload for transaction participation. If a model call passes an explicit `{ session: null }` or a different session object inside an ambient transaction, including the third options argument of `findOne(filter, projection, options)`, fluo throws a session conflict error to prevent accidental transaction escapes. Pass a result-specialized `MongooseModelFacade` as the `model<TModel>(...)` type argument when repository code needs typed operation results.

### Choosing Rollback from a Result

First register native rollback confirmation. Include the module returned by this complete helper in application imports. A `forRootAsync` factory can return the same `rollbackObserver`; directly constructed wrappers/facades accept it in their existing runtime-options object too. It is not a native driver option.

```ts
import { createMongooseRollbackObserver, MongooseModule } from '@fluojs/mongoose';
import mongoose from 'mongoose';

export function resultTransactions(databaseUrl: string) {
  const connection = mongoose.createConnection(databaseUrl, { monitorCommands: true });
  return MongooseModule.forRoot({
    connection,
    rollbackObserver: createMongooseRollbackObserver(connection.getClient()),
    dispose: () => connection.close(),
  });
}
```

Use the `shouldRollback` example below with this configuration. Existing wrappers without an observer still support ordinary transactions, but Result opt-in rejects before callbacks. These capability types and errors are also package root exports.

- `createMongooseRollbackObserver(...)`: the public native observation helper above.
- `TransactionRollbackObserver`: advanced capability contract whose `run<T>(callback): Promise<T>` opens an owner observation scope and whose `beginAttempt(transaction)` binds a native attempt.
- `TransactionRollbackObservation`: `confirmRollback(): true | Promise<true>` returns only independently confirmed rollback success and reports failure/uncertainty by throwing. Do not implement it using sentinel identity or a no-op.
- `TransactionRollbackUnconfirmedError`: positive native rollback confirmation is absent, so a normal Result cannot be returned.


`shouldRollback` is an opt-in synchronous predicate for a callback's normal return value. This complete consumer helper accepts a registered connection wrapper. `persist` performs DB work through that wrapper's supported model facade or an explicit ambient session. This `Result` is a consumer type, not a global Fluo result convention.

```ts
import type { MongooseConnection, TransactionBoundaryOptions } from '@fluojs/mongoose';

type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

export function persistWithResult<T>(
  conn: MongooseConnection,
  persist: () => Promise<Result<T>>,
): Promise<Result<T>> {
  const boundary: TransactionBoundaryOptions<Result<T>> = {
    shouldRollback: (value) => !value.ok,
  };
  return conn.transaction(persist, boundary);
}
```

Use the existing Fluo boundary position in `transaction(fn, boundary?)`, `requestTransaction(fn, signal?, boundary?)`, and `@Transaction(accessor?, boundary?)`, for example `@Transaction(undefined, { shouldRollback: (value: Result<string>) => !value.ok })`. No Mongoose native-options argument is added.

If the root predicate returns `true`, the same root value is returned after native rollback and required session cleanup succeed. A nested predicate returning `true` returns the original nested value while marking the shared owner sticky rollback-only. If the root also rejects its own result, its root failure value is returned; otherwise, `TransactionRollbackOnlyError` is thrown after rollback with the first nested failure in `readonly result: unknown`. Omission preserves existing exception-based behavior.

A fallback or legacy target that cannot own rollback rejects with `TransactionRollbackCapabilityError` before the opted-in callback. Both errors are root exports of `@fluojs/mongoose`; distinguish them with `instanceof`. Native commit, rollback, and cleanup errors are not hidden by domain results. Distinguish these rollback errors from `AfterCommitError` and `AfterCommitCleanupError`, which follow an already-completed commit.

Rollback discards all hooks. Ordinary caught nested exceptions do not mark rollback-only, so a final commit retains writes and hooks. Native callback retries create a fresh owner and queue per attempt without carrying earlier failure values or rollback-only state; commit-only retries do not rerun the callback. External raw transactions and Redis `MULTI/EXEC` are unsupported; this adds no savepoint or durability guarantee. Follow the [shared-owner contract](../../docs/architecture/transactions.md#result-based-rollback) for the complete rules.

Result rollback also requires a registered `rollbackObserver` backed by native evidence. A sentinel or local session state is not proof of rollback. Missing capability rejects before the callback; missing or failed confirmation rejects with a native error or `TransactionRollbackUnconfirmedError`, never a normal Result. The shared contract above specifies registration helpers and supported configurations.

### Cache Invalidation After Commit

`MongooseConnection.afterCommit(...)` registers work on an open native transaction owned by the same wrapper. This function uses an application-owned connection whose `User` model is already compiled, and `CacheService` from a registered `CacheModule`. The supported array `create` facade attaches the ambient session.

```ts
import type { CacheService } from '@fluojs/cache-manager';
import { MongooseConnection, type MongooseModelFacade } from '@fluojs/mongoose';

type UserCreateModel = MongooseModelFacade<Promise<readonly { name: string }[]>>;

async function createUser(conn: MongooseConnection, cache: CacheService, name: string) {
  return conn.transaction(async () => {
    const users = await conn.model<UserCreateModel>('User').create([{ name }]);
    conn.afterCommit(async () => {
      await cache.del('users:list');
    });
    return users;
  }, { requireAfterCommit: true });
}
```

`requireAfterCommit: true` checks native commit observation capability before the user callback and rejects with `AfterCommitCapabilityError` when it is unavailable. Existing `strictTransactions: false` and direct-execution fallback remain unchanged when the option is omitted or `false`, but hook registration is rejected in a fallback without a native transaction. Services can use `@Transaction(undefined, { requireAfterCommit: true })` or `@Transaction((self) => self.conn, { requireAfterCommit: true })`.

When delegated `connection.transaction(...)` retries the callback, each attempt owns an isolated queue and only the final successful attempt drains. Hooks from discarded attempts, rollback, and failed commit do not run. A commit-only retry that does not rerun the callback does not register hooks again. Nested boundaries within the same attempt share the queue; when the outer callback catches a nested exception without a savepoint, the final outer commit/rollback outcome applies.

When the user callback settles, the registration scope closes before native commit begins. After successful outer native commit and settlement of the owned session's `endSession()` cleanup attempt, hooks run sequentially in FIFO order outside the ended ALS context. A hook's `current()` returns the root connection and `currentSession()` does not expose the previous session. A new transaction admitted by the lifecycle owns a fresh queue. Registration outside a scope, in a closed scope, or late during drain is rejected. Shutdown waits for hook drain before calling the configured `dispose(connection)`.

If session cleanup succeeds but a hook fails, all hooks still run before `AfterCommitError` is thrown. `committed` is `true`, `results` contains every fulfilled and rejected FIFO outcome, and inherited `errors` contains all hook failure reasons. Distinguish it with `error instanceof AfterCommitError` and do not repeat the DB write. Fluo does not retry or roll back the native transaction for hook failures; cache recovery and reconciliation belong to the application.

If `endSession()` fails in the manual-session path **after commit is confirmed** for an owning boundary that registered hooks or opted into `requireAfterCommit: true` (including a nested `requestTransaction` requirement), every hook is still attempted outside the ended ALS context, and `AfterCommitCleanupError` is reported after drain. This class directly extends `AggregateError`, not `AfterCommitError`, so `instanceof AfterCommitError` alone does not catch it. Import `AfterCommitCleanupError` separately from the root package to distinguish it. `committed` is `true`, `cause` is the cleanup failure, and `results: readonly PromiseSettledResult<void>[]` contains **hook outcomes only**, in FIFO order. `errors` contains the cleanup failure first, followed by rejected hook reasons in registration order. Cleanup failure is still reported with no hooks when opted in, or when all registered hooks succeed; cleanup is not inserted as a synthetic hook in `results`. The DB write is already confirmed: do not run native retry, rollback, or abort because of this error. Legacy boundaries with no hooks and no `requireAfterCommit` requirement preserve the original cleanup error identity and no-hook request cancellation contract, including the original `AbortError`.

Commits from external raw-client transactions, other wrappers, or other connections are not observed. Redis itself is unsupported because it has no Fluo-owned commit tracking, and Redis calls from DB hooks do not provide DB+Redis atomicity. This covers successful in-process owner invocations, not a durable outbox or crash/network exactly-once. Follow the [Transaction Context Contract](../../docs/architecture/transactions.md#after-commit-work) for the full contract.

## Public API

| Transaction API | Inputs and completion |
| --- | --- |
| `transaction(fn, boundary?): Promise<T>` | Appends Fluo `boundary` after the existing async `fn`. The commit path returns the original result after hook drain; opt-in rollback follows the return and error rules above. |
| `requestTransaction(fn, signal?, boundary?): Promise<T>` | Takes `boundary` after the existing request `AbortSignal`. |
| `afterCommit(callback: AfterCommitCallback): void` | Registers work in an open native scope without running it immediately. Unsupported boundaries, no native transaction, missing scope, and closed scopes reject registration. |
| `Transaction(accessor?, boundary?)` | Fluo `boundary` is the second argument, after the existing connection accessor. |

The boundary APIs take Fluo-only `boundary?: TransactionBoundaryOptions<T>`; no native Mongoose options argument is added. `afterCommit` itself does not take a boundary argument.

Additional exports from the root `@fluojs/mongoose` package:

- `AfterCommitCallback`: `() => void | Promise<void>`.
- `TransactionBoundaryOptions<T = unknown>`: `{ readonly requireAfterCommit?: boolean; readonly shouldRollback?: (value: T) => boolean }`.
- `TransactionRollbackCapabilityError`: raised before the callback on a boundary that cannot support opt-in rollback.
- `TransactionRollbackOnlyError`: raised when an owner marked rollback-only by a nested opt-in failure cannot return a root failure value; `readonly result: unknown` contains the first nested failure value.
- `AfterCommitCapabilityError`: failure when required native commit capability is missing or a hook is registered on an unsupported boundary.
- `AfterCommitError extends AggregateError`: exposes `readonly committed = true` and `results: readonly PromiseSettledResult<void>[]` for every FIFO outcome, with all failures in inherited `errors`.
- `AfterCommitCleanupError extends AggregateError`: a separate class for manual-session cleanup failure after confirmed commit when hooks are registered or `requireAfterCommit: true` is required. Exposes `readonly committed = true`, cleanup failure as `cause`, hook-only FIFO `results: readonly PromiseSettledResult<void>[]`, and cleanup-first `errors`. It does not extend `AfterCommitError`.

- `MongooseConnection.saveDocument(document, options?)` — explicitly saves an existing document with the current transaction session while preserving native save options and document identity.
- `MongooseModule.forRoot(options)` / `MongooseModule.forRootAsync(options)`
- `MongooseConnection`
- `MongooseConnection.createPlatformStatusSnapshot()` — reports health/readiness, resource ownership, active request/session drain counts, and strict transaction support diagnostics for platform observability surfaces.
- `MongooseConnection.model<TModel>(name, ...args)` — returns the callable, result-specializable `MongooseModelFacade` outside transactions or a session-aware version for `create`, `find`, `findOne`, `aggregate`, and `bulkWrite` inside an active transaction without mutating the underlying Mongoose connection.
- `Transaction`
- `MongooseTransactionInterceptor` — deprecated request-wide compatibility interceptor; prefer service `@Transaction()` or explicit `requestTransaction(...)` in new code.
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
- `MongooseModelFacade`
- `MongooseHandleProvider`
- `MongoosePlatformStatusSnapshotInput`

## Related Packages

- `@fluojs/runtime`: manages startup and shutdown hooks
- `@fluojs/http`: provides request lifecycle primitives that can be paired with explicit `requestTransaction(...)` boundaries
- `@fluojs/prisma` and `@fluojs/drizzle`: alternate database integrations with different transaction models

## Example Sources

- `packages/mongoose/src/after-commit.test.ts`: verification target for attempt-local hook queues and drain after session cleanup. The common behavior matrix is `tooling/governance/after-commit-contract.test.ts`. Follow the [shared fixture Run instructions](../prisma/fixtures/after-commit/README.md#run) for native MongoDB manual/delegated paths; actual results require a separate verification receipt.

- `packages/mongoose/src/vertical-slice.test.ts`
- `packages/mongoose/src/module.test.ts`
- `packages/mongoose/src/public-api.test.ts`
