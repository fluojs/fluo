# Transaction Context Contract

<p><strong><kbd>English</kbd></strong> <a href="./transactions.ko.md"><kbd>한국어</kbd></a></p>

This document defines the current transaction-context contract across `@fluojs/prisma`, `@fluojs/drizzle`, and `@fluojs/mongoose`.

## Supported Integrations

| Package | Ambient context carrier | Primary access API | Request boundary API | Current support scope |
| --- | --- | --- | --- | --- |
| `@fluojs/prisma` | `AsyncLocalStorage<TTransactionClient>` | `@Transaction()` on Services | Explicit `PrismaService.requestTransaction(...)` | Shares the active Prisma interactive transaction client when `$transaction(...)` is available. |
| `@fluojs/drizzle` | `AsyncLocalStorage<TTransactionDatabase>` | `@Transaction()` on Services | Explicit `DrizzleDatabase.requestTransaction(...)` | Shares the active Drizzle transaction database handle when `database.transaction(...)` is available. |
| `@fluojs/mongoose` | `AsyncLocalStorage<MongooseSessionLike>` | `@Transaction()` on Services | Explicit `MongooseConnection.requestTransaction(...)` | Shares the active Mongoose session when `connection.startSession()` or delegated `connection.transaction(...)` is available. |

## Service Transaction Boundary (Primary)

The canonical way to manage transactions in fluo is through the `@Transaction()` decorator at the Service layer. This defines a clear boundary where persistence work is grouped into a single atomic unit.

```ts
// service (primary boundary)
@Transaction()
async createUser(dto) { 
  // All repository calls here share the same ambient transaction
  return this.repo.create(dto); 
}

// repository (current-less)
async create(dto) { 
  // persistence clients automatically resolve the ambient transaction
  return this.prisma.user.create({ data: dto }); 
}
```

### Future ORM Adapters
Any new ORM integration package added to the fluo ecosystem must export a `@Transaction()` decorator that satisfies this Service-boundary contract.

## Context Resolution Rules

| Rule | Current contract | Source anchor |
| --- | --- | --- |
| Service -> Repository flow | Decorators on services establish the boundary; repositories consume the client without needing to pass sessions or access `current()` explicitly. | `packages/core/src/decorators/transaction.ts` (abstract), `packages/mongoose/src/connection.ts` (auto-session) |
| Root vs ambient handle | Prisma and Drizzle persistence handles resolve the active transaction handle when one exists, otherwise the root client/database. | `packages/prisma/src/service.ts`, `packages/drizzle/src/database.ts` |
| Mongoose session auto-binding | Supported `MongooseConnection.model(...)` facade operations (`create`, `find`, `findOne`, `aggregate`, `bulkWrite`) automatically attach the ambient transaction session. Unsupported model methods, `doc.save()`, raw `conn.current().model(...)` calls, and advanced cross-connection scenarios require explicit session passing. | `packages/mongoose/src/connection.ts` |
| Nested boundary reuse | If a transaction is already active, `@Transaction()` reuses the existing boundary instead of opening a new one. | `packages/prisma/src/service.ts`, `packages/drizzle/src/database.ts`, `packages/mongoose/src/connection.ts` |
| Nested options restriction | Prisma and Drizzle reject nested transaction options while an ambient transaction is already active. | `packages/prisma/src/service.ts`, `packages/drizzle/src/database.ts` |
| Strict mode | Integration packages can be configured to throw when the registered client/connection does not support transactions. Without strict mode, transaction helpers fall back to direct execution. | `packages/prisma/src/service.ts`, `packages/drizzle/src/database.ts`, `packages/mongoose/src/connection.ts` |
| Drizzle decorator target selection | Drizzle `@Transaction()` checks the decorated host for `this.db`, then direct properties, then nested `.db` properties that expose `transaction(...)`, and falls back to the decorated instance itself when none match; use an explicit accessor such as `@Transaction((self) => self.ordersDb)` when more than one target is possible. | `packages/drizzle/src/transaction.ts` |

## Boundary Semantics

