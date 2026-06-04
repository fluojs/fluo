# @fluojs/prisma

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Prisma lifecycle and ALS-backed transaction context for fluo applications. Connects a `PrismaClient` to the module system with automatic connection management and request-scoped transactions.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
  - [Service Transaction Boundary (@Transaction)](#service-transaction-boundary-transaction)
  - [Named Registrations for Multiple Clients](#named-registrations-for-multiple-clients)
  - [Manual Transactions and current()](#manual-transactions-and-current)
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

- When using Prisma as your ORM and you want it integrated with fluo's dependency injection and lifecycle hooks.
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

export class UserService {
  constructor(private readonly repo: UserRepository) {}

  @Transaction()
  async onboardUser(dto: CreateUserDto) {
    const user = await this.repo.create(dto);
    await this.repo.initProfile(user.id);
    return user;
  }
}

@Inject(PrismaService)
export class UserRepository {
  constructor(private readonly prisma: PrismaServiceFacade<PrismaClient>) {}

  async create(data: any) {
    // The facade type exposes standard PrismaClient delegates.
    // When called inside @Transaction(), they automatically participate in the ambient transaction.
    return this.prisma.user.create({ data });
  }

  async initProfile(userId: string) {
    return this.prisma.profile.create({ data: { userId } });
  }
}
```

Calls to `@Transaction()` methods are reentrant. If a decorated method calls another decorated method, they share the same underlying Prisma transaction.

### Named Registrations for Multiple Clients

When one application container needs more than one Prisma client, register each client with an explicit `name` and inject the matching token with `getPrismaServiceToken(name)`. For named clients, pass an accessor to `@Transaction()` to target the correct service.

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

When `transaction()` is called while a transaction context is already active, `PrismaService` reuses the active transaction client instead of opening a nested Prisma transaction. Nested calls must not pass transaction options such as isolation levels; providing options in an active context is rejected so the package does not silently drop caller intent while reusing the ambient transaction.

### Shutdown and Status Contracts

`PrismaService.requestTransaction(...)` is available before and during normal serving, but new request-scoped transactions are rejected once application shutdown has started. During shutdown, open request transactions are aborted, tracked until their outer transaction boundary has settled, and drained before `$disconnect()` runs. This includes nested `requestTransaction(...)` calls opened inside an existing manual `transaction(...)` boundary: they reuse the ambient Prisma transaction client, stay visible in `details.activeRequestTransactions` until the outer boundary finishes, and do not open a second Prisma transaction.

`createPrismaPlatformStatusSnapshot(...)` and `PrismaService.createPlatformStatusSnapshot()` expose the same lifecycle contract to diagnostics surfaces:

- `readiness.status` is `not-ready` before `onModuleInit()` connects the client, while Prisma is shutting down or stopped, and when `strictTransactions` is enabled without `$transaction(...)` support.
- `health.status` is `degraded` while request transactions are draining during shutdown and `unhealthy` after disconnect.
- `details.activeRequestTransactions`, `details.lifecycleState`, `details.strictTransactions`, `details.supportsTransaction`, and `details.transactionAbortSignalSupport` describe the current request transaction and transaction-capability state.
- `details.transactionContext: 'als'` identifies the async-local transaction context used by request and service transaction boundaries.
- `ownership.externallyManaged: false` and `ownership.ownsResources: true` mean the package owns the registered client's `$connect()` / `$disconnect()` lifecycle hooks inside the fluo application lifecycle.

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

Transaction boundaries require host-provided `AsyncLocalStorage` support. `@fluojs/prisma` resolves it through `globalThis.AsyncLocalStorage` when a runtime exposes one, or through the host's `process.getBuiltinModule('node:async_hooks')` boundary on Node.js. If neither path is available, `transaction()` and `requestTransaction()` reject before opening a Prisma transaction instead of using a synchronous stack fallback that would lose `current()` across async boundaries; `createPlatformStatusSnapshot().details.transactionContext` reports `unavailable` in that state.

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
- `forRoot(...)` and `forRootAsync(...)` also accept `name` for named/scoped registrations.
- `forRootAsync(...)` accepts DI-aware Prisma options whose factory returns the client and transaction settings; pass `name` or `global` on the top-level async registration so module identity and visibility are decided before the factory runs.
- `forRootAsync(...)` resolves options once per application container, preserving client lifecycle and request transaction isolation across separate bootstraps.
- Supports `strictTransactions: true` to throw if transaction support is missing.
- When `strictTransactions` is `false`, PrismaService falls back to direct execution if the client does not expose interactive `$transaction`.
- `client` must be a concrete object/function handle for both sync and async registration; missing handles are rejected during module registration or async bootstrap.
- Names are trimmed for named registrations, and blank names are rejected before public tokens are created.

### `PrismaService<TClient>`

- `current(): TClient | PrismaTransactionClient<TClient>`
  - Returns the ambient transaction client or the root client.
- `transaction(fn, options?): Promise<T>`
  - Runs a function within an interactive transaction. If a transaction context is already active, the callback reuses that context; nested transaction options are rejected because no new Prisma transaction boundary is opened.
- `requestTransaction(fn, signal?, options?): Promise<T>`
  - Specialized transaction boundary for HTTP request lifecycles. It is abort-aware, drains during shutdown before disconnect, and retries without `signal` when a Prisma client rejects that option. Like `transaction()`, nested calls reuse the active transaction context and reject nested options to avoid silently ignoring transaction settings.

Use `PrismaService<TClient>` when a provider only needs wrapper methods such as `current()`, `transaction(...)`, `requestTransaction(...)`, or `createPlatformStatusSnapshot()`. Use `PrismaServiceFacade<TClient>` for repository injections that call generated Prisma Client delegates directly; the facade forwards those calls to the active transaction client when one exists and to the root client otherwise. `PrismaService.createFacade(...)` is retained as a low-level compatibility helper for module-provider wiring; application code should prefer `PrismaModule.forRoot(...)` / `forRootAsync(...)`.

### `Transaction`

- Standard TC39 method decorator for service-layer transaction boundaries. It resolves the ambient `PrismaService` by default, accepts an accessor for named clients, and can forward Prisma transaction options to the outer boundary.

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

- `PrismaModuleOptions`
- `PrismaClientLike`
- `PrismaHandleProvider`
- `PrismaServiceFacade<TClient>`
- `PrismaTransactionClient<TClient>`
- `InferPrismaTransactionClient<TClient>`
- `InferPrismaTransactionOptions<TClient>`

## Related Packages

- `@fluojs/runtime`: Manages the application lifecycle hooks.
- `@fluojs/http`: Provides request lifecycle primitives that can be paired with explicit `requestTransaction(...)` boundaries.
- `@fluojs/terminus`: Provides a health indicator for Prisma.

## Example Sources

- `packages/prisma/src/vertical-slice.test.ts`: DTO → Service → Repository → Prisma flow.
- `packages/prisma/src/module.test.ts`: Module lifecycle, named clients, async factories, strict transaction behavior, and status snapshots.
