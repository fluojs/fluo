# @konekti/prisma

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>


Connect Prisma to the Konekti lifecycle and transaction model — without hiding Prisma itself.

## See also

- `../../docs/concepts/transactions.md`
- `../../docs/concepts/lifecycle-and-shutdown.md`

## What this package does

`@konekti/prisma` is a thin integration layer that wires a Prisma client into Konekti's module system. It handles connection lifecycle (`$connect` / `$disconnect`) automatically, provides a request-scoped ALS-based transaction context, and exposes a `PrismaService` whose `current()` method always returns either the active transaction client or the root client — so your repositories never need to care which they're talking to.

The package does **not** abstract Prisma away. It makes Prisma a first-class Konekti citizen.

## Installation

```bash
npm install @konekti/prisma
# install your generated Prisma client alongside this package
npm install @prisma/client
```

## Quick Start

### 1. Register the module

```typescript
import { createPrismaModule } from '@konekti/prisma';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// In your root module definition:
const AppModule = createPrismaModule({ client: prisma });
```

### 2. Use `PrismaService` in a repository

```typescript
import { PrismaClient } from '@prisma/client';
import { Inject } from '@konekti/core';
import { PrismaService } from '@konekti/prisma';

@Inject([PrismaService])
export class UserRepository {
  constructor(
    private readonly prisma: PrismaService<PrismaClient>
  ) {}

  async findById(id: string) {
    // current() returns the active tx client if inside a transaction,
    // otherwise returns the root PrismaClient
    return this.prisma.current().user.findUnique({ where: { id } });
  }
}
```

### 3. Wrap a service method in a transaction

```typescript
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '@konekti/prisma';

export class UserService {
  constructor(private readonly prisma: PrismaService<PrismaClient>) {}

  async createWithProfile(data: CreateUserDto) {
    return this.prisma.transaction(async () => {
      const user = await this.prisma.current().user.create({ data });
      await this.prisma.current().profile.create({
        data: { userId: user.id },
      });
      return user;
    });
  }
}
```

### 4. Apply the interceptor for automatic request-level transactions

```typescript
import { UseInterceptors } from '@konekti/http';
import { PrismaTransactionInterceptor } from '@konekti/prisma';

@UseInterceptors(PrismaTransactionInterceptor)
class UserController {}
```

## Key API

### `PrismaService<TClient>`

| Method | Signature | Description |
|---|---|---|
| `current()` | `() => TClient \| TTransactionClient` | Returns the active transaction client (from ALS), or the root client if no transaction is open |
| `transaction()` | `(fn: () => Promise<T>) => Promise<T>` | Runs `fn` inside a Prisma interactive transaction; stores the tx client in ALS |
| `requestTransaction()` | `(fn: () => Promise<T>, signal?: AbortSignal) => Promise<T>` | Like `transaction()`, intended for use by interceptors at the request boundary |

### `PRISMA_CLIENT`

DI token (`src/tokens.ts`) used to inject the raw `PrismaClient` instance when you need it directly.

```typescript
import { Inject } from '@konekti/core';
import { PRISMA_CLIENT } from '@konekti/prisma';

@Inject([PRISMA_CLIENT])
class RawClientConsumer {
  constructor(private readonly client: PrismaClient) {}
}
```

### `createPrismaProviders(options)`

Returns DI provider array. Use this when composing providers manually instead of using `createPrismaModule`.

```typescript
import { createPrismaProviders } from '@konekti/prisma';

const providers = createPrismaProviders({ client: prisma });
```

### `createPrismaModule(options)`

Convenience wrapper that calls `createPrismaProviders` and wraps the result in a Konekti module definition.

`PrismaModuleOptions` also supports `strictTransactions?: boolean`, and the public package exports `PRISMA_OPTIONS`, `PrismaTransactionClient`, `PrismaModuleOptions`, and `PrismaHandleProvider`.

### `PrismaTransactionInterceptor`

HTTP interceptor (`src/transaction.ts`) that wraps each request in `prismaService.requestTransaction()`. Every handler and repository called within the request shares the same Prisma transaction client automatically.

### `PrismaClientLike`

Seam interface that `PrismaService` is generic over. Requires only `$connect`, `$disconnect`, and `$transaction` — allows testing with a minimal stub instead of a full `PrismaClient`.

```typescript
interface PrismaClientLike {
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
  $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}
```

## Architecture

```
HTTP Request
    │
    ▼
PrismaTransactionInterceptor
    │  opens requestTransaction()
    ▼
AsyncLocalStorage (ALS)
    │  stores tx client for request scope
    ▼
PrismaService.current()
    │  reads ALS → returns tx client (or root client)
    ▼
Repository / Handler
    │  calls prisma.current().model.operation()
    ▼
Prisma Client
```

**Lifecycle hooks:**
- `OnModuleInit` → `$connect()` — called when the Konekti module initializes
- `OnApplicationShutdown` → `$disconnect()` — called on graceful shutdown

## File Reading Order (for contributors)

Start here to understand the full package in ~15 minutes:

1. `src/tokens.ts` — single `PRISMA_CLIENT` token; understand how DI injection is keyed
2. `src/types.ts` — `PrismaClientLike` seam; shows the minimum contract required
3. `src/service.ts` — `PrismaService`: `current()`, `transaction()`, `requestTransaction()`, ALS usage
4. `src/transaction.ts` — `PrismaTransactionInterceptor`: the request boundary that opens transactions
5. `src/module.ts` — `createPrismaProviders()` and `createPrismaModule()`: how everything wires together
6. `src/vertical-slice.test.ts` — integration test: DTO → validation → service → repository → Prisma path; the canonical 201 / 400 / 404 contract

## Related packages

| Package | Relationship |
|---|---|
| `@konekti/runtime` | Lifecycle hooks (`OnModuleInit`, `OnApplicationShutdown`) that `PrismaService` implements |
| `@konekti/di` | DI container that resolves `PrismaService` and `PRISMA_CLIENT` |
| `@konekti/http` | Interceptor system that `PrismaTransactionInterceptor` hooks into |
| `@konekti/testing` | Use `overrideProvider(PRISMA_CLIENT, fakePrisma)` to inject a test double |
| `@konekti/dto-validator` | Validates request DTOs before they reach the service layer in the vertical slice |

## One-liner mental model

> `@konekti/prisma` plugs Prisma into Konekti's lifecycle and ALS-based transaction model — `current()` always gives you the right client, whether you're inside a request transaction or not.