| Boundary | Current behavior | Source anchor |
| --- | --- | --- |
| `@Transaction()` boundary | Wraps the method in a package-specific transaction runner and binds the resulting client/session to ALS. | `packages/prisma/src/service.ts`, `packages/drizzle/src/database.ts`, `packages/mongoose/src/connection.ts` |
| Manual Prisma boundary | `PrismaService.transaction(fn, options?)` runs `fn` inside `$transaction(...)` and binds the transaction client into ALS. | `packages/prisma/src/service.ts` |
| Manual Drizzle boundary | `DrizzleDatabase.transaction(fn, options?)` runs `fn` inside `database.transaction(...)` and binds the transaction database into ALS. | `packages/drizzle/src/database.ts` |
| Manual Mongoose boundary | `MongooseConnection.transaction(fn)` delegates to `connection.transaction(...)` or manages a manual `startTransaction()` cycle. | `packages/mongoose/src/connection.ts` |

Drizzle fail-open fallback applies only when the registered database handle does not expose `database.transaction(...)` and `strictTransactions` is `false`. In that mode, `transaction(...)` and `requestTransaction(...)` run the callback directly against the root handle, so the code path stays usable for local fakes or gradual migrations but has no rollback atomicity. Open fail-open manual `transaction(...)` callbacks are still tracked during shutdown, so `dispose(database)` waits for direct execution to settle. Set `strictTransactions: true` for production flows that require transaction guarantees; readiness becomes `not-ready` and helpers throw when `database.transaction(...)` is unavailable.

Mongoose connection ownership remains application-owned: `MongooseModule.forRoot(...)` and `forRootAsync(...)` require a concrete connection handle and never create, compile, or close the raw Mongoose connection unless the application supplies `dispose(connection)`. Mongoose fail-open fallback applies only when the registered connection lacks both `connection.transaction(...)` and `startSession()` while `strictTransactions` is `false`; in that mode, `transaction(...)` and `requestTransaction(...)` run the callback directly with no rollback atomicity. Open fail-open manual `transaction(...)` callbacks are still tracked during shutdown, so `dispose(connection)` waits for direct execution to settle. Set `strictTransactions: true` for production flows that require MongoDB transaction guarantees; readiness becomes `not-ready` and helpers throw when neither transaction API is available. `MongooseConnection.createPlatformStatusSnapshot()` exposes the same diagnostics as the exported `createMongoosePlatformStatusSnapshot(...)` helper for health/readiness surfaces.

## Request-Wide Compatibility

| Pattern | Behavior |
| --- | --- |
| Explicit request boundary | Application code can call `requestTransaction(...)` at a controller, route adapter, or request orchestration boundary when an entire request must be transactional. |
| Interceptor status | `*TransactionInterceptor` exports were removed; prefer service `@Transaction()` for business operations and explicit `requestTransaction(...)` for rare request-wide boundaries. Controller-level `@Transaction()` remains a compatibility path only when the controller owns an explicit persistence target. |

When migrating NestJS controller or interceptor transaction patterns, do not look for a replacement Drizzle or Mongoose interceptor. Keep normal business atomicity on service `@Transaction()` methods, and wrap controllers with `requestTransaction(...)` only when the complete request lifecycle must share one persistence transaction. Pass the request `AbortSignal` when available so cancellation remains visible during both real transaction execution and fail-open fallback.

## Advanced / Escape Hatch

| API | Purpose |
| --- | --- |
| `current()` / `currentSession()` | Manual access to the ambient transaction handle. Only use when raw persistence client access is needed outside standard repository patterns. |
| Explicit Client Selection | `@Transaction((self) => self.analyticsPrisma)` allows targeting a specific persistence client instance for the transaction boundary. |

## Constraints

- The primary path for transaction management is the Service layer via `@Transaction()`.
- Supported Mongoose facade operations automatically participate in the ambient transaction session; explicit session passing is discouraged for those standard flows and still required for unsupported model methods.
- Rollback is exception-driven. If the method wrapped by `@Transaction()` throws, the transaction is aborted.
