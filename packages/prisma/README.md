# @fluojs/prisma

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Node.js `>=24.0.0 <27` Prisma lifecycle and ALS-backed transaction context for fluo applications. Connects a `PrismaClient` to the module system with automatic connection management and request-scoped transactions.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
  - [Service Transaction Boundary (@Transaction)](#service-transaction-boundary-transaction)
  - [Request Transaction Interceptor Compatibility](#request-transaction-interceptor-compatibility)
  - [Named Registrations for Multiple Clients](#named-registrations-for-multiple-clients)
  - [Manual Transactions and current()](#manual-transactions-and-current)
  - [Cache Invalidation After Commit](#cache-invalidation-after-commit)
  - [Shutdown and Status Contracts](#shutdown-and-status-contracts)
  - [Async Configuration and Isolation](#async-configuration-and-isolation)
  - [Manual Module Composition](#manual-module-composition)
- [Public API Overview](#public-api-overview)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
pnpm add @fluojs/prisma
# Ensure @prisma/client is also installed
pnpm add @prisma/client
```

## When to Use

- When using Prisma as your ORM on Node.js `>=24.0.0 <27` and you want it integrated with fluo's dependency injection and lifecycle hooks.
- When you need a reliable way to share a transaction context across multiple services and repositories without passing a `tx` object everywhere.
- When you want automatic `$connect` on startup and `$disconnect` on shutdown.

## Quick Start

Register the `PrismaModule` in your root module by providing a `PrismaClient` instance.

```typescript
import { Module } from '@fluojs/core';
import { PrismaModule } from '@fluojs/prisma';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

@Module({
  imports: [
    PrismaModule.forRoot({ client: prisma }),
  ],
})
class AppModule {}
```

## Common Patterns

### Service Transaction Boundary (@Transaction)

The `@Transaction()` decorator is the recommended way to define transaction boundaries in your service layer. It ensures that all repository calls made within the decorated method share the same Prisma transaction.

```typescript
import { Inject } from '@fluojs/core';
import { PrismaService, Transaction, type PrismaServiceFacade } from '@fluojs/prisma';
import { PrismaClient } from '@prisma/client';
import { UserRepository } from './user.repository';

@Inject(UserRepository)
export class UserService {
  constructor(private readonly repo: UserRepository) {}

  @Transaction()
  async onboardUser(dto: CreateUserDto) {
    const user = await this.repo.create(dto);
    await this.repo.initProfile(user.id);
    return user;
  }
}
```

Calls to `@Transaction()` methods are reentrant. If a decorated method calls another decorated method, they share the same underlying Prisma transaction.

### Request Transaction Interceptor Compatibility

`PrismaTransactionInterceptor` is restored as a deprecated 1.x compatibility export for existing `@UseInterceptors(...)` request-wide boundaries. The unnamed `PrismaModule.forRoot(...)` and `forRootAsync(...)` registrations provide and export it. It delegates to `PrismaService.requestTransaction(...)` and forwards the request `AbortSignal`.

```typescript
import { Inject } from '@fluojs/core';
import { Controller, Post, UseInterceptors } from '@fluojs/http';
import { PrismaTransactionInterceptor } from '@fluojs/prisma';
import { OrdersService } from './orders.service';

@Controller('/orders')
@Inject(OrdersService)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post('/')
  @UseInterceptors(PrismaTransactionInterceptor)
  createOrder() {
    return this.orders.create();
  }
}
```

Prefer service-layer `@Transaction()` for new business operations. Use explicit `requestTransaction(...)` when a complete request truly needs one transaction or named/multiple Prisma registrations must select a specific service; the compatibility interceptor targets only the unnamed default registration.

When request-wide atomicity is genuinely required, make the boundary and cancellation input visible in application code:

```typescript
import { Inject } from '@fluojs/core';
import { Controller, Post, type RequestContext } from '@fluojs/http';
import { PrismaService } from '@fluojs/prisma';
import { PrismaClient } from '@prisma/client';

@Inject(PrismaService, OrdersService)
@Controller('/orders')
export class OrdersController {
  constructor(
    private readonly prisma: PrismaService<PrismaClient>,
    private readonly orders: OrdersService,
  ) {}

  @Post('/checkout')
  checkout(input: CheckoutInput, context: RequestContext) {
    const { request } = context;
    return this.prisma.requestTransaction(
      () => this.orders.checkout(input),
      request.signal,
    );
  }
}
```

This is a narrow compatibility pattern, not a replacement for service `@Transaction()`. A request-wide transaction can hold database locks for the entire HTTP operation, so keep the boundary short and explicit.

### Named Registrations for Multiple Clients

When one application container needs more than one Prisma client, register each client with an explicit `name` and inject the matching token with `getPrismaServiceToken(name)`. For named clients, pass an accessor to `@Transaction()` to target the correct service. Default `@Transaction()` resolution only selects Prisma service/facade-shaped properties; transaction-like objects from other persistence integrations are ignored so ambiguous hosts must use an explicit accessor.

```typescript
import { Inject } from '@fluojs/core';
import { PrismaModule, PrismaService, getPrismaServiceToken, Transaction, type PrismaServiceFacade } from '@fluojs/prisma';

const usersPrismaModule = PrismaModule.forRoot({ name: 'users', client: usersPrisma });
const analyticsPrismaModule = PrismaModule.forRoot({ name: 'analytics', client: analyticsPrisma });

@Inject(getPrismaServiceToken('users'), getPrismaServiceToken('analytics'))
export class MultiDatabaseService {
  constructor(
    private readonly users: PrismaServiceFacade<typeof usersPrisma>,
    private readonly analytics: PrismaServiceFacade<typeof analyticsPrisma>,
  ) {}

  @Transaction((self) => self.users)
  async updateAndLog(userId: string, data: any) {
    const user = await this.users.user.update({ where: { id: userId }, data });
    // This call is outside the 'users' transaction unless 'analytics' also opens one
    await this.analytics.report.create({ data: { event: 'update', userId } });
    return user;
  }
}
```


### Manual Transactions and current()

The `PrismaService` provides a `current()` method that returns the active transaction client if inside a transaction scope, or the root client otherwise. Use this as an escape hatch when you need to pass the client to external libraries or perform advanced manual transaction plumbing.

```typescript
import { Inject } from '@fluojs/core';
import { PrismaService } from '@fluojs/prisma';
import { PrismaClient } from '@prisma/client';

@Inject(PrismaService)
export class AdvancedRepository {
  constructor(private readonly prisma: PrismaService<PrismaClient>) {}

  async customOperation() {
    const tx = this.prisma.current();
    // Use tx for operations that fluo doesn't automatically wrap, 
    // or when passing to an external utility that expects a PrismaClient.
    return tx.user.findMany();
  }
}
```

Use `prisma.transaction()` for manual interactive transaction blocks:

```typescript
await this.prisma.transaction(async () => {
  const tx = this.prisma.current();
  const user = await tx.user.create({ data });
  await tx.profile.create({ data: { userId: user.id } });
});
```

When `transaction()` is called while a transaction context is already active, `PrismaService` reuses the active transaction client instead of opening a nested Prisma transaction. Nested calls must not pass native transaction options such as isolation levels; providing native options in an active context is rejected so the package does not silently drop caller intent while reusing the ambient transaction. `requireAfterCommit` in the separate `boundary` is a capability requirement on the current boundary, not a native option.

### Choosing Rollback from a Result

First register native rollback confirmation. Include the module returned by this complete helper in application imports. A `forRootAsync` factory can return the same `rollbackObserver`; directly constructed wrappers/facades accept it in their existing runtime-options object too. It is not a native driver option.

```ts
import { createPrismaRollbackObserver, PrismaModule } from '@fluojs/prisma';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

export function resultTransactions(databaseUrl: string) {
  const observed = createPrismaRollbackObserver(new PrismaPg({ connectionString: databaseUrl }));
  return PrismaModule.forRoot({
    client: new PrismaClient({ adapter: observed.adapter }),
    rollbackObserver: observed.rollbackObserver,
  });
}
```

Use the `shouldRollback` example below with this configuration. Existing wrappers without an observer still support ordinary transactions, but Result opt-in rejects before callbacks.


`shouldRollback` is an opt-in synchronous predicate for a callback's normal return value. The following complete consumer helper accepts a registered `PrismaService<PrismaClient>`. `persist` is an application callback that performs DB work through that same wrapper's `current()` or facade; `Result` is also application-owned. Fluo neither recognizes this shape automatically nor provides a global `Result`.

```ts
import type { PrismaClient } from '@prisma/client';
import type { PrismaService, TransactionBoundaryOptions } from '@fluojs/prisma';

type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

export function persistWithResult<T>(
  prisma: PrismaService<PrismaClient>,
  persist: () => Promise<Result<T>>,
): Promise<Result<T>> {
  const boundary: TransactionBoundaryOptions<Result<T>> = {
    shouldRollback: (value) => !value.ok,
  };
  return prisma.transaction(persist, undefined, boundary);
}
```

`undefined` preserves the native-options position. Request boundaries use `requestTransaction(fn, signal?, nativeOptions?, boundary?)` and decorators use `@Transaction(input?, boundary?)`, for example `@Transaction(undefined, { shouldRollback: (value: Result<string>) => !value.ok })`. Do not merge this into native options; nested native options remain prohibited.

Returning `{ ok: false, error: 'CONFLICT' }` at the root returns the **same object** after native rollback and required cleanup succeed. Without the option, the value alone does not trigger rollback. A nested predicate selecting failure returns the nested call's original value but marks the shared owner sticky rollback-only. If the root predicate also rejects its own result, that root value is returned; otherwise, `TransactionRollbackOnlyError` is thrown after rollback with the first nested failure in `readonly result: unknown`.

`TransactionRollbackCapabilityError` occurs before the callback on a fallback or legacy target that cannot own rollback. Both errors are root exports of `@fluojs/prisma`; distinguish them with `instanceof`. Native commit, rollback, and cleanup errors propagate rather than becoming domain results. Do not confuse them with `AfterCommitError`, which follows an already-completed commit.

Rollback discards all hooks. An ordinary caught nested exception does not mark rollback-only, so a final commit retains existing writes and hooks. Native callback retries receive fresh owners. External raw transactions and Redis `MULTI/EXEC` are unsupported; this adds no savepoint or durability guarantee. Follow the [shared-owner contract](../../docs/architecture/transactions.md#result-based-rollback) for complete nesting, retry, and failure rules.

Result rollback also requires a registered `rollbackObserver` backed by native evidence. A sentinel or local session state is not proof of rollback. Missing capability rejects before the callback; missing or failed confirmation rejects with a native error or `TransactionRollbackUnconfirmedError`, never a normal Result. The shared contract above specifies registration helpers and supported configurations.

### Cache Invalidation After Commit

`PrismaService.afterCommit(...)` registers work on an open native transaction owned by the same wrapper. This application function assumes an existing Prisma `User` model (`id`, `name`), a registered `PrismaService<PrismaClient>`, and `CacheService` from a registered `CacheModule`.

```ts
import type { PrismaClient } from '@prisma/client';
import type { CacheService } from '@fluojs/cache-manager';
import { PrismaService } from '@fluojs/prisma';

async function renameUser(
  prisma: PrismaService<PrismaClient>,
  cache: CacheService,
  id: string,
  name: string,
) {
  return prisma.transaction(async () => {
    const user = await prisma.current().user.update({ where: { id }, data: { name } });
    prisma.afterCommit(async () => {
      await cache.del(`user:${id}`);
    });
    return user;
  }, undefined, { requireAfterCommit: true });
}
```

`undefined` preserves the existing native-options position. `requireAfterCommit: true` checks native commit observation capability before the user callback and rejects with `AfterCommitCapabilityError` when it is unavailable. Omitting it or passing `false` preserves existing `strictTransactions` defaults and fail-open fallback, but hooks cannot be registered in a fallback without a native transaction. Use `@Transaction(undefined, { requireAfterCommit: true })`, or supply an explicit accessor as the first argument, to declare the same requirement.

Hooks run sequentially in FIFO order only after successful outer native commit and scope closure, outside the ended ALS context. They do not run on rollback, failed commit, or discarded callback attempts. Nested boundaries share the queue, so a caught nested exception without a savepoint follows the final outer commit/rollback outcome. Root reads in hooks do not use the old transaction handle, and new transactions own fresh queues. Registration outside a scope, in a closed scope, or late during drain is rejected. Shutdown drains hooks before disconnecting.

If a hook fails, all remaining hooks still run before `AfterCommitError` is thrown. The database is already committed: do not retry the original write. The following error-handling fragment calls the function above; `report` and cache recovery policy are application-owned.

```ts
import { AfterCommitError } from '@fluojs/prisma';

try {
  await renameUser(prisma, cache, id, name);
} catch (error) {
  if (error instanceof AfterCommitError) {
    report({ committed: error.committed, results: error.results, errors: error.errors });
  }
  throw error;
}
```

`results` contains every fulfilled and rejected outcome in registration order; `errors` contains all failure reasons. Hook failures do not trigger native transaction retry or rollback. Commits from external raw-client transactions, other wrappers, or other connections are not observed. Redis itself is unsupported, and calling Redis from a DB hook does not create DB+Redis atomicity. This covers successful in-process owner invocations, not crash/network exactly-once or a durable outbox. Follow the [Transaction Context Contract](../../docs/architecture/transactions.md#after-commit-work) for the complete ordering and limitations.

### Shutdown and Status Contracts

`PrismaService.requestTransaction(...)` is available before and during normal serving, but new request-scoped transactions are rejected once application shutdown has started. New outer manual `transaction(...)` and service `@Transaction()` boundaries are also rejected after shutdown begins; boundaries that were already open are drained before `$disconnect()` so shutdown does not race an active Prisma transaction. Shutdown also waits for an in-flight `$connect()` to settle before `$disconnect()`; once shutdown starts, a late connect completion cannot restore ready state or admit new transaction work. During shutdown, open request transactions are aborted, tracked until their outer transaction boundary has settled, and drained before `$disconnect()` runs. This includes nested `requestTransaction(...)` calls opened inside an existing manual `transaction(...)` boundary: they reuse the ambient Prisma transaction client, stay visible in `details.activeRequestTransactions` until the outer boundary finishes, and do not open a second Prisma transaction.

`createPrismaPlatformStatusSnapshot(...)` and `PrismaService.createPlatformStatusSnapshot()` expose the same lifecycle contract to diagnostics surfaces:

- `readiness.status` is `not-ready` before `onModuleInit()` connects the client, while Prisma is shutting down or stopped, when `strictTransactions` is enabled without `$transaction(...)` support, and when the host runtime does not provide `AsyncLocalStorage` while the client supports interactive transactions. In the ALS-unavailable case the readiness reason is `Prisma transaction context requires AsyncLocalStorage support from the host runtime.` and `details.transactionContext` reports `unavailable`; this state is distinct from an ordinary database readiness failure because the Prisma client itself may be connected and otherwise functional.
- `health.status` is `degraded` while open request, manual, or service transaction boundaries are draining during shutdown and `unhealthy` after disconnect.
- `details.activeRequestTransactions`, `details.activeTransactionBoundaries`, `details.lifecycleState`, `details.strictTransactions`, `details.supportsTransaction`, and `details.transactionAbortSignalSupport` describe the current transaction and transaction-capability state.
- `details.activeTransactionBoundaries` counts currently open outer `transaction(...)` and service `@Transaction()` boundaries that shutdown drains before `$disconnect()`. It excludes request-only `requestTransaction(...)` activity, which remains visible separately through `details.activeRequestTransactions`.
- `details.transactionContext: 'als'` identifies the async-local transaction context used by request and service transaction boundaries. `details.transactionContext: 'unavailable'` indicates the host runtime did not expose a usable `AsyncLocalStorage`, so `transaction()` and `requestTransaction()` reject before opening a Prisma transaction.
- `ownership.externallyManaged: false` and `ownership.ownsResources: true` mean the package owns the registered client's `$connect()` / `$disconnect()` lifecycle hooks inside the fluo application lifecycle.

When `details.transactionContext` is `unavailable`, the package does not fall back to a synchronous stack-based context because that would lose `current()` across async boundaries. The application owns the fallback boundary: callers that still need database access without a transaction context must invoke the raw `PrismaClient` directly (for example through the `PRISMA_CLIENT` token) and manage their own consistency semantics, or run on a host runtime that provides `AsyncLocalStorage` (Node.js `>=24.0.0 <27` is the documented path). Treat the `unavailable` readiness state as operationally actionable — surface it in health checks and route traffic away from transaction-dependent handlers until the host provides ALS or the application switches to a non-transactional access path.

### Async Configuration and Isolation

Use `PrismaModule.forRootAsync(...)` when the Prisma client must be created from injected configuration or another async source. The async factory is resolved once per application container and is not shared across separate bootstraps, even when the same module definition is reused in tests or multi-app processes.

```typescript
import { PrismaClient } from '@prisma/client';
import { PrismaModule } from '@fluojs/prisma';

PrismaModule.forRootAsync({
  inject: [DatabaseConfig],
  useFactory: (config: DatabaseConfig) => ({
    client: new PrismaClient({ datasources: { db: { url: config.url } } }),
    strictTransactions: true,
  }),
});
```

Within one compiled application, downstream providers share the same resolved `PrismaService`, ALS transaction context, and lifecycle-managed client. Separate application containers receive independent factory results, so `$connect` / `$disconnect` ownership and request transaction state remain isolated.

Transaction boundaries require host-provided `AsyncLocalStorage` support. The package manifest declares `engines.node >=24.0.0 <27`, and the root wrapper is the documented Node.js `>=24.0.0 <27` Prisma integration path. `@fluojs/prisma` resolves ALS through `globalThis.AsyncLocalStorage` when a runtime exposes one, or through the host's `process.getBuiltinModule('node:async_hooks')` boundary on Node.js. If neither path is available or the host builtin lookup fails, `transaction()` and `requestTransaction()` reject before opening a Prisma transaction instead of using a synchronous stack fallback that would lose `current()` across async boundaries; `createPlatformStatusSnapshot().details.transactionContext` reports `unavailable` in that state.

### Manual Module Composition

Use `PrismaModule.forRoot(...)` / `forRootAsync(...)` to register Prisma. When you need to compose Prisma support inside a custom `defineModule(...)` registration, import the module entrypoint there as well.

```typescript
import { defineModule } from '@fluojs/runtime';
import { PrismaModule } from '@fluojs/prisma';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

class ManualPrismaModule {}

defineModule(ManualPrismaModule, {
  imports: [PrismaModule.forRoot({ client: prisma })],
});
```

## Public API Overview

### `PrismaModule`

- `PrismaModule.forRoot(options)` / `PrismaModule.forRootAsync(options)`
- `forRoot(...)` and `forRootAsync(...)` also accept `name` for named/scoped registrations, and `global?: boolean` for unnamed registrations that should export their providers globally.
- `forRootAsync(...)` accepts DI-aware Prisma options whose factory returns the client and transaction settings; pass `name` or `global` on the top-level async registration so module identity and visibility are decided before the factory runs.
- `forRootAsync(...)` resolves options once per application container, preserving client lifecycle and request transaction isolation across separate bootstraps.
- Supports `strictTransactions: true` to throw if transaction support is missing.
- When `strictTransactions` is `false`, PrismaService falls back to direct execution if the client does not expose interactive `$transaction`.
- `client` must be a concrete object/function handle for both sync and async registration; missing handles are rejected during module registration or async bootstrap.
- Names are trimmed for named registrations, and blank names are rejected before public tokens are created.

### `PrismaService<TClient>`

- `current(): TClient | PrismaTransactionClient<TClient>`
  - Returns the ambient transaction client or the root client.
- `transaction(fn, nativeOptions?, boundary?): Promise<T>`
  - Runs a function within an interactive transaction. If a transaction context is already active, the callback reuses that context; nested native transaction options are rejected because no new Prisma transaction boundary is opened. New outer transaction boundaries are rejected once shutdown starts.
- `requestTransaction(fn, signal?, nativeOptions?, boundary?): Promise<T>`
  - Specialized transaction boundary for HTTP request lifecycles. It is abort-aware, drains during shutdown before disconnect, and retries without `signal` when a Prisma client rejects that option. Like `transaction()`, nested calls reuse the active transaction context and reject nested native options to avoid silently ignoring transaction settings.

Use `PrismaService<TClient>` when a provider only needs wrapper methods such as `current()`, `transaction(...)`, `requestTransaction(...)`, or `createPlatformStatusSnapshot()`. Use `PrismaServiceFacade<TClient>` for repository injections that call generated Prisma Client delegates directly; the facade forwards those calls to the active transaction client when one exists and to the root client otherwise. `PrismaService.createFacade(...)` is retained as a low-level compatibility helper for module-provider wiring; application code should prefer `PrismaModule.forRoot(...)` / `forRootAsync(...)`.

`boundary?: TransactionBoundaryOptions<T>` is a Fluo-only option **after** the existing arguments; do not merge it into Prisma native options. `fn` remains the existing async callback. The commit path returns its original `T` after registered-hook drain; the opt-in rollback path follows the return and error rules in [Choosing Rollback from a Result](#choosing-rollback-from-a-result).

- `afterCommit(callback: AfterCommitCallback): void`
  - Registers a callback in an open native transaction scope without executing it immediately. Unsupported boundaries, no native transaction, missing scope, and closed scopes reject registration.

### `Transaction`

- `Transaction(input?, boundary?)`: `input` remains the existing service accessor or Prisma native transaction options. `boundary` is the second argument; omitting it preserves existing behavior.

- Standard TC39 method decorator for service-layer transaction boundaries. It resolves a Prisma service/facade-shaped property by default, accepts an accessor for named clients or ambiguous hosts, and can forward Prisma transaction options to the outer boundary.

### After-Commit Exports

Import all of these from the root `@fluojs/prisma` package.

- `AfterCommitCallback`: `() => void | Promise<void>`.
- `TransactionBoundaryOptions<T = unknown>`: `{ readonly requireAfterCommit?: boolean; readonly shouldRollback?: (value: T) => boolean }`.
- `createPrismaRollbackObserver(...)`: the public native observation helper above.
- `TransactionRollbackObserver`: advanced capability contract whose `run<T>(callback): Promise<T>` opens an owner observation scope and whose `beginAttempt(transaction)` binds a native attempt.
- `TransactionRollbackObservation`: `confirmRollback(): true | Promise<true>` returns only independently confirmed rollback success and reports failure/uncertainty by throwing. Do not implement it using sentinel identity or a no-op.
- `TransactionRollbackUnconfirmedError`: positive native rollback confirmation is absent, so a normal Result cannot be returned.
- `TransactionRollbackCapabilityError`: raised before the callback on a boundary that cannot support opt-in rollback.
- `TransactionRollbackOnlyError`: raised when an owner marked rollback-only by a nested opt-in failure cannot return a root failure value; `readonly result: unknown` contains the first nested failure value.
- `AfterCommitCapabilityError`: failure when required native commit capability is missing or a hook is registered on an unsupported boundary.
- `AfterCommitError extends AggregateError`: exposes `readonly committed = true` and `results: readonly PromiseSettledResult<void>[]` for every FIFO outcome, with all failures in inherited `errors`.

### `PrismaTransactionInterceptor` (deprecated compatibility)

- Request-wide HTTP compatibility interceptor for existing 1.x imports.
- Delegates to `PrismaService.requestTransaction(...)` and forwards request cancellation.
- Prefer service `@Transaction()` or an explicit request boundary in new code.

### `PRISMA_CLIENT` (Token)

Injectable token for the raw `PrismaClient` instance.

### `PRISMA_OPTIONS` (Token)

Injectable token for the public runtime options consumed by `PrismaService`, currently `{ strictTransactions: boolean }`.
This is intentionally narrower than the package's internal normalized module-options token, which also carries registration
identity, client ownership, and visibility metadata and is not part of the public API.

### Platform status

- `createPrismaPlatformStatusSnapshot(input)`: Creates a persistence platform status snapshot that reports Prisma readiness, health, ownership, and ALS-backed transaction context.

### Named Prisma token helpers

- `getPrismaClientToken(name?)`
- `getPrismaOptionsToken(name?)`
- `getPrismaServiceToken(name?)`

These helpers return the default unnamed token when `name` is omitted and a registration-specific token when `name` is provided.
They are the public way to target named registrations; internal implementation tokens such as the normalized module-options
token are deliberately not exported.

### Related exported types

- `PrismaAsyncModuleOptions<TClient, TTransactionClient, TTransactionOptions>`
- `PrismaModuleOptions`
- `PrismaClientLike`
- `PrismaHandleProvider`
- `PrismaServiceFacade<TClient>`
- `PrismaTransactionClient<TClient>`
- `InferPrismaTransactionClient<TClient>`
- `InferPrismaTransactionOptions<TClient>`
- `PrismaPlatformStatusSnapshotInput`
  - The input contract for `createPrismaPlatformStatusSnapshot(...)`; omit `activeTransactionBoundaries` when no outer service or manual transaction boundary is open and the snapshot reports `0`.

## Related Packages

- `@fluojs/runtime`: Manages the application lifecycle hooks.
- `@fluojs/http`: Provides request lifecycle primitives that can be paired with explicit `requestTransaction(...)` boundaries.
- `@fluojs/terminus`: Provides a health indicator for Prisma.

## Example Sources

- `packages/prisma/src/after-commit.test.ts`: after-commit contract verification target. Native boundaries are covered by `packages/prisma/fixtures/after-commit/` and common behavior by `tooling/governance/after-commit-contract.test.ts`; execution results require a separate verification receipt.

- `packages/prisma/src/vertical-slice.test.ts`: DTO → Service → Repository → Prisma flow.
- `packages/prisma/src/module.test.ts`: Module lifecycle, named clients, async factories, strict transaction behavior, and status snapshots.
