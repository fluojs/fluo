# Caching Contract

<p><strong><kbd>English</kbd></strong> <a href="./caching.ko.md"><kbd>한국어</kbd></a></p>

This document defines the current cache contract across `@fluojs/cache-manager`, `@fluojs/http`, and the optional Redis store path.

Package API signatures, essential examples, defaults, and failure codes are owned by the [cache-manager README](../../packages/cache-manager/README.md), including [Atomic Updates](../../packages/cache-manager/README.md#atomic-updates). This architecture document describes their composition rather than a second API authority.

## Module and Store Model

| Surface | Current contract | Source anchor |
| --- | --- | --- |
| Module entrypoint | Applications register cache support through `CacheModule.forRoot(...)`. Public options include `store`, `ttl`, opt-in `ttlJitter`, `httpKeyStrategy`, `principalScopeResolver`, top-level `keyPrefix`, `redis`, opt-in `observer`, and `global`. | `packages/cache-manager/src/types.ts`, `packages/cache-manager/src/module.ts` |
| Async module entrypoint | `CacheModule.forRootAsync({ inject, useFactory, global? })` resolves the same public options through an injected factory and normalizes the result with the `forRoot(...)` defaults. Injected tokens resolve from bootstrap runtime providers or globally visible module exports available to the container that instantiates the module; parent-local providers and ordinary sibling/parent exports are not visible. The factory runs once per registration when cache providers are first resolved, and a rejected factory fails bootstrap without registering partially configured cache providers. Module visibility comes from `global` on the registration call because module metadata is fixed before the factory runs; a `global` value in the factory result is ignored. | `packages/cache-manager/src/types.ts`, `packages/cache-manager/src/module.ts` |
| Cache service | `CacheService` is the direct application cache facade with `get`, `set`, `update`, `remember`, `del`, `reset`, and the public `close()` teardown boundary. | `packages/cache-manager/src/service.ts` |
| HTTP integration | `CacheInterceptor` performs GET read-through caching and consumes `@CacheEvict(...)` metadata after non-GET controller handlers. The decorator does not intercept arbitrary service methods outside that HTTP pipeline. | `packages/cache-manager/src/decorators.ts`, `packages/cache-manager/src/interceptor.ts` |
| Memory store | `MemoryStore` keeps cache entries in-process, sweeps expirations lazily on access, and caps live entries at `1,000` by evicting the oldest keys. | `packages/cache-manager/src/stores/memory-store.ts` |
| Redis store | `RedisStore` stores JSON-serialized entries under a prefixed key space, uses `EX` for ordinary positive-TTL `set` writes and absolute `PXAT` for updates, and resets by scanning the configured prefix. Opt-in atomic mode retains a namespace epoch after reset. | `packages/cache-manager/src/stores/redis-store.ts` |
| Redis client integration | `redis.client` accepts a directly supplied `RedisCompatibleClient` and takes precedence without loading `@fluojs/redis`; the application owns that client's lifecycle. Otherwise the cache module optionally loads `@fluojs/redis` and resolves its default or `redis.clientName` raw-client token. | `packages/cache-manager/src/types.ts`, `packages/cache-manager/src/module.ts` |
| Redis namespace ownership | Top-level `keyPrefix` defaults to `fluo:cache:` and scopes every Redis key plus `reset()` scanning. Redis glob metacharacters in a non-empty prefix are escaped before `SCAN`, so the prefix is matched literally. An empty prefix disables wildcard scanning and limits reset to keys tracked by the current `RedisStore` instance. | `packages/cache-manager/src/module.ts`, `packages/cache-manager/src/stores/redis-store.ts` |

## Cache Key Rules

| Rule | Current contract | Source anchor |
| --- | --- | --- |
| Default key source | When `@CacheKey(...)` is absent, `CacheInterceptor` derives the key from `httpKeyStrategy`. | `packages/cache-manager/src/interceptor.ts`, `packages/cache-manager/src/types.ts` |
| Built-in strategies | Supported strategy values are `'route'`, `'route+query'`, `'full'`, or a custom function. The interceptor code handles `'route'` as path-only and treats non-`'route'` built-ins as path plus sorted query string. | `packages/cache-manager/src/types.ts`, `packages/cache-manager/src/interceptor.ts` |
| Extension path | Applications customize key generation through function-based `httpKeyStrategy` configuration or handler-local `@CacheKey(...)` factories. Subclassing `CacheInterceptor` only to change key generation is not the documented extension path. | `packages/cache-manager/src/types.ts`, `packages/cache-manager/src/decorators.ts`, `packages/cache-manager/README.md` |
| Query normalization | For query-sensitive keys, query entries are sorted by key and repeated values are sorted before serialization so reordered query strings map to the same key. | `packages/cache-manager/src/interceptor.ts` |
| Principal isolation | Built-in key strategies append `|principal:<scope>` when `principalScopeResolver` returns a value. Without a custom resolver, authenticated requests append `issuer` and `subject` from `requestContext.principal`. | `packages/cache-manager/src/interceptor.ts` |
| Explicit override | `@CacheKey(...)` may store a static string, including the empty string, or a resolver function and overrides the computed GET key for that handler. Only absent metadata selects the configured fallback strategy. | `packages/cache-manager/src/decorators.ts`, `packages/cache-manager/src/interceptor.ts` |

## TTL and Write Rules

The jitter and invalid-TTL no-op rules below concern `set` / `remember` writes and HTTP caching. `update` preserves a live entry's absolute expiry when TTL is omitted, uses the module default only for creation, rejects invalid TTL with `RangeError`, and intentionally bypasses jitter. See the API owner for its seconds-to-milliseconds rounding and explicit deletion contract.

| Rule | Current contract | Source anchor |
| --- | --- | --- |
| Default TTL resolution | `CacheService.set(...)` resolves TTL as `ttlSeconds ?? options.ttl`; a per-call TTL therefore takes precedence before jitter is calculated. | `packages/cache-manager/src/service.ts` |
| Opt-in TTL jitter | Only an omitted or `undefined` `ttlJitter` disables jitter; malformed option values fail module registration. `CacheService` applies the configured bounded ratio and direction once to each positive resolved TTL before store handoff. Injected random samples outside the finite `[0, 1]` range reject the write. Every effective TTL remains positive and finite within the selected directional bounds, saturating only at JavaScript's smallest positive or largest finite value. Memory, Redis, and custom stores receive that same effective TTL. | `packages/cache-manager/src/service.ts`, `packages/cache-manager/src/ttl-jitter.ts` |
| Disabled writes | Non-finite TTL values or TTL values below `0` are ignored and produce no cache write. | `packages/cache-manager/src/service.ts` |
| No-expiry entries | `ttl: 0` means no expiration. The memory store omits `expiresAt` for such entries, and the Redis store writes without `EX`. | `packages/cache-manager/src/service.ts`, `packages/cache-manager/src/stores/memory-store.ts`, `packages/cache-manager/src/stores/redis-store.ts` |
| GET-only response caching | `CacheInterceptor` only performs read-through caching for `GET` requests. Non-GET requests skip cache reads and writes. | `packages/cache-manager/src/interceptor.ts` |
| Cacheable response shape | The interceptor caches only replayable successful GET results. It skips caching when the handler returns `undefined`, an `SseResponse`, a non-2xx status, or a response that is already committed. | `packages/cache-manager/src/interceptor.ts` |
| Read-through deduplication | `CacheService.remember(...)` deduplicates concurrent misses per key through an in-flight promise map, scoped to one `CacheService` instance. `CacheInterceptor` does not coalesce concurrent GET misses; each miss invokes the handler. | `packages/cache-manager/src/service.ts`, `packages/cache-manager/src/interceptor.ts` |

## Atomic Update Coordination

`update` is a pure single-key mutation, not origin-load coalescing, a domain transaction, or a distributed lock. Both built-in stores queue updates FIFO per key per store while unrelated keys proceed concurrently. Memory's `local-process` scope is one store instance shared by facades, not all stores in a process. A custom store without optional `atomicUpdate` remains valid but rejects this API as `unsupported`; no read/modify/write fallback is inferred.

Redis requires explicit cache-side `redis.atomicUpdates: true` (or `RedisStoreOptions.atomicUpdates`), a compatible raw client's isolated `duplicate(...)`, Redis >=6.2, and a nonempty application namespace. Standalone/single-primary transactions are supported; Cluster support is not claimed. WATCH observes data, namespace epoch, and key invalidation identity. Ordinary write conflicts can rerun the reducer; deletion/reset/expiry reject stale work. All namespace participants must opt in. Both `del` and an `{ action: 'delete' }` update write a UUID marker and delete data in one transaction even for an absent key. Reset preserves one epoch and SCANs the other namespace keys, including markers. Operation-owned connections disable reconnection: connection loss propagates the client error instead of committing on a replacement connection without WATCH. The shared client retains its reconnection policy.

The API owner lists reserved NUL-prefixed metadata keys and their persistent cost: one epoch after reset and one marker per distinct deleted key until reset. Metadata must not be externally edited or evicted; failover durability is not promised. SCAN reset is not a distributed global snapshot and does not globally fence updates started after a remote reset begins.

The service tracks admitted reducers and queued updates across deletion, reset, and close. Reset/close drain the whole operation and isolated connection cleanup; reducers that ignore cancellation can hold that drain indefinitely. Never await nested same-key updates or reset/close inside a reducer. Updates racing reset can reject as `invalidated`; start fresh after awaiting reset. Pre-dispatch abort blocks a commit, but cancellation after Redis EXEC dispatch cannot undo a committed transaction. Await completion; `del` still orders invalidation safely.

Custom capability implementations register invalidation synchronously and await optional `CacheStoreUpdateOptions.admission` before I/O/reducer work. Cache-manager owns and disconnects isolated transaction clients; the shared raw ioredis client remains owned by [`@fluojs/redis`](../../packages/redis/README.md#raw-client-access) or the application. This does not change `remember` loader-coalescing scope or the Redis package's runtime API.

Evidence: [update types](../../packages/cache-manager/src/atomic-update.ts), [service lifecycle](../../packages/cache-manager/src/service.ts), [memory](../../packages/cache-manager/src/stores/memory-store.ts), [Redis](../../packages/cache-manager/src/stores/redis-store.ts), [unit/lifecycle tests](../../packages/cache-manager/src/cache-update.test.ts), [application consumer](../../packages/cache-manager/src/cache-update.consumer.test.ts), and [native Redis tests](../../packages/cache-manager/test/redis-update.native.test.ts). The [API owner's commands](../../packages/cache-manager/README.md#atomic-updates) distinguish workspace tests from the Docker `redis:7.4-alpine` suite; links are not execution receipts.

## Invalidation Rules

| Rule | Current contract | Source anchor |
| --- | --- | --- |
| Decorator path | `@CacheEvict(...)` stores one key, a key list, or a resolver function as HTTP route metadata. Only `CacheInterceptor` consumes that metadata on non-GET controller handlers; service methods and other non-HTTP call paths must invalidate through `CacheService.del(...)` or another explicit application path. | `packages/cache-manager/src/decorators.ts`, `packages/cache-manager/src/interceptor.ts` |
| Eviction timing | For non-GET handlers, eviction runs only after the downstream handler succeeds and a response writer confirms commit. A rejected writer, a writer that settles without confirmed commit, or request abort before commit cancels deferred eviction; shutdown and disconnect therefore preserve the previous cached read. Adapter paths that commit without invoking `response.send(...)` retain a bounded five-second fallback, but it evicts only when `response.committed` already confirms commit at the deadline. An unconfirmed response is cancelled instead, so elapsed time alone cannot evict before a later failed commit. The fallback timer is unreferenced on Node.js and cleared when a writer settles. | `packages/cache-manager/src/interceptor.ts`, `packages/cache-manager/src/deferred-eviction.ts` |
| Failure containment | `safeGet`, `safeSet`, and `safeDel` swallow store errors. Cache failures do not fail otherwise successful handlers. | `packages/cache-manager/src/interceptor.ts` |
| In-flight invalidation | `CacheService.del(...)` marks keys that are still loading so `remember(...)` does not repopulate a key that was invalidated during the same load cycle. | `packages/cache-manager/src/service.ts` |
| Store operation concurrency | Ordinary `get`, `set`, and `del` store calls run concurrently, so a slow store call for one key does not delay unrelated keys. `reset()` and store teardown run exclusively: they hold back later store calls, wait for already-started calls to settle, and then run alone. | `packages/cache-manager/src/store-operation-scheduler.ts`, `packages/cache-manager/src/service.ts` |
| Full reset | `CacheService.reset()` increments an internal reset version, clears in-flight and pending load bookkeeping, clears in-flight invalidation markers, and resets the underlying store. | `packages/cache-manager/src/service.ts` |
| Store teardown | During application shutdown, `CacheService` calls a custom store `close()` hook, or `dispose()` when `close()` is absent, so resource-owning stores can release sockets, pools, timers, or other external handles. Concurrent and repeated service or lifecycle close calls share the first teardown promise, including its failure, so teardown runs once behind one authoritative completion boundary. | `packages/cache-manager/src/types.ts`, `packages/cache-manager/src/service.ts` |
| Teardown ownership diagnostics | `createCacheManagerPlatformStatusSnapshot(...)` resolves `storeOwnershipMode` from teardown responsibility, not from store category alone. Memory and custom stores default to `framework` because `CacheService` owns their lifecycle teardown dispatch. Redis remains `external` to `CacheService`: `@fluojs/redis` owns the lifecycle of a client resolved through that integration, while the application owns a client supplied directly through `redis.client`. An explicit `storeOwnershipMode` overrides the store default. | `packages/cache-manager/src/status.ts`, `packages/cache-manager/src/service.ts` |

## Observation Rules

`update` emits no existing `CacheObservation` events. The taxonomy below remains unchanged; update failures still reach the direct caller.

| Rule | Current contract | Source anchor |
| --- | --- | --- |
| Opt-in seam | Cache operation observation is disabled unless `CacheModule.forRoot(...)` receives an `observer`. Without it, `CacheService` runs its original path with no observation work. | `packages/cache-manager/src/types.ts`, `packages/cache-manager/src/module.ts`, `packages/cache-manager/src/service.ts` |
| Privacy boundary | A `CacheObservation` carries only `operation`, `outcome`, and `durationMs`. Cache keys, cached values, loader results, and error objects are never passed to the observer. | `packages/cache-manager/src/types.ts`, `packages/cache-manager/src/service.ts` |
| Operation taxonomy | `operation` is one of `get`, `set`, `del`, `remember`, `reset`, or `close`. `remember` reports once per call; its internal read is not reported as a separate `get`. | `packages/cache-manager/src/service.ts` |
| Outcome classification | `CacheObservation` is a discriminated union that permits `get` and `remember` to report only `hit`, `miss`, or `error`, and permits `set`, `del`, `reset`, and `close` to report only `success` or `error`. A `remember` call that joins an in-flight load reports `miss`. | `packages/cache-manager/src/types.ts`, `packages/cache-manager/src/service.ts` |
| Timing | `durationMs` covers the full `CacheService` operation, including store-queue serialization, measured with the runtime's monotonic `performance.now()` clock. | `packages/cache-manager/src/service.ts` |
| Failure containment | Observer errors are swallowed. A thrown error or rejected promise never changes the cache result and never surfaces as an unhandled rejection; observer work is not awaited by the cache operation. | `packages/cache-manager/src/service.ts` |
| HTTP fail-soft interaction | `CacheInterceptor` still swallows store failures, so cache errors cannot fail an otherwise successful handler. Those failures remain visible to operators as `error` observations. | `packages/cache-manager/src/interceptor.ts`, `packages/cache-manager/src/service.ts` |
| Metrics independence | The observer is independent of `@fluojs/metrics`. Applications adapt observations to whichever metrics backend they already run. | `packages/cache-manager/README.md` |

## Constraints

- The built-in memory store is process-local and not cluster-safe. Multi-instance deployments require the Redis store or another shared custom store.
- `@fluojs/redis` is optional for the Redis store when `redis.client` supplies a compatible client directly. Direct clients are application-owned and must be started and closed by the application.
- Redis-backed values must be JSON-compatible because `RedisStore` persists entries with `JSON.stringify(...)` and reconstructs them with `JSON.parse(...)`.
- Cache invalidation is key-based only. The built-in contract does not provide tag-based or wildcard invalidation at the interceptor layer.
- Cache TTL enforcement in the memory store is lazy and access-driven, not timer-driven.
- TTL jitter spreads positive expiry times only. It does not provide distributed locking, refresh-ahead caching, or cross-instance stampede coordination; `ttl: 0` and invalid TTL meanings are preserved.
- Cache observation is operation-level only. The contract does not expose per-key metrics, cardinality-bearing labels, or store-internal counters.
- The cache package defines extensibility through the `CacheStore` interface. Custom stores must implement `get`, `set`, `del`, and `reset`; resource-owning stores should also implement optional `close()` or `dispose()` teardown.
