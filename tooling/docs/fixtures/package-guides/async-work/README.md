# Package-guide workstream fixtures: async work (event-bus, cqrs, queue, cron)

Evidence fixtures for the four package guides this workstream owns:

- `apps/docs/content/docs/packages/event-bus.mdx`
- `apps/docs/content/docs/packages/cqrs.mdx`
- `apps/docs/content/docs/packages/queue.mdx`
- `apps/docs/content/docs/packages/cron.mdx`

Machine-readable summary: `evidence.json` (repository-relative paths, actual
results only, keyed by full package name).

## Files

| File | Purpose |
| --- | --- |
| `helpers.ts` | `createDeferred` event barriers and `boundedWait` (reject timer, unref'd). No fixed sleeps and no polling anywhere in these fixtures. |
| `event-bus-guide-app.ts` | Complete Event bus guide app: `eventKey`, `@OnEvent` handlers, instanceof lineage events, controllable slow handler, `EventProbe` observation seam. |
| `event-bus-guide.test.ts` | `EventPublishResult` outcomes (settled/no-recipients/timed-out/background/rejected), clone restored to the matched prototype, and the native `RedisEventBusTransport` composition (channel lineage + inbound dispatch against a real `redis:7.4-alpine`). |
| `cqrs-guide-app.ts` | Complete CQRS guide app: command/query handlers, `@EventHandler` projection, `@Saga` with `CqrsDispatchContext` pass-through, delegated `@OnEvent` observer, `CqrsTimeline` ordering seam, plus a duplicate-handler app. |
| `cqrs-guide.test.ts` | Command/query dispatch, documented pipeline order (event handlers -> sagas -> delegated publication), clone-vs-bus-copy identity, missing/duplicate handler errors, status snapshot readiness/discovery counts. |
| `queue-guide-app.ts` | Complete Queue guide app: `ProcessOrderJob`/`ExplodeJob` workers, `getQueueToken()` producer, `QueueProbe` buffering seam, plus a worker-less inspection app. |
| `queue-guide.test.ts` | Native Redis job processing: constructor-identity enqueue, prototype rehydration, `deduplicationKey` id mapping, atomic `enqueueMany`, status snapshot, enqueue-time rejections, and dead-letter record shape via a second registration's `inspectDeadLetters`. |
| `cron-guide-app.ts` | Complete Cron guide app: `@Cron`/`@Timeout` decorator tasks, `LockProbe` over the raw Redis client, plus a distributed-mode module (`keyPrefix: 'fluo:cron:guide'`, `lockTtlMs: 1_000`). |
| `cron-guide.test.ts` | Decorator-time validation, registry discovery (default `<ClassName>.<methodName>` naming), dynamic registry semantics (self-disabling timeout, duplicate-name and invalid-expression rejection, transactional update rollback), and the native distributed lock (lease held during the tick, released before the next tick re-acquires). |

## Commands and results

Recorded on this worktree (`docs-foundation`), Node v24.20.0, pnpm 10.4.1,
vitest 4.1.11. The native tests start a disposable `redis:7.4-alpine` container
through the repository harness `tooling/testing/redis-native-fixture.mjs`
(isolated container, ephemeral loopback port) and fail rather than skip when
Docker is unavailable.

```
pnpm vitest run --project tooling tooling/docs/fixtures/package-guides/async-work --maxWorkers=1
# exit 0 — Test Files 4 passed (4), Tests 24 passed (24), no unhandled errors

pnpm exec tsc -p tsconfig.tools.json --noEmit
# exit 2 overall: 2 pre-existing errors in package-guides/transports (another
# workstream) plus exactly 1 error under this directory — the documented
# tools-config subpath gap described below. All other async-work files typecheck
# clean.
```

No fixed sleeps, polling delays, or wall-clock waits appear in any fixture.
Every wait is an event barrier (deferred resolved by the handler, worker,
callback, or hook itself) wrapped in `boundedWait`, whose reject timer only
fails stalled signals. Every application context, Redis client, and container
is closed in `finally` (the container through the harness `cleanup()`).

## Per-package source and contract evidence

### @fluojs/event-bus

- Contract: `packages/event-bus/README.md` (single publication path, result
  statuses, failure isolation, shutdown drain, transport ownership).
- Source: `packages/event-bus/src/index.ts` (root barrel),
  `src/module.ts` (`forRoot`, `global: true` default),
  `src/types.ts` (`EventPublishOptions` bounds, `EventBusTransport`),
  `src/publish-result.ts` (result/settlement/outcome shapes),
  `src/service.ts` (discovery, `channelFromEventType` lineage, inbound
  dispatch rehydration via `createIsolatedEvent`, drain),
  `src/decorators.ts` (`@OnEvent` public-instance-method rule),
  `src/integration.ts` (`EVENT_BUS_SHUTDOWN_COORDINATOR`),
  `src/transports/redis-transport.ts` (caller-owned clients, JSON decode),
  `src/status.ts`.
- Verified in fixtures: per-handler clones restored to the **matched** event
  type's prototype (a handler for a base class receives a base-prototype
  clone carrying the subclass state), `settled`/`no-recipients`/`rejected`
  results, `timed-out` observation while the started handler completes after
  the caller bound, `waitForHandlers: false` background `completion`,
  post-`close()` rejection with `reason: 'stopped'`, and the native Redis
  transport fan-out to the concrete + base class channels with one inbound
  rehydrated delivery.
