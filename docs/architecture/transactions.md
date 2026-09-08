# Transaction Context Contract

<p><strong><kbd>English</kbd></strong> <a href="./transactions.ko.md"><kbd>한국어</kbd></a></p>
<!-- fluo-mongoose-contract: application-owned-connection, ambient-session-merge, preserves-operation-options, strict-fail-open, explicit-target -->

This document defines the current transaction-context contract across `@fluojs/prisma`, `@fluojs/drizzle`, and `@fluojs/mongoose`.

## Supported Integrations

| Package | Ambient context carrier | Primary access API | Request boundary API | Current support scope |
| --- | --- | --- | --- | --- |
| `@fluojs/prisma` | `AsyncLocalStorage<TTransactionClient>` | `@Transaction()` on Services | Explicit `PrismaService.requestTransaction(...)` or deprecated `PrismaTransactionInterceptor` compatibility | Shares the active Prisma interactive transaction client when `$transaction(...)` is available. |
| `@fluojs/drizzle` | `AsyncLocalStorage<TTransactionDatabase>` | `@Transaction()` on Services | Explicit `DrizzleDatabase.requestTransaction(...)` or deprecated `DrizzleTransactionInterceptor` compatibility | Shares the active Drizzle transaction database handle when `database.transaction(...)` is available. |
| `@fluojs/mongoose` | `AsyncLocalStorage<MongooseSessionLike>` | `@Transaction()` on Services | Explicit `MongooseConnection.requestTransaction(...)` or deprecated `MongooseTransactionInterceptor` compatibility | Shares the active Mongoose session when `connection.startSession()` or delegated `connection.transaction(...)` is available. |

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
| Named Drizzle handles | Each named Drizzle handle owns a separate ALS context. Multi-client services select a named handle explicitly with `@Transaction((self) => self.analytics)` rather than relying on decorator target discovery. | `packages/drizzle/src/named-registration.ts`, `packages/drizzle/src/transaction.ts` |
| Mongoose document save helper | `MongooseConnection.saveDocument(document, options?)` is an opt-in path for an existing document: it merges the ambient session with native save options, preserves document identity, and rejects missing or conflicting sessions. It does not change direct `doc.save()` behavior. | `packages/mongoose/src/connection.ts` |
| Mongoose session auto-binding | Supported `MongooseConnection.model(...)` facade operations (`create`, `find`, `findOne`, `aggregate`, `bulkWrite`) automatically attach the ambient transaction session. Unsupported model methods, `doc.save()`, raw `conn.current().model(...)` calls, and advanced cross-connection scenarios require explicit session passing. | `packages/mongoose/src/connection.ts` |
| Mongoose decorator target selection | Mongoose `@Transaction()` resolves `this.conn`, the decorated instance when it is transaction-capable, or one unique nested `this.*.conn` collaborator. It rejects multiple nested candidates rather than selecting one arbitrarily; pass an accessor such as `@Transaction((self) => self.analytics.conn)` for multi-connection services or nonstandard fields. | `packages/mongoose/src/transaction.ts` |
| Nested boundary reuse | If a transaction is already active, `@Transaction()` reuses the existing boundary instead of opening a new one. | `packages/prisma/src/service.ts`, `packages/drizzle/src/database.ts`, `packages/mongoose/src/connection.ts` |
| Nested options restriction | Prisma and Drizzle reject nested native transaction options while an ambient transaction is already active. `requireAfterCommit` in the separate `boundary` is a capability requirement on the current boundary, not a native option. | `packages/prisma/src/service.ts`, `packages/drizzle/src/database.ts` |
| Strict mode | Integration packages can be configured to throw when the registered client/connection does not support transactions. Without strict mode, transaction helpers fall back to direct execution. | `packages/prisma/src/service.ts`, `packages/drizzle/src/database.ts`, `packages/mongoose/src/connection.ts` |
| Drizzle decorator target selection | Drizzle `@Transaction()` checks the decorated host for `this.db`, then direct properties, then nested `.db` properties that expose `transaction(...)`, and falls back to the decorated instance itself when none match; use an explicit accessor such as `@Transaction((self) => self.ordersDb)` when more than one target is possible. | `packages/drizzle/src/transaction.ts` |

