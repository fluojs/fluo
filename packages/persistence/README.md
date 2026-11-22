# @fluojs/persistence

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

ORM-independent transaction boundary contracts and composable policy primitives.
This package does not create connections, sessions, ALS, or native transactions.
The [transaction context contract](../../docs/architecture/transactions.md) owns shared transaction semantics.

## Installation

```bash
pnpm add @fluojs/persistence
```

There are no core, runtime, HTTP, diagnostics, ORM, or driver dependencies or eager Node builtins.
These portable primitives declare no package-wide `engines.node` and do not broaden concrete ORM host or driver support.

## Public API

| Export | Contract |
| --- | --- |
| `AfterCommitCallback` | Post-commit work typed as `() => void \| Promise<void>` |
| `TransactionBoundaryOptions<T>` | Optional `requireAfterCommit` and application-owned `shouldRollback(value)` |
| `AfterCommitCapabilityError`, `AfterCommitError` | Missing native commit capability and post-commit hook failure; the latter preserves `committed=true` and all FIFO `results` |
| `TransactionRollbackCapabilityError`, `TransactionRollbackOnlyError`, `TransactionRollbackUnconfirmedError` | Missing capability, the first nested failure's `result`, and missing positive native rollback confirmation |
| `TransactionRollbackObservation`, `TransactionRollbackObserver` | Positive `confirmRollback()`, `run(callback)`, and `beginAttempt(transaction, connection?)` |
| `RequestAbortContext`, `ActiveRequestTransaction`, `ActiveRequestTransactionHandle` | Caller signal forwarding and owner-local active-work settlement |
| `createRequestAbortContext`, `trackActiveRequestTransaction`, `untrackActiveRequestTransaction` | Abort forwarding preserving reason identity, listener cleanup, set registration/removal and promise settlement |

`@fluojs/persistence/internal` provides `ResultBoundary`, `RollbackOwner`,
`evaluateResult`, `observeRollback`, and `settleAfterCommitCallbacks` for first-party ORM composition.
Application transaction execution APIs remain in each ORM package.

## Usage example

This service fragment assumes an existing Prisma wrapper. Follow the
[Prisma API](../prisma/README.md#choosing-rollback-from-a-result) for concrete client and rollback observer registration.

```ts
import type { TransactionBoundaryOptions } from '@fluojs/persistence';

type PublishResult = { readonly ok: boolean };
const boundary: TransactionBoundaryOptions<PublishResult> = {
  requireAfterCommit: true,
  shouldRollback: (result) => !result.ok,
};
```

This boundary is the last Prisma/Drizzle argument. Mongoose accepts
`transaction(fn, boundary)` or `requestTransaction(fn, signal, boundary)` without a native-options argument.
Callback/return typing and native option positions do not change.

## Defaults and ownership

Both options are omitted by default. Failure-shaped values never imply rollback.
When a predicate rejects a value, the nested owner keeps its first failure sticky rollback-only.
Recovering a root failure requires both its exact owner signal and positive native rollback confirmation.
Native commit and rollback errors propagate with their original identity.
In the Result rollback path, a transaction failure overlapped by a failed abort or a failed session cleanup
follows a separate branch instead of single-identity propagation: the original failures are preserved in
`AggregateError.errors` with the earlier failure as `cause`, and native failures are never masked as a
normal result or `TransactionRollbackOnlyError`.

After-commit registration is synchronous within the same open native callback scope.
After successful outer commit and associated cleanup settlement, every hook is awaited FIFO outside ended ALS.
Rollback, failed commit, and discarded retry attempts never run their hooks.
Hook failures do not undo commit or trigger native retry.

`AfterCommitError` snapshots the input array and each settlement record at construction.
Changing the original records or reordering or clearing the original array leaves all FIFO
`results` and the failure order in `errors` intact. Rejection reasons in both fields retain
their original object identity and are neither deep-cloned nor frozen. This adds no runtime
immutability guarantee for the returned `results` or `errors`.

Mongoose's manual-session cleanup is the one cleanup identity exception. After a confirmed commit, an owner
that registered no hooks and required no `requireAfterCommit` still receives the original `endSession()`
failure as the same object; omitting `requireAfterCommit` or passing `false` preserves this branch.
An owner that registered hooks or required `requireAfterCommit: true` at a root or nested boundary has every
hook attempted outside the ended ALS once cleanup fails, and the boundary then reports the `@fluojs/mongoose`
root-exported `AfterCommitCleanupError`, a direct `AggregateError` subclass rather than an `AfterCommitError`
subclass, with `committed === true` and `cause === cleanupFailure`.
Its `results` holds hook outcomes FIFO only, while `errors` holds the cleanup failure followed by failed hook
reasons in registration order; cleanup failure stays reportable with no hooks when opted in, and when every
hook succeeds.

ORM packages own native observers, callback attempt lifetimes, connections/sessions, shutdown admission and drain.
The Mongoose observer's `connection?` supplies session-owning connection context;
`AfterCommitCleanupError` remains a Mongoose-owned direct `AggregateError` subclass.
Drizzle status activity lifetime stays separate from shutdown settlement.
No new savepoints, retry, durability, outbox, exactly-once, or DB+Redis atomicity is provided.

## Existing import compatibility

Existing core and ORM root common errors and boundary types directly re-export this package's originals.
Constructor equality and `instanceof` remain intact for the same dependency instance.
Runtime root request-transaction helpers remain re-exported.
The [migration guide](../../docs/getting-started/migrate-persistence-contracts.md) describes an optional canonical import transition.
Compatible-copy recognition does not merge wrapper transaction state.

## Verification evidence

`src/result-rollback.test.ts`, `src/request-transaction.test.ts`, and `src/after-commit.test.ts` exercise shared primitives.
`tooling/governance/after-commit-contract.test.ts` compares canonical and existing root constructor identity.
The [native fixture](../prisma/fixtures/after-commit/README.md) owns real database observations.
Listing targets or commands is not a claim of passing execution; inspect each run's logs and receipt.