- Package tests corroborating: `packages/event-bus/src/publish-result*.test.ts`,
  `src/shutdown-contract.test.ts`, `src/transports/redis-transport.test.ts`.

### @fluojs/cqrs

- Contract: `packages/cqrs/README.md` (pipeline order, singleton discovery,
  saga FIFO/topology, shutdown drain, status rules).
- Source: `packages/cqrs/src/index.ts` (root barrel; no subpaths),
  `src/module.ts` (`forRoot` derives delegated `EventBusModule` options;
  `global: true` default), `src/types.ts` (handler contracts,
  `CqrsDispatchContext`), `src/decorators.ts`, `src/dispatch-context.ts`
  (opaque frozen context, private weak-map state), `src/errors.ts` (FluoError
  codes), `src/buses/command-bus.ts` (constructor-keyed dispatch, preload,
  post-shutdown rejection), `src/buses/event-bus.ts` (fixed pipeline:
  handlers -> sagas -> delegated publication), `src/event-clone.ts`,
  `src/status.ts`.
- Verified in fixtures: command result return, typed query result, pipeline
  order including the saga's nested `execute` with context pass-through,
  CQRS-level clone isolation versus the delegated bus-level copies (deep-equal
  to the caller's payload, distinct instances from the CQRS clones),
  `CommandHandlerNotFoundException` on unregistered commands, bootstrap-time
  `DuplicateCommandHandlerError` for two providers claiming one command type,
  and the status snapshot (`readiness.status: 'ready'`, discovery counts,
  `ownership`, `dependencies: ['event-bus.default']`).
- Package tests corroborating: `packages/cqrs/src/module.test.ts`,
  `src/public-api.test.ts`, `src/status.test.ts`, `src/event-clone.test.ts`.

### @fluojs/queue

- Contract: `packages/queue/README.md` (constructor identity, one
  queue/worker pair per job type, deduplication, lifecycle, dead letters).
- Source: `packages/queue/src/index.ts` (root barrel; no subpaths),
  `src/module.ts` (`forRoot` options, Redis reachability check, duplicate
  connections), `src/types.ts` (`Queue` facade, options), `src/decorators.ts`
  (`@QueueWorker` class decorator), `src/service.ts` (enqueue by
  `job.constructor`, `fluo-<sha256>` dedup job ids, `addBulk` batches,
  bootstrap-ready handoff, bounded close phases), `src/tokens.ts`
  (`getQueueToken`), `src/dead-letter-manager.ts` (record shape, retention,
  5s drain), `src/worker-discovery.ts` (`jobName` defaults to the job class
  name; duplicate job type/name rejection), `src/status.ts`.
- Verified in fixtures against a real Redis: enqueue returns the BullMQ job
  id and the worker receives a rehydrated `ProcessOrderJob` instance,
  repeating a `deduplicationKey` maps to one backing id with one delivery,
  `enqueueMany` persists atomically with aligned ids, the status snapshot
  reports `started` with 2 discovered workers/2 ready queues, unregistered
  job types reject with `No @QueueWorker() registered for job type ...`, and
  a terminal failure (attempts: 1) appends a dead-letter record whose facade
  inspection returns `jobName`/`jobId`/`attemptsMade`/`errorMessage`/
  `payload`/ISO `failedAt` newest-first (arrival made deterministic by the
  shutdown dead-letter drain).
- Package tests corroborating: `packages/queue/src/module.test.ts`,
  `src/dead-letter-manager.test.ts`, `src/worker-ownership.test.ts`,
  `src/public-surface.test.ts` (BullMQ mocked at the package level; this
  fixture adds the native-server evidence).

### @fluojs/cron

- Contract: `packages/cron/README.md` (decorator rules, registry semantics,
  distributed locking, bounded shutdown, NestJS migration table).
- Source: `packages/cron/src/index.ts` (root barrel; no subpaths),
  `src/module.ts` (`forRoot`, `global: false` default, distributed
  normalization with `enabled` defaulting to `true` when a `distributed`
  object is passed), `src/types.ts` (options/descriptors/registry),
  `src/decorators.ts` (expression validated at decoration; private/static
  rejected), `src/expressions.ts` (`CronExpression` presets),
  `src/service.ts` (registry, duplicate-name rejection, rollback, timeout
  self-disable, tick admission), `src/task-runner.ts` (hook order:
  callback -> post-run release -> success/error -> `afterRun`),
  `src/task-discovery.ts` (`buildDefaultTaskName` =
  `<ClassName>.<methodName>`, `createLockKey` = `<keyPrefix>:<name>`),
  `src/distributed-lock-manager.ts` (SET PX NX lease, renewal, release),
  `src/scheduler.ts`, `src/tokens.ts`, `src/status.ts`.
- Verified in fixtures: decorator tasks appear as immutable registry
  descriptors after bootstrap (explicit and default names), invalid
  expressions and static methods throw at decoration, dynamic timeouts run
  once and self-disable, duplicate dynamic names and invalid expressions are
  rejected atomically, a failed `updateCronExpression` replacement leaves the
  previous expression active, and — natively — a distributed task holds the
  Redis lease (`GET` returns a non-empty token) during its callback and the
  lease is released before the next tick re-acquires it.
- Package tests corroborating: `packages/cron/src/module.test.ts`,
  `src/lifecycle-race.test.ts`, `src/lease-race.test.ts`,
  `src/optional-redis-peer.test.ts`, `src/shutdown-release.test.ts`.

## Typecheck

`pnpm exec tsc -p tsconfig.tools.json --noEmit` exits 2 with exactly one error
under this directory: `event-bus-guide.test.ts(7,40): error TS2307: Cannot find
module '@fluojs/event-bus/redis'`. `tsconfig.tools.json` maps `@fluojs/*` to
`packages/*/dist/index.d.ts` but has no mapping for the documented public
subpath `@fluojs/event-bus/redis` (runtime resolution works through the
vitest workspace alias factory). The subpath is the owning README's public
API, so the fixture keeps the real import and reports the gap rather than
working around it through an internal path. Suggested lead-owned fix (the
target file exists):

```jsonc
// tsconfig.tools.json paths
"@fluojs/event-bus/redis": ["./packages/event-bus/dist/transports/redis-transport.d.ts"]
```

## Discrepancies between documented contracts and implementation

Reported to the lead; not worked around in the fixtures beyond shaping tests
to documented behavior:

1. **`@fluojs/cron` `updateCronExpression` on started named tasks with the
   default croner scheduler.** The owning README describes updating a running
   cron expression as rollback-safe with the previous cadence live until the
   replacement handle stops. The implementation creates the replacement
   handle *before* stopping the previous one (`packages/cron/src/service.ts`,
   `updateCronExpression` -> `createScheduledHandle`), and croner enforces
   process-global unique job names, so with the built-in scheduler the
   replacement of a started **named** task always throws `Cron: Tried to
   initialize new named job '<name>', but name already taken.` The
   transactional rollback itself works (the fixture asserts the previous
   expression is restored). The owning package's own tests cover the success
   path only with an injected custom `CronScheduler`
   (`packages/cron/src/module.test.ts` uses `createManualScheduler()`).
   The guide documents the limitation with the working alternatives
   (remove-and-re-add, disable-then-update, custom scheduler).
2. **`@fluojs/queue` graceful close of fully idle workers surfaces an
   unhandled ioredis rejection.** Closing an application context whose
   discovered BullMQ workers are blocking but have never processed a job
   rejects with `Error: Connection is closed.`
   (`ioredis@5.10.0/built/Redis.js` `connectionCloseHandler`) as an unhandled
   rejection; vitest reports it as a run error and exits 1 even though all
   tests pass. Closing after the workers have processed at least one job is
   clean (verified by bisecting the two shapes solo). The rejections fixture
   therefore processes one real job before asserting enqueue-time rejections
   and closing, which also proves the rejections leave a live queue intact.

## Not executed (explicit gaps)

- Event bus: inbound transport dispatch for `eventKey`-overridden channels
  (the fixture covers class-name lineage channels), the drain-timeout
  expiry/degraded diagnostic path, and non-Redis `EventBusTransport`
  implementations — covered by package tests or documented from source only.
- CQRS: saga FIFO continuation/deadlock paths, the 32-hop topology limit,
  `SagaExecutionError` wrapping, and symbol-keyed clone fallback edges —
  covered by `packages/cqrs` tests, not exercised here.
- Queue: `concurrency`/`rateLimiter` execution settings,
  `ownershipEnforcement: 'reject'` collisions, `enqueueMany` cross-queue
  rejection, force-close paths after `workerShutdownTimeoutMs`, and named
  Redis client (`clientName`) topology — package tests (mocked BullMQ) or
  source-documented only.
- Cron: a *successful* live `updateCronExpression` on a started named task
  (currently fails with the default scheduler; see discrepancies), custom
  `CronScheduler` injection, timezone-specific scheduling, and genuine
  multi-instance lock contention (the fixture evidences acquire, hold, and
  release on one instance plus re-acquisition, not two competing processes).
- Guide prose fragments were shaped by the compiled fixture apps; not every
  inline fragment was separately compiled. The full NestJS migration tables
  are carried by the owning READMEs and summarized, not duplicated, in the
  guides.
