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

## Evidence and cleanup

`pnpm test` prints a unique `.omo/issue-3717-native/run-*` receipt path, actual
ports/database, public import paths, and Node TAP results. `commands.json` records
each command, output, and exit code; container logs and `result.json` preserve
readiness, image identities, and cleanup outcomes. Success requires the test
process and cleanup to exit successfully. No result is skipped when Docker is
unavailable.

The runner removes only container names it successfully created, including their
anonymous volumes, in `finally`. It never removes shared containers, images,
workspace files, or other runs' receipts. Fixture `generated/` and `node_modules/`
are private ignored outputs; the fixture lockfile is separate from the root lock.
