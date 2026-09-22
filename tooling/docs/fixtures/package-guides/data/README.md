# Package guide fixtures — data track (prisma, drizzle, mongoose, redis, cache-manager)

Runnable evidence for five package guides written under
`apps/docs/content/docs/packages/`:

| Guide | Example file | Test file |
| --- | --- | --- |
| `prisma.mdx` | `prisma-catalog.example.ts` | `prisma-catalog.test.ts` |
| `drizzle.mdx` | `drizzle-orders.example.ts` | `drizzle-orders.test.ts` |
| `mongoose.mdx` | `mongoose-articles.example.ts` | `mongoose-articles.test.ts` |
| `redis.mdx` | `redis-sessions.example.ts` | `redis-sessions.test.ts` (native) |
| `cache-manager.mdx` | `cache-products.example.ts` | `cache-products.test.ts`, `cache-redis.integration.test.ts` (native) |

`evidence.json` is the compact machine-readable index keyed by full package
name (`@fluojs/prisma` ... `@fluojs/cache-manager`), with repository-relative
paths and actual results only: `verifiedCommands` strings carry the command
plus its actual result, and each package's `unexecuted` strings list the scope
this track did not execute.

## Run

From the repository root (this worktree):

```sh
pnpm vitest run --project tooling tooling/docs/fixtures/package-guides/data --maxWorkers=1
```

Actual result at authoring time (worktree `docs-foundation` @ `e0c73126e`):
`Test Files 6 passed (6)`, `Tests 43 passed (43)`. The two native suites each
start an isolated `redis:7.4-alpine` container on an ephemeral loopback port
via the repository harness `tooling/testing/redis-native-fixture.mjs`
(diagnostic JSON under `.artifacts/redis-native-fixture/docs-package-guides.json`).

Typecheck (public declarations): `pnpm exec tsc -p tsconfig.tools.json --noEmit`
→ 0 errors under `tooling/docs/fixtures/package-guides/data`. Pre-existing
errors in other workstreams' `package-guides/*` directories are outside this
track. Lint: `pnpm exec biome check tooling/docs/fixtures/package-guides/data`
→ clean.

## Test interpretation (important for evidence consumers)

- The root vitest config resolves `@fluojs/*` imports to workspace **source**
  via `collectWorkspaceAliases` (`tooling/vitest/src/index.ts`), so these tests
  exercise current source, not built artifacts. Typecheck resolves
  `@fluojs/*` to `packages/*/dist/index.d.ts` (`tsconfig.tools.json`), so the
  example files also compile against the emitted public declarations. Neither
  check installs or exercises a published tarball; published-package
  compatibility is out of scope here.
- Determinism: no sleeps or polling. Concurrency and shutdown ordering are
  coordinated with explicit deferred barriers and `once(...)` event
  subscriptions (e.g. the Redis `end` status event is subscribed **before**
  `close()` because ioredis processes the QUIT reply on the socket close tick).
  Every app, context, container, and fixture is closed in `finally`/`afterAll`.

## Per-package evidence scope

### prisma

- Driver double client (`$connect` / `$disconnect`, optional `$transaction`)
  proves the package's own contracts: bootstrap `$connect`, `@Transaction`
  accessor boundaries, fail-open direct execution, facade forwarding to the
  ambient client, `PRISMA_CLIENT` / `getPrismaServiceToken()` bindings,
  `forRootAsync` resolution from a global config module, status snapshot
  ownership/ALS fields, `strictTransactions` rejection,
  `requireAfterCommit`/`AfterCommitCapabilityError` preflight, shutdown
  boundary rejection after `close()`, and `$disconnect` on close.
- The after-commit + cache composition runs the real hook queue and drain
  against a `$transaction`-shaped double plus the real `CacheModule` memory
  store, asserting hook-after-commit ordering and cache invalidation.
- **Not proven here:** native Prisma transaction atomicity, rollback, and
  commit observation. That is the package-owned native fixture's scope
  (`packages/prisma/fixtures/after-commit/`, not executed in this track).
