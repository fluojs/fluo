# Migrating Persistence Contract Imports

<p><strong><kbd>English</kbd></strong> <a href="./migrate-persistence-contracts.ko.md"><kbd>한국어</kbd></a></p>

## Scope

The canonical owner of shared transaction boundary types/errors and rollback observation declarations
moves to `@fluojs/persistence`. Existing public imports are not removed; consumer edits are optional.
The [transaction context contract](../architecture/transactions.md) owns shared semantics;
each ORM README owns execution APIs and driver support.

## Optional import transition

```ts
// Existing imports remain valid.
import { AfterCommitError as ExistingAfterCommitError } from '@fluojs/core';
import { AfterCommitError, type TransactionBoundaryOptions } from '@fluojs/persistence';

const sameConstructor = ExistingAfterCommitError === AfterCommitError;
const boundary: TransactionBoundaryOptions<{ readonly ok: boolean }> = {
  shouldRollback: (result) => !result.ok,
};
```

Declare a direct dependency with `pnpm add @fluojs/persistence` when importing the canonical package.
Existing core/ORM error paths and runtime root request-transaction helper paths remain direct re-exports.
No subclass wrappers or path-local error declarations are introduced.

## Preserved behavior

Prisma/Drizzle native options stay separate from the last Fluo boundary; Mongoose gains no native-options argument.
Strict/fail-open defaults, nested owner reuse, container/named-registration/concurrent-owner isolation remain intact.
Result recovery requires the exact owner signal and positive native rollback confirmation, preserving native error identity.
FIFO hook drain outside ALS after commit and cleanup, retry-attempt isolation, cancellation and shutdown drain remain intact.

## Ownership and verification

The absence of Node builtins in portable primitives does not establish new ORM or driver host support.
Native driver rollback observation and cleanup remain ORM-owned, including Mongoose `connection?` context
and the direct `AggregateError` subclass `AfterCommitCleanupError`.
`@fluojs/persistence/internal` is a first-party composition seam, not an application transaction runner.
Diagnostics/status are outside this transition, and no other new package is required.

Run `packages/persistence/src/*.test.ts` and `tooling/governance/after-commit-contract.test.ts`.
Verify real databases and distributed import closure separately with the native fixture and `pnpm test:duplicate-module-safety`.
Local focused evidence, independent review, full local CI, and GitHub CI do not substitute for one another.
