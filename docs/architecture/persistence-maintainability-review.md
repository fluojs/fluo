# Persistence Maintainability Assessment

<p><strong><kbd>English</kbd></strong> <a href="./persistence-maintainability-review.ko.md"><kbd>한국어</kbd></a></p>

## Scope and baseline

The shared transaction policy and ORM execution responsibilities for
[#3950](https://github.com/fluojs/fluo/issues/3950) were examined at
`d34494e9f6c00a29bd63c6dbb71dc722bdd695d0`. This document records the assessment
and execution evidence for that checkout; it is not a new behavioral contract or API guide.
The authorities are [CONTRIBUTING](../../CONTRIBUTING.md),
[behavioral contract policy](../contracts/behavioral-contract-policy.md),
[transaction context contract](./transactions.md),
[import migration](../getting-started/migrate-persistence-contracts.md),
and the four packages' README/README.ko.md pairs.

Every target package receives a **retain** verdict. The examined shared policies
already use the persistence originals. No remaining duplication of identical policy
was established, so no source/test changes were manufactured. The improvement
connects otherwise scattered implementation, regression, and execution evidence to
the package verdicts below, distinguishing shared policy owners from adapter
resource owners for subsequent maintenance. It does not claim fewer policy
implementation sites or improved performance.

This is neither an exhaustive audit nor verification of the latest registry release.
Deno-specific paths, support removal #3938, new runtime/driver support, and Foundation
changes are excluded. Existing contract descriptions, package READMEs, and Book
content do not change, so no Book edit is needed.

## Package verdicts and evidence

### @fluojs/persistence: retain shared policy ownership

`packages/persistence/src/transaction.ts` owns the original shared boundary types
and error constructors; `src/result-rollback.ts` owns `evaluateResult`, `ResultBoundary`,
and `observeRollback`; `src/after-commit.ts` owns sequential FIFO settlement;
`src/request-transaction.ts` owns abort forwarding and active-work registration,
removal, and settlement. `src/index.ts`, `src/internal.ts`, and `package.json`
separate the portable root/internal boundary without production dependencies or eager Node builtins.

`src/result-rollback.test.ts` checks omitted predicates, sticky first nested failures,
root/nested value identity, exact owner signals and positive rollback confirmation,
native failure identity, and attempt isolation. `src/after-commit.test.ts` settles
every FIFO hook even after failure. `src/request-transaction.test.ts` checks abort
reason identity, listener removal, and settlement after registration removal.

Shared policy already has one modification site. Adding ALS, connections/sessions,
native runners, ORM brands, diagnostics, or cleanup would couple portable policy to
adapter execution lifetimes. This package creates neither resources nor transactions;
that boundary is retained.

### @fluojs/drizzle: retain adapter execution responsibility

`packages/drizzle/src/result-rollback.ts` and `src/after-commit.ts` re-export the
persistence originals, consumed by `src/database.ts`. Explicit accessors, legacy
`this.db` -> direct property -> nested `.db` -> decorated instance discovery, and
native option positions in `src/transaction.ts` are Drizzle contracts.
`src/database-brand.ts` checks the non-enumerable owner/version and complete consumed
surface; `src/facade.ts` preserves the respective wrapper and native delegate receivers.

Callback registration scopes, native-owner child settlement drain, fresh roots from
closed ALS continuations, status activity, and shutdown settlement in `src/database.ts`
have distinct lifetimes. Combining the nested request status decrement with the wait
for outer native settlement would change diagnostics or disposal ordering.
SQL rollback and pooled-release observation in `src/rollback-observer.ts` belongs
to node-postgres resource handling, not a shared cleanup helper.

`src/result-rollback.test.ts` checks query-isolated copy owners/decorators, original
values, native option identity/positions, sticky nested failures, native errors,
and attempt isolation. `src/after-commit.test.ts` uses commit/hook barriers to check
FIFO, scope closure, and shutdown drain. `src/module.test.ts`, `src/public-api.test.ts`,
`src/published-artifact-surface.test.ts`, and `src/vertical-slice.test.ts` check
registration, facades, public artifacts, and service/request flows.
Bun async-driver exception support is not expanded into Node-scoped Result/after-commit guarantees.

### @fluojs/mongoose: retain session execution and cleanup responsibility

Shared errors in `packages/mongoose/src/result-rollback.ts` and `src/after-commit.ts`
are persistence originals. Mongoose's `AfterCommitCleanupError` directly subclasses
`AggregateError`, retaining cleanup-first `errors`, cleanup `cause`, and hook-only
`results`. This is not the same policy as ordinary `AfterCommitError`.

`src/transaction.ts` prioritizes explicit accessors and retains legacy `this.conn`
-> decorated instance -> unique nested `this.*.conn` discovery and its multiple-candidate
error. The complete surface in `src/connection-brand.ts` also includes `currentSession`
and `model`. `src/connection.ts` owns delegated/manual sessions, abort/endSession after
callback drain, and native option/session handling for model/saveDocument.
Raw connection creation, model compilation, and close remain application-owned;
only configured disposal is invoked. `src/rollback-observer.ts` correlates the
session-owning connection and transaction/request/connection commands. Missing/pending
commands, local state, and writeConcernError are not positive rollback confirmation.

`src/result-rollback.test.ts`, `src/result-rollback-decorator.test.ts`,
`src/result-rollback-retry.test.ts`, `src/result-rollback-cleanup.test.ts`, and
`src/after-commit.test.ts` check manual/delegated results, retries, cleanup, and hook
ordering. `src/module.test.ts`, `src/public-api.test.ts`, and `src/vertical-slice.test.ts`
check module and service boundaries. Existing `vi.waitFor` in `module.test.ts`
was not modified. No polling or fixed sleeps were added, and no Mongoose
native-options argument was introduced.

### @fluojs/prisma: retain client execution and attempt responsibility

`packages/prisma/src/result-rollback.ts` and `src/after-commit.ts` re-export the
shared originals. Explicit accessors, unambiguous compatible-owner discovery,
compatibility overloads, and native-options/boundary separation in `src/transaction.ts`
are not equivalent to other ORMs' discovery. `src/prisma-service-brand.ts` checks the
versioned owner and complete surface; the facade in `src/service.ts` preserves
native delegate receivers.

`src/service.ts` owns ALS-unavailable failure, fallback before callback execution
when native signal options are rejected, callback-attempt owner/hook queue isolation,
and connect/disconnect drain. `src/rollback-observer.ts` requires both adapter-pg
SQL ROLLBACK and adapter cleanup. Re-exporting common request helpers through
`src/integration.ts` provides no reason to move Prisma execution into persistence
or introduce a new runtime dependency.

`src/result-rollback.test.ts` checks query-isolated copies, native options, and
Result identity; `src/after-commit.test.ts` checks hook ordering and capability
failures; `src/module.test.ts` checks unavailable ALS and lifecycle/registration
isolation. `src/public-api.test.ts` checks cold-built public imports and absence of
removed APIs in declarations; `src/vertical-slice.test.ts` checks service/request
flows including a real HTTP boundary. Native observers, retries, and cleanup remain
tied to Prisma resources/attempts rather than a generic adapter base class.

## Actual execution results

Commands ran on 2026-10-12 UTC in `/Users/ayden/Documents/fluo/.worktrees/issue-3950`
with Node.js `v24.20.0` and pnpm `10.4.1`. The source head is the baseline SHA above;
only this independent EN/KO report changes. Ignored `.omo/evidence/issue-3950.json`
binds the final commit SHA, command output, durations, exit codes, and existing local
logs. This supporting evidence must be preserved outside the checkout.

| Command | Observation | Exit code / duration |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | Installed 787 packages across 62 workspaces; lockfile unchanged | 0 / pnpm-reported 3.2 s |
| `pnpm -r --filter '@fluojs/persistence...' --filter '@fluojs/drizzle...' --filter '@fluojs/mongoose...' --filter '@fluojs/prisma...' run build` | 14-package dependency closure passed; rebuilding the same closure after the initial failure below also passed | 0 / rebuild wall 7.21 s |
| `pnpm vitest run --project packages packages/persistence/src/ packages/drizzle/src/ packages/mongoose/src/ packages/prisma/src/ --no-file-parallelism` | 41 files, 495 tests passed; suite inventory is persistence 3, Drizzle 12, Mongoose 13, Prisma 13, with no zero-match owner | 0 / wall 39.64 s, Vitest 39.19 s |
| `pnpm vitest run --project tooling tooling/governance/after-commit-contract.test.ts` | Shared error identity and Prisma/Drizzle/Mongoose manual/delegated boundary doubles: 53 tests passed | 0 / wall 1.70 s |
| `pnpm -r --filter @fluojs/persistence --filter @fluojs/drizzle --filter @fluojs/mongoose --filter @fluojs/prisma run typecheck` | All four package typechecks passed, after emitted builds finished | 0 / wall 1.49 s |
| `pnpm exec biome lint packages/persistence/src packages/drizzle/src packages/mongoose/src packages/prisma/src` | Checked 86 files, without fixes or suppression | 0 / wall 0.95 s |
| `node --input-type=module -e` (smoke below) | `PERSISTENCE_IMPORT_IDENTITY_PASS` | 0 / wall 0.13 s |
| `pnpm verify:platform-consistency-governance` | `Platform consistency governance checks passed.` | 0 / wall 2.93 s |
| `pnpm vitest run --project tooling tooling/governance/verify-platform-consistency-governance.test.ts` | 475 tests passed | 0 / wall 2.49 s |
| `pnpm verify:changeset-release-lane --lane stable --base-ref d34494e9f6c00a29bd63c6dbb71dc722bdd695d0` | Stable gate passed; 104 existing pending package bump intents, 0 package version deltas | 0 / wall 0.22 s |

Wall durations were measured with `/usr/bin/time -p`. Total wall time for the first
build was not measured; its raw log contains per-package build durations.
The 7.21 s above is the separately executed rebuild. The Terminus/Prisma
emitted-artifact builds in Vitest global setup and the Drizzle artifact suite's
cold build are verification prerequisites, not full local CI.

Exact smoke input:

```sh
node --input-type=module -e "import assert from 'node:assert/strict'; import * as p from './packages/persistence/dist/index.js'; import * as i from './packages/persistence/dist/internal.js'; import * as d from './packages/drizzle/dist/index.js'; import * as m from './packages/mongoose/dist/index.js'; import * as r from './packages/prisma/dist/index.js'; for (const x of [d,m,r]) for (const k of ['AfterCommitCapabilityError','AfterCommitError','TransactionRollbackCapabilityError','TransactionRollbackOnlyError','TransactionRollbackUnconfirmedError']) assert.equal(x[k],p[k]); for (const k of ['ResultBoundary','evaluateResult','observeRollback','settleAfterCommitCallbacks']) assert.equal(typeof i[k],'function'); assert.equal('ResultBoundary' in p,false); console.log('PERSISTENCE_IMPORT_IDENTITY_PASS');"
```

### Failures and execution-order adjustment

Before any source changes, both default file-parallel focused runs failed at
Prisma `src/public-api.test.ts:148`: 40 files/494 tests passed, 1 file/1 test failed,
exit 1, wall 38.79 s and 33.03 s.
The diagnostic was `Cannot find module '@fluojs/diagnostics' or its corresponding type declarations.`
The `beforeAll` in Drizzle `src/published-artifact-surface.test.ts` cold-builds a
dependency closure in the same checkout, deleting shared dist artifacts while the
Prisma declaration check runs. This exposed an existing test-harness build race.

The first typecheck, started during emitted rebuilding, also failed with that
TS2307: exit 2, wall 1.81 s. After prerequisite rebuilding, the standalone Prisma
public-api suite passed 6 tests, exit 0, wall 22.78 s. Subsequently, **all the same
41 suites ran serially without omissions**, followed by typecheck, producing the
passing results above. No tests, source, or configuration were changed and no failure
was skipped. Failure output is preserved as excerpts in evidence, not represented
as complete logs.

## Unexecuted scope and release impact

Native transaction policy, observers, attempt lifetimes, and cleanup source did
not change, so the PostgreSQL/MongoDB native fixture and separate upstream
declaration audit were not run. Passing doubles do not establish durable rows or
real database rollback success. Brands/public import closure and Drizzle
ALS/exception/shutdown source also did not change, so
`pnpm test:duplicate-module-safety` and Bun conformance are conditionally unrun.
`pnpm verify:public-export-tsdoc` is conditionally unrun because package source is unchanged.

`pnpm verify:local`, `pnpm verify:release-readiness`, and its `--skip-build` variant
were not run. The latter runs full tests/sandbox and was excluded by the corrected
preflight. There is no interrupted full-CI run or full-CI PASS receipt.
Final PR exact-head GitHub CI and selected independent reviews belong to the lead's
subsequent stages; this assessment does not claim they passed.

Only root `docs/architecture/persistence-maintainability-review.md` and `.ko.md`
change. The four packages' published `files: ["dist"]`, source, exports, manifests,
lockfile, and release metadata remain unchanged. This report is not included in
package artifacts and changes no public behavior, API, or package contents, so
CONTRIBUTING's docs-only policy requires no Changeset or version bump.
The portable import graph gains no Node builtin or ORM dependency.