- Guide snippets import a real `PrismaClient` from `@prisma/client`; those
  exact snippets were not executed (no generated Prisma client in this
  fixture). The fixture files are the compiled, executed equivalents with the
  client handle injected.

### drizzle

- Database double proves facade forwarding to `current()`, transaction-handle
  identity inside `@Transaction` (captured during the boundary), root-handle
  resolution outside, `DRIZZLE_DATABASE` raw binding, status ownership
  (`externallyManaged: true`), `strictTransactions` throw, `forRootAsync` +
  `ConfigService` composition (real `@fluojs/config`), and drain-before-
  `dispose` ordering.
- after-commit + cache composition as above.
- **Not proven here:** native Drizzle transaction/rollback/commit behavior
  (`packages/drizzle/src/after-commit.test.ts` and the shared native fixture).

### mongoose

- Connection double driven through the wrapper's documented seams
  (`startSession`, delegated `connection.transaction`, `model` factory)
  proves session injection into `create`/`findOne`, session-conflict
  rejection, `saveDocument` inside/outside boundaries, delegated-path
  session identity, fail-open without session support, shutdown abort of
  open request transactions (`Application shutdown interrupted an open
  request transaction.`), session cleanup before `dispose`, and the
  after-commit hook drain after `commit`+`endSession`.
- **Not proven here:** MongoDB server transaction atomicity or failpoints
  (package suite `packages/mongoose/src/after-commit.test.ts` + shared native
  Mongo fixture).

### redis

- Native `redis:7.4-alpine` server proves: bootstrap connect (`status: ready`),
  JSON codec round-trip and null-for-missing, integer-TTL `EX`, fractional-TTL
  `PX` (via `pttl`), omitted-TTL persistence, graceful quit on close (`end`
  status event), distinct named-client identities
  (`getRedisClientToken('analytics')`), and duplicate registration identity
  rejection before client creation.
- **Not exercised:** Sentinel options, pub/sub `duplicate()` pattern, and
  `lifecycle` timeout overrides (documented from `packages/redis/src/service.ts`
  and README; package suite `packages/redis/src/module.test.ts` owns them).

### cache-manager

- Memory paths through the real `CacheModule`/`CacheService`/interceptor:
  remember coalescing (loader runs once), cache-hit taxonomy, reset
  invalidation of in-flight loaders, invalid-TTL skip, `ttl: 0` persistence,
  FIFO atomic `update` admission, pure-reducer retry after a competing write
  (attempts `[1, 2]` → value 11), `unsupported` capability rejection, shutdown
  close semantics (`get` undefined; `update` rejects as `closed`), deterministic
  TTL jitter (`shorten`, ratio 0.5, sample 0.5 → 60 → 45; `0` untouched;
  negative skipped via a recording store), observer taxonomy
  (`remember` miss/hit, `set`/`del` success; `update` silent; observer
  failures contained), and HTTP caching (`@CacheTTL(60)`, cache hit on second
  GET, `@CacheEvict` on POST, route+query canonicalization of repeated values).
- Native Redis composition proves: JSON entry envelope
  (`{value, expiresAt}`) under the configured `keyPrefix`, prefix-scoped
  `reset()` preserving application-owned keys, named-client DI resolution
  (`redis: { clientName: 'cache' }`), remember over Redis, and opt-in
  WATCH-based atomic updates against the native server.
- **Not exercised here:** the 1,000-entry memory bound (verified in
  `packages/cache-manager/src/stores/memory-store.ts` source), `httpKeyStrategy:
  'route'`, `principalScopeResolver`, `@CacheEvict` factory forms, and the
  full Redis WATCH conflict matrix (package-owned native suite
  `packages/cache-manager/test/redis-update.native.test.ts`, not run here).

## Cross-track notes

- `MongooseModule` has no `name` option (single registration), and
  `RedisModule` intentionally has no `forRootAsync` — both verified against
  source and stated as differences in the guides.
- Terminus health fragments follow `packages/terminus/src/types.ts`: indicator
  providers are registered via `TerminusModule.forRoot({ indicatorProviders,
  imports })`; those fragments were not executed in this track.