## Boundary Semantics

| Boundary | Current behavior | Source anchor |
| --- | --- | --- |
| `@Transaction()` boundary | Wraps the method in a package-specific transaction runner and binds the resulting client/session to ALS. | `packages/prisma/src/service.ts`, `packages/drizzle/src/database.ts`, `packages/mongoose/src/connection.ts` |
| Manual Prisma boundary | `PrismaService.transaction(...)` runs `fn` inside `$transaction(...)` and binds the transaction client into ALS. The [Prisma API](../../packages/prisma/README.md#public-api-overview) owns arguments and return values. | `packages/prisma/src/service.ts` |
| Manual Drizzle boundary | `DrizzleDatabase.transaction(...)` runs `fn` inside `database.transaction(...)` and binds the transaction database into ALS. The [Drizzle API](../../packages/drizzle/README.md#public-api-overview) owns arguments and return values. | `packages/drizzle/src/database.ts` |
| Manual Mongoose boundary | `MongooseConnection.transaction(...)` delegates to `connection.transaction(...)` or manages a manual `startTransaction()` cycle. The [Mongoose API](../../packages/mongoose/README.md#public-api) owns arguments and return values. | `packages/mongoose/src/connection.ts` |

Drizzle fail-open fallback applies only when the registered database handle does not expose `database.transaction(...)` and `strictTransactions` is `false`. In that mode, `transaction(...)` and `requestTransaction(...)` run the callback directly against the root handle, so the code path stays usable for local fakes or gradual migrations but has no rollback atomicity. The root handle is still bound into ALS for the fallback callback: nested boundaries reuse that non-atomic context, nested request work observes the ambient request abort signal, and nested direct callbacks remain in the owning shutdown drain before `dispose(database)`. Set `strictTransactions: true` for production flows that require transaction guarantees; readiness becomes `not-ready` and helpers throw when `database.transaction(...)` is unavailable.

Mongoose connection ownership remains application-owned: `MongooseModule.forRoot(...)` and `forRootAsync(...)` require a concrete connection handle and never create, compile, or close the raw Mongoose connection unless the application supplies `dispose(connection)`. Mongoose fail-open fallback applies only when the registered connection lacks both `connection.transaction(...)` and `startSession()` while `strictTransactions` is `false`; in that mode, `transaction(...)` and `requestTransaction(...)` run the callback directly with no rollback atomicity. Open fail-open manual `transaction(...)` callbacks are still tracked during shutdown, so `dispose(connection)` waits for direct execution to settle. Set `strictTransactions: true` for production flows that require MongoDB transaction guarantees; readiness becomes `not-ready` and helpers throw when neither transaction API is available. `MongooseConnection.createPlatformStatusSnapshot()` exposes the same diagnostics as the exported `createMongoosePlatformStatusSnapshot(...)` helper for health/readiness surfaces.

## After-Commit Work

This section is the normative owner of `afterCommit` ordering, failure, and lifetime across the three wrappers. Each package README owns public imports, call arguments, decorator overloads, and cache invalidation examples; Books and the website derive from this contract.

| Contract field | Behavior |
| --- | --- |
| Scope and prerequisites | Applies only to native transactions directly owned by registered Prisma, Drizzle, or Mongoose wrappers on supported Node.js `>=24.0.0 <27`. Requires Prisma interactive `$transaction`, Drizzle `database.transaction`, or Mongoose delegated `connection.transaction` or a native-session commit path. |
| Inputs and defaults | `afterCommit` registers a zero-argument synchronous/asynchronous callback and immediately returns `void`. Omitting `boundary.requireAfterCommit` or passing `false` preserves native options, `strictTransactions` defaults, and fail-open fallback. |
| Capability preflight | With `requireAfterCommit: true`, native commit observation capability is checked **before** invoking the user transaction callback; missing support rejects with `AfterCommitCapabilityError`. Even without this option, hook registration is rejected on unsupported boundaries or fallback paths without a native transaction. |
| Registration lifetime | Registration is allowed only inside an open transaction callback scope on the same wrapper. Missing scopes, closed scopes, and late registration during drain are rejected. Calling `afterCommit` neither executes the hook nor commits the transaction. |
| Completion and return | When the user callback settles, registration scope closes before native commit begins. After successful outer native commit and settlement of session cleanup, hooks are awaited one at a time in registration order (FIFO). The outer boundary waits for drain before returning the original callback result. A nested boundary returning does not imply commit or hook completion. |
| Failure | Hooks do not run on rollback, failed commit, or discarded callback attempts. After a hook fails, all remaining hooks still execute and failures are reported as `AfterCommitError`. Mongoose manual-session cleanup failure after confirmed commit uses the separate `AfterCommitCleanupError` described below. The database is already committed and Fluo does not retry or roll back the native transaction. |
| Resources and shutdown | The registration scope closes before native commit begins. After successful commit and settlement of the owned Mongoose session's `endSession()` cleanup attempt, hooks run outside the ended transaction ALS context. Manual cleanup failure after confirmed commit does not skip hooks. Shutdown waits for active hooks before `$disconnect()` or the configured `dispose(...)`. Existing shutdown restrictions on new transaction admission remain in force. |

### Nested Boundaries and Retries

Nested `transaction`, `requestTransaction`, and `@Transaction` calls on the same wrapper share the outer queue without creating a separate commit or savepoint. If a nested callback throws but the outer callback catches it and eventually commits, hooks already registered by that nested call also execute. If the final outer outcome is rollback, all are discarded. Do not assume a nested exception alone rolls back part of the shared queue.

When Mongoose's delegated `connection.transaction(...)` retries the user callback, **each callback attempt owns an isolated queue**. Discarded attempts lose their queues; only the final successful attempt drains. A native commit-only retry for the same attempt does not invoke the callback again, so it does not register hooks again. This distinction preserves native retry delegation; it does not turn hook failures into Fluo transaction retries.

Reading the current wrapper in a hook does not return the ended transaction handle/session. Prisma/Drizzle use the root handle; Mongoose uses the root connection without an active session. While lifecycle admission allows it, an explicitly opened transaction inside a hook owns an independent queue. Do not pass or reuse a native transaction handle captured by the previous callback.

### Handling Post-Commit Failure

Each package exports `AfterCommitError` as a subclass of `AggregateError`. `readonly committed = true` indicates the original DB write has already committed. `results: readonly PromiseSettledResult<void>[]` contains **every** fulfilled and rejected outcome in registration order; inherited `errors` contains all failure reasons in the same order. Synchronous throws and asynchronous rejections are both collected, and one failure never skips subsequent hooks.

If `endSession()` fails in Mongoose's manual-session path after commit is confirmed for an owning boundary that registered hooks or opted into `requireAfterCommit: true` (including a nested `requestTransaction` requirement), all hooks are attempted outside the ended ALS context before the root-exported `AfterCommitCleanupError` is thrown. It directly extends `AggregateError`, not `AfterCommitError`. `committed` is `true`, `cause` is the cleanup failure, and `results: readonly PromiseSettledResult<void>[]` contains only hook outcomes in FIFO order. `errors` starts with the cleanup failure, followed by rejected hook reasons in registration order. Cleanup failure remains reportable with no hooks when opted in, or when all registered hooks succeed; cleanup is not represented as a synthetic hook result. This is cleanup failure after a confirmed commit, not failed commit or database rollback. Legacy boundaries with no hooks and no `requireAfterCommit` requirement preserve the original cleanup error identity and no-hook request cancellation contract, including the original `AbortError`.

Callers must distinguish transaction callback/commit failures, `AfterCommitError`, and Mongoose's `AfterCommitCleanupError`. If cache invalidation or post-commit cleanup fails, use an application-defined idempotent recovery or reconciliation path instead of repeating the original DB write. Neither post-commit error is a reason for native transaction retry, rollback, or abort. Because drain is awaited, a slow hook also delays the boundary response and shutdown.

### Cache and Delivery Limitations

Registering a hook that calls `CacheService.del(...)` or performs Redis invalidation inside the DB write callback avoids deleting the cache before a transaction rolls back. The application registers the cache and connections and designs TTL, recovery, idempotency, and shutdown ordering for dependent resources. This does not eliminate the observation window between DB commit and cache deletion or concurrent stale cache refill.

Commits from external raw-client transactions, other wrappers, or other connections are not observed. Redis has no Fluo-owned commit tracking and is unsupported by this API. Future `MULTI/EXEC` support needs separate design and review; calling Redis from a DB hook does not create DB+Redis atomicity.

This is an execution contract for successful in-process owner invocations. It does not promise distributed transactions, a durable outbox, delivery after a process crash, or network exactly-once. A process may exit after commit before hooks run, and lost responses from external systems remain unresolved. For durable delivery, persist the DB write and an outbox record in the same native transaction, then design a separate idempotent dispatcher and reconciliation.

### Evidence and Verification Scope

| Target | Implementation and verification paths |
| --- | --- |
| Prisma | `packages/prisma/src/service.ts`, `packages/prisma/src/transaction.ts`, `packages/prisma/src/index.ts`, [package regression tests](../../packages/prisma/src/after-commit.test.ts) |
| Drizzle | `packages/drizzle/src/database.ts`, `packages/drizzle/src/transaction.ts`, `packages/drizzle/src/index.ts`, [package regression tests](../../packages/drizzle/src/after-commit.test.ts) |
| Mongoose | `packages/mongoose/src/connection.ts`, `packages/mongoose/src/transaction.ts`, `packages/mongoose/src/index.ts`, [package regression tests](../../packages/mongoose/src/after-commit.test.ts) |
| Real native commit fixture | [Run instructions](../../packages/prisma/fixtures/after-commit/README.md#run): built public imports of all three packages, PostgreSQL and MongoDB manual/delegated paths |
| Common runtime behavior matrix | [`tooling/governance/after-commit-contract.test.ts`](../../tooling/governance/after-commit-contract.test.ts) |

These paths are #3717 contract verification targets; the list itself is not passing execution evidence. With repository dependencies installed on a supported Node.js version, run `pnpm vitest run --project packages packages/prisma/src/after-commit.test.ts packages/drizzle/src/after-commit.test.ts packages/mongoose/src/after-commit.test.ts` and `pnpm vitest run --project tooling tooling/governance/after-commit-contract.test.ts`. Consult the native fixture instructions and the lead's verification receipt for its environment, exact command, and observed commit results. Passing wrapper doubles alone does not establish native DB verification.

## Request-Wide Compatibility

| Pattern | Behavior |
| --- | --- |
| Explicit request boundary | Application code can call `requestTransaction(...)` at a controller, route adapter, or request orchestration boundary when an entire request must be transactional. |
| Deprecated interceptor compatibility | `PrismaTransactionInterceptor`, `DrizzleTransactionInterceptor`, and `MongooseTransactionInterceptor` are restored for existing 1.x imports and delegate to each package's `requestTransaction(...)` API. Prefer service `@Transaction()` and explicit request boundaries for new code. |

When migrating NestJS controller or interceptor transaction patterns, keep normal business atomicity on service `@Transaction()` methods. Existing Prisma, Drizzle, or Mongoose applications may retain the deprecated compatibility interceptor while migrating, but new request-wide boundaries should call `requestTransaction(...)` explicitly. Pass the request `AbortSignal` when available.

## Advanced / Escape Hatch

| API | Purpose |
| --- | --- |
| `current()` / `currentSession()` | Manual access to the ambient transaction handle. Only use when raw persistence client access is needed outside standard repository patterns. |
| Explicit Client Selection | `@Transaction((self) => self.analyticsPrisma)` allows targeting a specific persistence client instance for the transaction boundary. |

## Constraints

- The primary path for transaction management is the Service layer via `@Transaction()`.
- `MongooseConnection.saveDocument(...)` is opt-in and requires an active ambient session; it fails closed outside a transaction, rejects a conflicting explicit `session`, and leaves native `doc.save()` unmodified.
- Supported Mongoose facade operations automatically participate in the ambient transaction session; explicit session passing is discouraged for those standard flows and still required for unsupported model methods.
- Rollback is driven by pre-commit exceptions. An exception escaping the `@Transaction()` callback to the outer native boundary aborts the transaction. Neither `AfterCommitError` nor Mongoose's `AfterCommitCleanupError` after a successful commit means rollback.
