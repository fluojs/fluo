# Transaction Context Contract

<p><strong><kbd>English</kbd></strong> <a href="./transactions.ko.md"><kbd>한국어</kbd></a></p>

This document defines the current transaction-context contract across `@fluojs/prisma`, `@fluojs/drizzle`, and `@fluojs/mongoose`.

## Supported Integrations

| Package | Ambient context carrier | Primary access API | Request interceptor | Current support scope |
| --- | --- | --- | --- | --- |
| `@fluojs/prisma` | `AsyncLocalStorage<TTransactionClient>` | `PrismaService.current()` | `PrismaTransactionInterceptor` | Shares the active Prisma interactive transaction client when `$transaction(...)` is available. |
| `@fluojs/drizzle` | `AsyncLocalStorage<TTransactionDatabase>` | `DrizzleDatabase.current()` | `DrizzleTransactionInterceptor` | Shares the active Drizzle transaction database handle when `database.transaction(...)` is available. |
| `@fluojs/mongoose` | `AsyncLocalStorage<MongooseSessionLike>` | `MongooseConnection.currentSession()` plus `current()` for the root connection | `MongooseTransactionInterceptor` | Shares the active Mongoose session when `connection.startSession()` or delegated `connection.transaction(...)` is available. |

## Context Resolution Rules

| Rule | Current contract | Source anchor |
| --- | --- | --- |
| Root vs ambient handle | Prisma and Drizzle expose `current()` to return the active transaction handle when one exists, otherwise the root client/database. | `packages/prisma/src/service.ts`, `packages/drizzle/src/database.ts` |
| Mongoose session access | Mongoose keeps the root connection stable through `current()` and exposes the ambient transaction through `currentSession()`. | `packages/mongoose/src/connection.ts` |
| Nested boundary reuse | If a transaction is already active, Prisma and Drizzle reuse the current ALS context instead of opening a new boundary. Mongoose reuses the current session in the same way. | `packages/prisma/src/service.ts`, `packages/drizzle/src/database.ts`, `packages/mongoose/src/connection.ts` |
| Nested options restriction | Prisma and Drizzle reject nested transaction options while an ambient transaction is already active. | `packages/prisma/src/service.ts`, `packages/drizzle/src/database.ts` |
| Strict mode | Prisma, Drizzle, and Mongoose can be configured to throw when the registered client/connection does not support transactions. Without strict mode, transaction helpers fall back to direct execution. | `packages/prisma/src/service.ts`, `packages/drizzle/src/database.ts`, `packages/mongoose/src/connection.ts` |

## Boundary Semantics

| Boundary | Current behavior | Source anchor |
| --- | --- | --- |
| Manual Prisma boundary | `PrismaService.transaction(fn, options?)` runs `fn` inside `$transaction(...)` and binds the transaction client into ALS for `current()`. | `packages/prisma/src/service.ts` |
| Manual Drizzle boundary | `DrizzleDatabase.transaction(fn, options?)` runs `fn` inside `database.transaction(...)` and binds the transaction database into ALS for `current()`. | `packages/drizzle/src/database.ts` |
| Manual Mongoose boundary | `MongooseConnection.transaction(fn)` delegates to `connection.transaction(...)` when available; otherwise it starts a session, calls `startTransaction()`, commits on success, aborts on error, and ends the session in `finally`. | `packages/mongoose/src/connection.ts` |
| Request-scoped boundary | The three transaction interceptors wrap the downstream HTTP handler in `requestTransaction(...)`, using the request abort signal from `context.requestContext.request.signal`. | `packages/prisma/src/transaction.ts`, `packages/drizzle/src/transaction.ts`, `packages/mongoose/src/transaction.ts` |
| Abort handling | Prisma and Drizzle wrap request-scoped work in `raceWithAbort(...)` and track active request transactions for shutdown cleanup. Mongoose applies the same request-abort race around session acquisition, delegated `connection.transaction(...)` startup, and session-backed work. | `packages/prisma/src/service.ts`, `packages/drizzle/src/database.ts`, `packages/mongoose/src/connection.ts` |
| Shutdown behavior | Active request transactions are aborted during application shutdown, awaited for settlement, and then the package-specific disconnect or dispose hook runs. | `packages/prisma/src/service.ts`, `packages/drizzle/src/database.ts`, `packages/mongoose/src/connection.ts` |
| Shutdown entry gate | Prisma and Drizzle reject new `requestTransaction(...)` calls once shutdown has started so disconnect/dispose cannot be overtaken by late request work. Mongoose rejects new manual `transaction(...)` and `requestTransaction(...)` boundaries once shutdown has started. | `packages/prisma/src/service.ts`, `packages/drizzle/src/database.ts`, `packages/mongoose/src/connection.ts` |
| Nested request tracking | Prisma keeps nested `requestTransaction(...)` calls that run inside an existing manual transaction visible to shutdown tracking until the outer manual boundary settles. Drizzle also keeps nested manual-transaction request handles in shutdown settlement tracking until the outer manual boundary settles, so shutdown still drains that outer boundary before `dispose(database)` runs. The platform status activity count is narrower: `details.activeRequestTransactions` drops as soon as the nested request callback settles, even if the outer manual boundary continues. | `packages/prisma/src/service.ts`, `packages/drizzle/src/database.ts` |
| Nested request abort propagation | Drizzle nested `requestTransaction(...)` calls inside an existing request boundary observe the ambient request abort signal while reusing the active transaction handle. | `packages/drizzle/src/database.ts` |

## Constraints

- Repository and service code should read the persistence handle through `current()` or `currentSession()` rather than capturing the root client directly when transaction participation is required.
- Prisma transaction support depends on a client that implements `$transaction(...)`; connection lifecycle hooks are optional through `$connect()` and `$disconnect()`.
- Drizzle transaction support depends on a database object that implements `transaction(...)`; cleanup is optional through the registered `dispose` hook.
- Mongoose transaction support depends on either delegated `connection.transaction(...)` or `startSession()`. Mongoose code still passes the session explicitly to model operations even though session lookup is ambient.
- Rollback is exception-driven. Prisma and Drizzle rely on the underlying transaction runner semantics; Mongoose explicitly calls `abortTransaction()` when `fn` throws.
