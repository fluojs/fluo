# @fluojs/prisma

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Prisma lifecycle and ALS-backed transaction context for fluo applications. Connects a `PrismaClient` to the module system with automatic connection management and request-scoped transactions.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
  - [PrismaService and current()](#prismaservice-and-current)
  - [Named Registrations for Multiple Clients](#named-registrations-for-multiple-clients)
  - [Manual Transactions](#manual-transactions)
  - [Automatic Request Transactions](#automatic-request-transactions)
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

### PrismaService and current()

The `PrismaService` is the primary way to interact with Prisma. Its `current()` method automatically returns the active transaction client if inside a transaction scope, or the root client otherwise.

```typescript
import { Inject } from '@fluojs/core';
import { PrismaService } from '@fluojs/prisma';
import { PrismaClient } from '@prisma/client';

@Inject(PrismaService)
export class UserRepository {
  constructor(private readonly prisma: PrismaService<PrismaClient>) {}

  async findById(id: string) {
    // current() preserves your generated Prisma types and autocomplete
    return this.prisma.current().user.findUnique({ where: { id } });
  }
}
```

### Named Registrations for Multiple Clients

When one application container needs more than one Prisma client, register each client with an explicit `name` and inject the matching token with `getPrismaServiceToken(name)`.

```typescript
import { Inject } from '@fluojs/core';
import { PrismaModule, PrismaService, getPrismaServiceToken } from '@fluojs/prisma';

const usersPrismaModule = PrismaModule.forName('users', { client: usersPrisma });
const analyticsPrismaModule = PrismaModule.forRoot({ name: 'analytics', client: analyticsPrisma });

@Inject(getPrismaServiceToken('users'), getPrismaServiceToken('analytics'))
export class MultiDatabaseService {
  constructor(
    private readonly users: PrismaService<typeof usersPrisma>,
    private readonly analytics: PrismaService<typeof analyticsPrisma>,
  ) {}

  async loadDashboard(userId: string) {
    const user = await this.users.current().user.findUnique({ where: { id: userId } });
    const summary = await this.analytics.current().report.findMany();
    return { summary, user };
  }
}
```

Unnamed registration remains the default single-client path for `PrismaService`, `PRISMA_CLIENT`, `PRISMA_OPTIONS`, and `PrismaTransactionInterceptor`. When you register multiple Prisma clients in the same container, use names for every additional client so token resolution stays explicit.

### Manual Transactions

Use `prisma.transaction()` to create an interactive transaction block. Any calls to `current()` inside the block will use the transaction-scoped client.

```typescript
await this.prisma.transaction(async () => {
  const user = await this.prisma.current().user.create({ data });
  await this.prisma.current().profile.create({ data: { userId: user.id } });
});
```

### Automatic Request Transactions

Apply the `PrismaTransactionInterceptor` to a controller or method to wrap the entire request in a transaction automatically.

```typescript
import { Post, UseInterceptors } from '@fluojs/http';
import { PrismaTransactionInterceptor } from '@fluojs/prisma';

@UseInterceptors(PrismaTransactionInterceptor)
class UserController {
  @Post()
  async create() {
    // All downstream repository calls via PrismaService.current() share this tx
  }
}
```

`PrismaTransactionInterceptor` targets the default unnamed `PrismaService`. For named multi-client registrations, inject the corresponding named `PrismaService` and open explicit `transaction()` / `requestTransaction()` boundaries where needed.

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

### Manual Module Composition

Use `PrismaModule.forRoot(...)` / `forRootAsync(...)` to register Prisma. When you need to compose Prisma support inside a custom `defineModule(...)` registration, import the module entrypoint there as well.

```typescript
import { defineModule } from '@fluojs/runtime';
import { PrismaModule, PrismaService, PrismaTransactionInterceptor } from '@fluojs/prisma';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

class ManualPrismaModule {}

defineModule(ManualPrismaModule, {
  exports: [PrismaService, PrismaTransactionInterceptor],
  imports: [PrismaModule.forRoot({ client: prisma })],
});
```

## Public API Overview

### `PrismaModule`

- `PrismaModule.forRoot(options)` / `PrismaModule.forRootAsync(options)`
- `PrismaModule.forName(name, options)` / `PrismaModule.forNameAsync(name, options)`
- `forRoot(...)` and `forRootAsync(...)` also accept `name` for named/scoped registrations.
- `forRootAsync(...)` accepts `AsyncModuleOptions<PrismaModuleOptions<...>>`.
- `forRootAsync(...)` resolves options once per application container, preserving client lifecycle and request transaction isolation across separate bootstraps.
- Supports `strictTransactions: true` to throw if transaction support is missing.

### `PrismaService<TClient>`

- `current(): TClient | PrismaTransactionClient<TClient>`
  - Returns the ambient transaction client or the root client.
- `transaction(fn, options?): Promise<T>`
  - Runs a function within an interactive transaction.
- `requestTransaction(fn, signal?, options?): Promise<T>`
  - Specialized transaction boundary for HTTP request lifecycles.

### `PRISMA_CLIENT` (Token)

Injectable token for the raw `PrismaClient` instance.

### Named Prisma token helpers

- `getPrismaClientToken(name?)`
- `getPrismaOptionsToken(name?)`
- `getPrismaServiceToken(name?)`

These helpers return the default unnamed token when `name` is omitted and a registration-specific token when `name` is provided.

### Related exported types

- `PrismaModuleOptions`
- `PrismaTransactionClient<TClient>`
- `InferPrismaTransactionClient<TClient>`
- `InferPrismaTransactionOptions<TClient>`

## Related Packages

- `@fluojs/runtime`: Manages the application lifecycle hooks.
- `@fluojs/http`: Provides the interceptor system.
- `@fluojs/terminus`: Provides a health indicator for Prisma.

## Example Sources

- `packages/prisma/src/vertical-slice.test.ts`: DTO → Service → Repository → Prisma flow.
