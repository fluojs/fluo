# Native afterCommit acceptance (#3717)

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

This private fixture exercises the built public `@fluojs/prisma`,
`@fluojs/drizzle`, and `@fluojs/mongoose` imports on Node.js 24. It does not build
packages, alias package source, or change workspace dependencies. The Fluo package
links must resolve to this worktree's `dist/index.js`; the test asserts that path.
The entry is named `acceptance.ts` so ordinary workspace Vitest discovery does
not execute it without databases. `run.mjs` passes it explicitly to Node's
`--test` runner. Fixture typechecking uses TypeScript 6.0.2, matching the workspace,
and extends the repository's `tsconfig.base.json` without a local `skipLibCheck`
override. NodeNext resolution and ES2024/Web API types match the native consumer.

## Run

Have the worktree owner build the three integration packages and their workspace
dependencies first. Install and generate only this fixture's pinned dependencies:

```sh
cd packages/prisma/fixtures/after-commit
pnpm install --ignore-workspace --ignore-scripts --frozen-lockfile
pnpm run generate
pnpm run typecheck
docker pull postgres:16-alpine@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685
docker pull mongo:8.0.20@sha256:098862b1339f031900ca66cf8fef799e616d6324fa41b9a263f2ec899552c1ef
pnpm test
```

The separate upstream declaration audit is
`pnpm exec tsc --noEmit --pretty false --skipLibCheck false`. It is not the
canonical consumer check and must not gate native execution. Drizzle 0.45.2's
all-dialect declaration graph currently reports missing optional `gel` types and
incompatible class/interface declarations. Preserve that audit's nonzero exit
and complete diagnostics separately; do not install unrelated drivers or treat
the audit as passing because the canonical consumer check passes.

The runner requires a working Docker server. It creates one PostgreSQL container
and one single-member Mongo replica set, using UUID names, unique databases,
loopback-only ephemeral host ports, and tmpfs data directories. It subscribes to
attached Docker output for readiness and to Mongo's primary-transition log before
initiating the replica set. Readiness has a failure deadline, not sleeps or probe
polling. No database environment variables or shared fixture changes are needed.

The manual Mongoose path binds `startSession` and `model` from the real connection
to the public manual-session seam. It does not replace native methods or mutate
the connection. The delegated path uses the native `connection.transaction`.

## Acceptance assertions

The #3718 result-based rollback acceptance criteria use the same native boundaries.
The [shared-owner contract](../../../../docs/architecture/transactions.md#result-based-rollback)
owns their meaning, and the three package READMEs own exact APIs and consumer types.
Documenting these criteria is not a claim of passing execution; inspect the current
fixture's actual TAP and receipt.

- Omitting the predicate preserves commit even for a failure-shaped return value.
- An explicit root failure must roll back writes and hooks and return the same
  object after successful native rollback and cleanup.
- A nested opted-in failure must return its original value and mark the owner
  sticky rollback-only. If the root also selects failure, return its same root
  failure value; otherwise, `TransactionRollbackOnlyError.result` must contain the
  first nested failure.
- Ordinary caught nested exceptions must retain existing commit/hooks. Native
  callback retries must use fresh owners without leaking discarded attempts'
  hooks, failure values, or rollback-only state.
- Native commit, rollback, and cleanup errors must not be hidden by domain results
  or rollback-only errors. Callback preflight with `TransactionRollbackCapabilityError`
  for fallback/legacy targets is a separate unit-boundary verification target.

External raw transactions and Redis `MULTI/EXEC` are out of scope; these criteria
do not establish savepoints, durability, DB+Redis atomicity, or durable delivery.

Each of Prisma, Drizzle, Mongoose manual, and Mongoose delegated covers:

- Uncommitted rows are invisible to root reads. Hooks see durable rows after
  commit and execute without an ambient transaction/session.
- Nested boundaries share a native handle and defer hooks to the outer commit.
  A hook can start and commit a fresh transaction with its own hook.
- Callback rollback and an escaping nested failure discard writes and hooks.
- A caught nested application exception preserves shared writes and registered
  hooks when the outer owner commits; nested reuse is not a savepoint.
- Request success waits for hooks. An explicit callback barrier coordinates
  request cancellation and verifies native rollback without timing assumptions.
- A failing hook produces the package-local `AfterCommitError`, an
  `AggregateError` with `committed=true` and all settled results, while later hooks
  still run and the committed row remains.
- Native COMMIT failure after a successful callback discards hooks and writes:
  PostgreSQL uses a deferred foreign-key constraint; Mongo uses a one-shot
  server-side `commitTransaction` failpoint with non-transient error code 2.
  The failpoint is enabled only inside the runner's private Mongo container.

Two additional delegated Mongoose cases use native `failCommand` and command
events: an insert WriteConflict/TransientTransactionError runs the callback
twice but drains only the successful attempt's hook; an
UnknownTransactionCommitResult executes COMMIT twice with one callback and one
hook. Each verifies durable root reads, prints actual attempt counts, and disables
its failpoint in `finally`, without sleeps or driver replacements.

The deterministic unit suites own the broader concurrency, lifecycle, retry, and
error matrix. This fixture is specifically the real-driver/native-commit seam.

The fixture covers Result root/nested success and failure, ignored failure, arbitrary default values, caught throws, and native commit errors through all three public entry points, plus independent-owner concurrency on real databases. Prisma uses its public adapter-factory observer to confirm both SQL rollback and cleanup; PostgreSQL backend termination verifies that a rollback error hidden by the native runner propagates instead of a normal Result. Drizzle also verifies an actual SQL rollback rejection. Mongo confirms successful abort through correlated session/transaction/request/connection command events and verifies that a one-shot server abort error cannot become a normal Result even when hidden inside the driver. Unsupported configurations and insufficient evidence are not counted as successful native rollback. Follow the [strict shared contract](../../../../docs/architecture/transactions.md#result-based-rollback).

## Evidence and cleanup

`pnpm test` prints a unique `.omo/issue-3718-native/run-*` receipt path, actual
ports/database, public import paths, and Node TAP results. `commands.json` records
each command, output, and exit code; container logs and `result.json` preserve
readiness, image identities, and cleanup outcomes. Success requires the test
process and cleanup to exit successfully. No result is skipped when Docker is
unavailable.

The runner removes only container names it successfully created, including their
anonymous volumes, in `finally`. It never removes shared containers, images,
workspace files, or other runs' receipts. Fixture `generated/` and `node_modules/`
are private ignored outputs; the fixture lockfile is separate from the root lock.
