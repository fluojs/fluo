# @fluojs/cache-manager

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

General-purpose cache manager for fluo with pluggable memory, Redis, and custom store adapters. Provides both decorator-driven HTTP response caching and a standalone cache API for application-level caching.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
  - [HTTP Response Caching](#http-response-caching)
  - [Application-Level Caching](#application-level-caching)
- [Common Patterns](#common-patterns)
  - [Redis Storage](#redis-storage)
  - [Atomic Updates](#atomic-updates)
  - [TTL Jitter](#ttl-jitter)
  - [Query-Sensitive Caching](#query-sensitive-caching)
  - [Cache Ownership and Reset Scope](#cache-ownership-and-reset-scope)
  - [Observing Cache Operations](#observing-cache-operations)
  - [Async Configuration](#async-configuration)
  - [Manual Module Composition](#manual-module-composition)
  - [NestJS Cache Migration](#nestjs-cache-migration)
- [Public API Overview](#public-api-overview)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @fluojs/cache-manager
```

`@fluojs/cache-manager` supports Node.js `>=24.0.0 <27` and declares that exact range through `engines.node`. That package-owned support contract means Node versions below 24 and Node 27+ are excluded. Earlier 1.x releases advertised `engines.node >=20.0.0`, which never matched the effective dependency floor.

The root `@fluojs/cache-manager` import stays safe for memory-only installs. You only need a Redis client when you explicitly select the Redis-backed store path.

For Redis-backed caching with a lifecycle-managed `@fluojs/redis` client:

```bash
npm install @fluojs/cache-manager @fluojs/redis ioredis
```

You can instead pass an application-owned compatible client through `redis.client`. That path does not require `@fluojs/redis`; install whichever client package provides the required `get`, `set`, `del`, and tuple-returning `scan` operations, and close that client from the application lifecycle.

## When to Use

- When you want to cache expensive database queries or external API responses.
- When you need to improve HTTP performance by caching GET responses.
- When you need to share cache state across multiple instances (using Redis).
- When you need a simple "remember" pattern (fetch if missing, then cache).

## Quick Start

### HTTP Response Caching

Register the `CacheModule` and use the `CacheInterceptor` on your controllers.

The built-in memory path is intentionally bounded by default: when you omit `ttl`, fluo applies a 300-second default TTL and keeps at most 1,000 live memory-store entries before evicting the oldest keys.

```typescript
import { Module } from '@fluojs/core';
import { Controller, Get, UseInterceptors } from '@fluojs/http';
import { CacheModule, CacheInterceptor, CacheTTL } from '@fluojs/cache-manager';

@Controller('/products')
class ProductController {
  @Get('/')
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(60) // Cache for 60 seconds
  list() {
    return [{ id: 1, name: 'Product A' }];
  }
}

@Module({
  imports: [CacheModule.forRoot({ store: 'memory' })],
  controllers: [ProductController],
})
class AppModule {}
```

### Application-Level Caching

Inject `CacheService` to manage cache programmatically.

```typescript
import { Inject } from '@fluojs/core';
import { CacheService } from '@fluojs/cache-manager';

@Inject(CacheService)
class UserService {
  constructor(private readonly cache: CacheService) {}

  async getProfile(userId: string) {
    return this.cache.remember(`user:${userId}`, async () => {
      // This runs only if the key is missing from cache
      return fetchUserProfile(userId);
    }, 300); // 5 minutes
  }
}
```

## Common Patterns

### Redis Storage

Set `store: 'redis'`, then choose one of two supported client integration paths:

1. Register a default or named raw client with `@fluojs/redis` and let the cache module resolve it through DI.
2. Pass an application-owned `RedisCompatibleClient` directly through `redis.client`.

Memory-only consumers can keep importing from `@fluojs/cache-manager` without installing `@fluojs/redis` or `ioredis`; those optional peers are resolved only when the Redis store path is selected.

```typescript
import { Module } from '@fluojs/core';
import { CacheModule } from '@fluojs/cache-manager';
import { RedisModule } from '@fluojs/redis';

@Module({
  imports: [
    RedisModule.forRoot({ name: 'cache', host: 'localhost', port: 6379 }),
    CacheModule.forRoot({
      store: 'redis',
      ttl: 600,
      keyPrefix: 'myapp:cache:',
      redis: { clientName: 'cache' },
    }),
  ],
})
class AppModule {}
```

If you registered multiple Redis clients, set `redis.clientName` to target a named `@fluojs/redis` connection.

Leave `redis.clientName` unset to keep using the default Redis client resolved through `REDIS_CLIENT`.

```typescript
CacheModule.forRoot({
  store: 'redis',
  redis: { clientName: 'cache' },
})
```

`redis.client` is the highest-precedence override and bypasses DI-based client selection entirely. It accepts any client that satisfies the exported `RedisCompatibleClient` contract; `@fluojs/redis` is not loaded or required on this path. The application owns connection startup and shutdown for a directly supplied client.

```typescript
import Redis from 'ioredis';
import { Module } from '@fluojs/core';
import { CacheModule } from '@fluojs/cache-manager';

const cacheClient = new Redis({ host: 'localhost', port: 6379 });

@Module({
  imports: [
    CacheModule.forRoot({
      store: 'redis',
      keyPrefix: 'myapp:cache:',
      redis: { client: cacheClient },
    }),
  ],
})
class AppModule {}
```

The built-in `RedisStore` persists entries with `JSON.stringify(...)`. Cache values therefore need to be JSON-compatible: plain objects, arrays, strings, numbers, booleans, and `null` round-trip cleanly, while values such as `Date` come back as JSON output (for example ISO strings), functions/`undefined`/symbols do not survive, and non-serializable values like `bigint` or cyclic graphs should be normalized before caching.

For ordinary `set` writes, positive Redis TTL values are accepted in seconds and may be fractional. Redis expiry is rounded up to the next whole second because Redis `EX` uses integer seconds, while fluo also records the millisecond-precision expiry timestamp in the stored entry and treats the value as expired once that timestamp is reached. Use `ttl: 0` when you intentionally want no Redis expiry. Atomic updates use absolute `PXAT` expiry instead, as described below.
Exceptionally large finite TTL values are capped at the largest safe JavaScript expiry timestamp by both built-in stores, so Redis JSON metadata remains finite and aligns with the memory path.

Redis reset ownership is scoped by the top-level `keyPrefix` option, which defaults to `fluo:cache:` and is passed through to the built-in `RedisStore` namespace. `CacheService.reset()` deletes only keys under that prefix for Redis-backed stores, so application-owned Redis data outside the cache prefix is preserved. Redis glob metacharacters in a non-empty prefix (`*`, `?`, `[`, `]`, and `\`) are escaped before `SCAN`, so the configured prefix remains a literal namespace instead of broadening reset ownership. If you intentionally configure an empty `keyPrefix`, reset is limited to keys written by the current `RedisStore` instance instead of scanning `*`; use a non-empty, application-specific prefix when you need reset to cover cache entries across restarts or multiple processes.

### Atomic Updates

This section owns the additive `CacheService.update` contract. Use it to replace application-owned per-key promise queues around cache read/modify/write, not to perform database transactions, origin loading, or domain-policy enforcement. `remember()` remains the read-through loader API; its miss coalescing is not an atomic mutation.

| Field | Contract |
| --- | --- |
| Input | `cache.update<T>(key, reducer, { signal?, maxAttempts? })`. The reducer receives a detached `T` snapshot, or `undefined` for a missing/expired entry, and `{ attempt, signal }`. `attempt` is one-based; `signal` combines caller cancellation with invalidation/shutdown. |
| Decision | Return `{ action: 'set', value, ttlSeconds? }` or `{ action: 'delete' }`, synchronously or asynchronously. Deletion is explicit; do not use an undefined value or invalid TTL as a deletion request. Values must satisfy the selected store's serialization contract. |
| Default | `maxAttempts` is `16`, including the first attempt, and must be a positive safe integer. The module TTL applies only when creating a missing/expired entry: by default `300` seconds for memory, `0` for Redis/custom stores. |
| Output | `Promise<T \| undefined>` resolves with the committed value or `undefined` after explicit deletion, not merely after the reducer returns. |
| Capability | `CacheStore.atomicUpdate` is optional. Legacy stores still support their existing operations; an absent capability rejects with `CacheUpdateError` code `unsupported`, with no non-atomic `get`/`set` fallback. |
| Scope and order | Both built-in stores admit updates FIFO per key within one store instance; independent keys run concurrently. Memory's `atomicUpdate.scope === 'local-process'` covers one `MemoryStore` shared across facades, not separate store instances. Opt-in Redis uses server-side transactions across participating clients, not a global FIFO across processes. |

The reducer must be pure: ordinary competing writes can cause it to run again with a fresh snapshot. Do not perform I/O, send messages, or apply external side effects inside it. Do not nest a same-key update, or await `cache.reset()` / `cache.close()` from the reducer: the queue or lifecycle drain would wait on that same reducer and deadlock.

This standalone consumer uses public imports and a registered application context; no application key queue is needed. The arithmetic is example application logic, not a framework rate-limit or lockout policy.

```typescript
import { Inject } from '@fluojs/core';
import { defineModule, FluoFactory } from '@fluojs/runtime';
import { CacheModule, CacheService } from '@fluojs/cache-manager';

@Inject(CacheService)
class Counters {
  constructor(private readonly cache: CacheService) {}

  increment(key: string) {
    return this.cache.update<number>(key, (value) => ({
      action: 'set',
      value: (value ?? 0) + 1,
    }));
  }
}

class AppModule {}
defineModule(AppModule, {
  imports: [CacheModule.forRoot({ store: 'memory', ttl: 60 })],
  providers: [Counters],
});

const app = await FluoFactory.createApplicationContext(AppModule);
try {
  const counters = await app.get(Counters);
  const values = await Promise.all([
    counters.increment('example:counter'),
    counters.increment('example:counter'),
  ]);
  console.log(values); // [1, 2]
} finally {
  await app.close();
}
```

**TTL:** All update TTLs are seconds. Omitting `ttlSeconds` on a live entry preserves its absolute expiry, including persistence; it does not restart a sliding window. On creation, omission uses the module default. An explicit positive TTL uses `ceil(seconds * 1000)`, at least one millisecond, capped at `Number.MAX_SAFE_INTEGER` for the absolute expiry timestamp. `0` means persistent; `{ action: 'delete' }` deletes. Negative or non-finite TTLs reject with `RangeError`. Update TTLs intentionally bypass `ttlJitter` so retry decisions remain pure and deterministic and a fixed expiry is not extended. The existing invalid-TTL no-op for `set` / `remember` writes is unchanged.

**Failures:** Import `CacheUpdateError` from `@fluojs/cache-manager` and branch on `error.code`: `unsupported` (no capability), `invalidated` (deletion/reset/expiry invalidates the snapshot), `closed` (service shutdown), `cancelled` (caller abort), or `conflict` (attempt budget exhausted). An invalid attempt limit also rejects with `RangeError`. Reducer, store, and serialization failures propagate unchanged; they are not retried as conflicts or wrapped in `CacheUpdateError`.

**Cancellation and drain:** The service tracks all admitted updates, including queued work. `del`, `reset`, and `close` cancel affected late reducers. Reset and close wait for full reducer/queued-update settlement and isolated connection cleanup, not just store calls. Cancellation is cooperative: a reducer that ignores its signal and never settles can hold drain indefinitely; there is no forced termination. Updates started during reset may reject as `invalidated`; await reset before starting fresh work. An abort before commit dispatch prevents the commit. Once Redis `EXEC` has been dispatched, cancellation cannot undo a committed transaction: await its completion rather than assuming rollback. `del` still orders server-side invalidation safely.

**Redis opt-in and ownership:** Prefer the named `RedisModule` DI registration in [Redis Storage](#redis-storage), then explicitly enable the capability:

```typescript
CacheModule.forRoot({
  store: 'redis',
  keyPrefix: 'myapp:cache:',
  redis: { clientName: 'cache', atomicUpdates: true },
});
```

Direct `RedisStore` composition uses `RedisStoreOptions.atomicUpdates: true`. A compatible client must support `duplicate({ lazyConnect: false })`, returning the exported structural `RedisAtomicClient` seam (`watch`, `get`, `multi`, `disconnect`); `multi()` returns `RedisAtomicTransaction` (`set`, `del`, `exec`). These optional types belong to `@fluojs/cache-manager`. The full raw ioredis client already exposed by [`@fluojs/redis`](../redis/README.md#raw-client-access) supplies this seam; no RedisService runtime API is added. Each atomic operation owns its isolated duplicate and disconnects it in `finally`, releasing WATCH even on failure. The injected/shared client remains owned by its Redis module or application and is not closed by the cache.

The new `RedisAtomicClient` seam is compatible with actual ioredis, but that is not a claim that a raw ioredis instance is structurally assignable to the older, full `RedisCompatibleClient` type. Its existing `scan(cursor, ...args: Array<string | number>)` signature differs from ioredis's overloads. That public contract is unchanged; use the canonical RedisModule DI path for the example and native fixture rather than casting away this mismatch.

Use Redis **6.2 or newer** for `PXAT`, standalone/single-primary transactions, and a nonempty application-specific prefix. An empty prefix rejects with `RangeError`; a client without `duplicate` rejects as `unsupported`. Redis Cluster support is not claimed: data, epoch, and marker keys would cross slots unless the entire namespace prefix used the same hash tag, and that condition alone is not a Cluster support guarantee.

Every participant in a namespace must opt in for invalidation-identity guarantees. WATCH covers the data key, a namespace epoch, and a per-key invalidation identity. Ordinary concurrent updates/writes can retry a fresh pure reducer; deletion, reset, and expiry invalidate stale work instead of retrying it. `del` transactionally SETs a fresh UUID generation and DELetes the data even when that key was absent, detecting delete/recreate races. Reset replaces the namespace epoch and SCANs other namespace keys, including per-key markers, while retaining the epoch.

The reserved logical keys are exactly `'\0atomic-update-epoch'` and every key starting with `'\0atomic-update-key:'`; `\0` denotes a NUL character. They are not application data. Budget for one persistent epoch key after reset and one persistent marker per distinct `del` key until reset. Do not externally edit or evict this metadata. There is no failover durability promise. SCAN-based reset is not a distributed global snapshot: updates admitted after a remote reset begins are not globally fenced.

**Custom capability implementers:** Exported `CacheAtomicUpdate`, `CacheStoreUpdateOptions`, `CacheUpdateReducer`, `CacheUpdateContext`, `CacheUpdate`, and `CacheUpdateOptions` describe the handoff. Register invalidation synchronously when `atomicUpdate.update` is called, then await optional `options.admission` before any I/O or reducer execution. Honor cancellation and the attempt bound; apply `defaultTtlSeconds` only to new entries, with an omitted direct-store default meaning persistence. A distributed capability requires a real server atomic primitive. The built-in MemoryStore also invalidates updates on direct-store `del` / `reset`, not just facade calls.

**Observation and evidence:** `update` emits no existing `CacheObservation` events; the observer taxonomy remains unchanged. See [the shared caching architecture](../../docs/architecture/caching.md), [update types and TTL logic](./src/atomic-update.ts), [service admission/drain](./src/service.ts), [memory implementation](./src/stores/memory-store.ts), [Redis implementation](./src/stores/redis-store.ts), and [public exports](./src/index.ts). Evidence targets are [unit/lifecycle tests](./src/cache-update.test.ts), [the queue-free application consumer](./src/cache-update.consumer.test.ts), and [native Redis tests](./test/redis-update.native.test.ts).

From an already installed repository workspace, build the package and its dependency closure to emit the modules required by the tests, then run the focused files and native suite:

```bash
pnpm --filter '@fluojs/cache-manager...' build
pnpm --dir packages/cache-manager exec vitest run -c vitest.config.ts src/cache-update.test.ts src/cache-update.consumer.test.ts
pnpm --filter @fluojs/cache-manager test:redis
```

The native suite needs Docker and `redis:7.4-alpine`; it creates an isolated container with an ephemeral local port and fails rather than skipping when the fixture is unavailable.

### TTL Jitter

Popular keys written together can otherwise expire together and synchronize origin load. Opt in to centralized positive-TTL jitter with `ttlJitter`; `CacheService` calculates the effective TTL once before handing a `set` / `remember` write to memory, Redis, or a custom store. `update` intentionally does not apply jitter.

```typescript
CacheModule.forRoot({
  store: 'redis',
  ttl: 600,
  ttlJitter: {
    ratio: 0.1,
    mode: 'symmetric',
  },
});
```

`ratio` must be greater than `0` and at most `1`. The default `symmetric` mode samples within `ttl ± (ttl * ratio)`; `shorten` only subtracts from the TTL and `lengthen` only adds to it. A `CacheService.set(...)` or `remember(...)` per-call TTL override is jittered instead of the module default. `ttl: 0` remains a no-expiry write, and negative or non-finite TTL values still skip the write.

Jitter is disabled only when `ttlJitter` is omitted or `undefined`; `null`, primitives, arrays, and invalid option fields are rejected during module registration. The optional `random` function is a deterministic test seam and must return a finite value in `[0, 1]`; an invalid sample rejects the write instead of being coerced. Production code should normally keep the default `Math.random`.

Every jittered positive TTL remains positive and finite within its selected direction. A fully shortened TTL uses JavaScript's smallest positive finite value rather than becoming the no-expiry sentinel, while an upward result beyond the representable range saturates at `Number.MAX_VALUE`. TTL jitter spreads expiry times only. It is not distributed locking, refresh-ahead caching, or cross-instance stampede coordination.

### Query-Sensitive Caching

Built-in HTTP cache key strategies derive their path segment from the concrete request path (`requestContext.request.path`), not the route template metadata. That means requests such as `/users/1` and `/users/2` always resolve to different cache keys even when they hit the same `@Get('/:id')` handler.

By default, anonymous requests use the concrete request path and ignore query parameters. Authenticated requests append a principal scope when one is available; use `principalScopeResolver` to customize that suffix. Enable `httpKeyStrategy: 'route+query'` (or `full`, which is equivalent for the built-in strategy set) to cache different responses for different search parameters. Query-aware keys canonicalize both parameter names and repeated values, so `/products?tag=a&tag=b` and `/products?tag=b&tag=a` share one cache entry.

```typescript
CacheModule.forRoot({
  store: 'memory',
  httpKeyStrategy: 'route+query',
})
```

For fully custom keying, pass a function as `httpKeyStrategy` or use `@CacheKey(...)` with either a literal key or a key factory. An empty literal `@CacheKey('')` remains an explicit key; only absent decorator metadata selects the configured `httpKeyStrategy`. These function-based hooks are the supported extension path for request-aware keys; do not subclass `CacheInterceptor` just to replace cache-key generation.

```typescript
CacheModule.forRoot({
  store: 'memory',
  httpKeyStrategy: (context) => {
    const path = context.requestContext.request.path;
    const query = context.requestContext.request.query;
    const q = String(query.q ?? '').trim().toLowerCase();

    return q ? `${path}?q=${encodeURIComponent(q)}` : path;
  },
})
```

Handler-level keys can stay local to the route when only one endpoint needs custom behavior:

```typescript
@CacheKey((context) => {
  const tenant = context.requestContext.principal?.subject ?? 'anonymous';
  const slug = String(context.requestContext.request.query.slug ?? 'index');

  return `tenant:${tenant}:page:${slug}`;
})
```

The HTTP interceptor caches only successful, uncommitted GET handler results with a value that can be replayed later. It skips `undefined`, `SseResponse` streams, already committed responses, and responses whose status code is outside the `2xx` range, so redirects and error responses are not stored as cache hits.

### Cache Ownership and Reset Scope

Ordinary `get(...)`, `set(...)`, and `del(...)` calls run concurrently against the configured store, so a slow store call for one key does not delay unrelated keys.

`CacheService.reset()` clears entries owned by the configured store, not unrelated application state. It also serializes store reads/writes across the reset boundary and invalidates in-flight `remember(...)` loaders so loaders that started before the reset cannot repopulate stale entries after the reset completes. For the built-in memory store that means the in-process entries held by that store instance. For Redis, ownership is the configured `keyPrefix` namespace; keep the default `fluo:cache:` or choose a dedicated prefix such as `myapp:cache:` for shared Redis deployments.

```typescript
CacheModule.forRoot({
  store: 'redis',
  keyPrefix: 'myapp:cache:',
})
```

Avoid sharing a Redis cache prefix with non-cache data. `del(key)` removes the exact cache key resolved by this package, while `reset()` removes only the store-owned cache namespace described above.

When the application closes, `CacheService` stops new store reads/writes, waits for already-started store operations, and then forwards shutdown to custom stores that expose `close()` or `dispose()`. Concurrent and repeated `close()` or lifecycle-hook calls share that first teardown completion and failure, so every caller observes the same shutdown boundary while store teardown runs once. Use one of those optional hooks when a store owns sockets, pools, timers, or other external resources.

Custom stores can be passed directly through `store` when they implement the `CacheStore` contract. This is the right option for in-process LRU stores, remote caches other than Redis, or test doubles that need to observe cache operations.

### Observing Cache Operations

The platform status helpers report cache availability only. To measure hit rate, latency, and error outcomes, pass an opt-in `observer` to `CacheModule.forRoot(...)`. The observer is independent of `@fluojs/metrics`; wire it to whichever metrics backend the application already uses.

```typescript
import { CacheModule, type CacheObservation } from '@fluojs/cache-manager';

CacheModule.forRoot({
  store: 'memory',
  observer: {
    onCacheOperation(observation: CacheObservation) {
      cacheOperationCounter.inc({
        operation: observation.operation,
        outcome: observation.outcome,
      });
      cacheOperationLatency.observe(observation.durationMs);
    },
  },
});
```

The contract is intentionally narrow:

- **Privacy**: an observation carries only `operation`, `outcome`, and `durationMs`. Cache keys, cached values, loader results, and error objects are never passed to the observer, so instrumentation cannot leak application data.
- **Operation taxonomy**: `operation` is one of `get`, `set`, `del`, `remember`, `reset`, or `close`. `remember` is reported once per call; its internal read is not reported as a separate `get`. `update` does not emit these observations.
- **Outcomes**: `CacheObservation` is a discriminated union: read operations (`get`, `remember`) can report only `hit`, `miss`, or `error`, while write, invalidation, and lifecycle operations can report only `success` or `error`. A `remember` call that joins an in-flight load for the same key reports `miss`, because that call did not read a cached value.
- **Timing**: `durationMs` measures the full `CacheService` operation, including store-queue serialization, with the runtime's monotonic `performance.now()` clock.
- **Failure containment**: observer errors are swallowed. A thrown error or a rejected promise never changes the value the caller receives and never surfaces as an unhandled rejection. Observer work is not awaited by the cache operation.
- **HTTP fail-soft interaction**: `CacheInterceptor` still swallows store failures so cache problems cannot fail an otherwise successful handler. The observer sees those failures as `error` observations, which is the supported way to alert on a degraded cache while keeping requests served.

When no `observer` is configured, the cache runs its original code path with no observation work.
Lifecycle diagnostics report the same teardown owner that shutdown actually uses. `createCacheManagerPlatformStatusSnapshot(...)` resolves ownership from lifecycle responsibility rather than treating every non-memory store alike:

- The built-in memory store is `framework`-owned because the framework creates and holds it in-process.
- A custom store is `framework`-owned by default because `CacheService.close()` owns teardown dispatch to its optional `close()` or `dispose()` hook.
- The Redis store is `external` to `CacheService`, which never closes the client. When the cache module resolves a client through `@fluojs/redis`, that integration owns its lifecycle; when `redis.client` supplies a client directly, the application owns its lifecycle.

An explicit `storeOwnershipMode` still wins over the store default. Set it to `external` when the application intentionally retains lifecycle responsibility for a custom store.

### Async Configuration

Use `CacheModule.forRootAsync(...)` when the final store, TTL, `keyPrefix`, or key strategy must come from DI or asynchronous bootstrap work. List the dependency tokens in `inject`, return ordinary `CacheModuleOptions` from `useFactory`, and the module normalizes that result with the same defaults as `CacheModule.forRoot(...)`.

```typescript
import { Module } from '@fluojs/core';
import { CacheModule } from '@fluojs/cache-manager';

import { CacheSettingsService } from './cache-settings.service';

@Module({
  imports: [
    CacheModule.forRootAsync({
      inject: [CacheSettingsService],
      useFactory: async (settings: CacheSettingsService) => ({
        store: 'redis',
        ttl: await settings.resolveTtlSeconds(),
        keyPrefix: settings.keyPrefix,
        redis: { clientName: 'cache' },
      }),
    }),
  ],
})
class AppModule {}
```

Injected tokens must be visible to the container that instantiates the cache module. Provide them as bootstrap runtime providers or export them from a globally visible imported module before the cache options provider resolves. A provider local only to the importing parent module, or an ordinary sibling/parent export, is not visible to the async cache module. The factory runs once per registration when cache providers are first resolved, and a rejected factory fails bootstrap instead of registering a partially configured cache.

Module visibility stays on the registration call: pass `global: true` to `CacheModule.forRootAsync({ global: true, ... })`. `useFactory` may return a prepared `CacheModuleOptions` value, including its `global` property; any returned `global` is ignored because module metadata is fixed before the factory runs.

```typescript
CacheModule.forRootAsync({
  global: true,
  inject: [CacheSettingsService],
  useFactory: (settings: CacheSettingsService) => ({ store: settings.store }),
})
```

The async path supports the same store selection as `forRoot(...)`: `'memory'`, `'redis'` with a DI-resolved or directly supplied client, and any custom `CacheStore` instance.

### Manual Module Composition

Use `CacheModule.forRoot(...)` for normal application setup, including custom `defineModule(...)` composition.

```typescript
import { defineModule } from '@fluojs/runtime';
import { CacheInterceptor, CacheModule, CacheService } from '@fluojs/cache-manager';

class ManualCacheModule {}

defineModule(ManualCacheModule, {
  exports: [CacheService, CacheInterceptor],
  imports: [CacheModule.forRoot({ store: 'memory', ttl: 60 })],
});
```

### NestJS Cache Migration

`@nestjs/cache-manager` and `@fluojs/cache-manager` expose overlapping cache concepts, but their option names, units, defaults, and ownership do not all carry over. Convert each of the following, and see [NestJS → fluo Migration Map](../../docs/getting-started/migrate-from-nestjs.md) for the full migration contract.

| NestJS option or decorator | fluo equivalent | Conversion rule |
| --- | --- | --- |
| `ttl` when the installed underlying `cache-manager` generation uses milliseconds | `ttl` in seconds | Inspect the installed underlying `cache-manager` dependency/version. Divide by 1000 only when that generation defines TTLs in milliseconds. Omitting `ttl` applies `300` seconds on the memory path and `0` for the `redis` and custom-store paths. |
| `ttl: 0` | `ttl: 0` | Means no expiry, not "do not cache". Negative or non-finite values are invalid: `CacheService.set(...)` drops the write, and `CacheInterceptor` skips both the cache read and write for that handler. |
| `@CacheTTL(...)` | `@CacheTTL(ttlSeconds: number)` | Accepts one static number only. Move per-request lifetimes to `CacheService.set(key, value, ttlSeconds)`. |
| implicit query-sensitive keys | `httpKeyStrategy` | Defaults to path-only `'route'`. Select `'route+query'` (or `'full'`), a function strategy, or `@CacheKey(...)` when a response varies by query parameters. |
| `isGlobal: true` | `global: true` | Both NestJS `isGlobal` and fluo `global` default to `false`, so both cache modules are module-local unless you opt in or import the module everywhere it is resolved. |
| NestJS store adapters such as `cache-manager-redis-store` | `store: 'redis'` or a `CacheStore` object | NestJS adapters do not satisfy the `CacheStore` contract; use the built-in Redis path or wrap the adapter so callback/options completion becomes a Promise, `ttlSeconds` maps to the legacy TTL in seconds, and `reset()` clears only the cache namespace. Never forward `reset()` blindly to a whole-database `flushDb`. |
| adapter-owned client teardown | `close()` / `dispose()` on the store | Application shutdown forwards teardown only to those optional hooks. A raw client passed through `redis.client` stays application-owned and must be closed from the application lifecycle. |

```typescript
CacheModule.forRoot({
  // If the installed underlying cache-manager generation uses milliseconds,
  // NestJS `ttl: 60_000` becomes 60 seconds.
  ttl: 60,
  // NestJS `isGlobal: true` becomes `global: true`.
  global: true,
  // Opt in explicitly when responses vary by query parameters.
  httpKeyStrategy: 'route+query',
  store: 'redis',
})
```

### Memory Store Operational Limits

The built-in memory store is designed for single-process, bounded caching:

- If you omit `ttl` on the default memory path, `CacheModule.forRoot()` uses a 300-second TTL.
- `ttl: 0` is still supported for no-expiry entries, but the memory store keeps only the most recent 1,000 live keys.
- High-cardinality or multi-instance deployments should use the Redis store instead of relying on process-local memory.

### Deferred eviction timing

`@CacheEvict(...)` is HTTP route metadata, not a general service-method decorator. `CacheInterceptor` consumes it only when that interceptor runs around a non-GET controller handler. For service methods and other calls outside the HTTP interceptor pipeline, inject `CacheService` and call `del(...)` explicitly.

```typescript
import { CacheEvict, CacheInterceptor } from '@fluojs/cache-manager';
import { Controller, Post, UseInterceptors } from '@fluojs/http';

@Controller('/products')
@UseInterceptors(CacheInterceptor)
class ProductController {
  @Post('/refresh')
  @CacheEvict('/products')
  refresh() {
    return { refreshed: true };
  }
}
```

On that supported HTTP path, eviction is deferred until a framework response writer settles successfully and the response reports that it committed. If a writer rejects, settles without a confirmed commit, or the request aborts before commit because of disconnect or shutdown, deferred eviction is cancelled so the previous cached read result remains available. Adapter paths that commit without invoking `response.send(...)` retain the bounded five-second fallback: it evicts only when `response.committed` already confirms commit at the deadline. An unconfirmed response is cancelled instead, so elapsed time alone cannot evict before a later failed commit. The fallback timer is unreferenced on Node.js and cleared when a response writer settles, so pending fallback work does not keep process shutdown alive. Deferred eviction failures stay contained inside the interceptor, so cache-key factories or cache-store deletes cannot surface as post-response unhandled promise rejections.

## Public API Overview

### Modules
- `CacheModule.forRoot(options)`: Configures the cache store (memory/redis/custom), default TTL, opt-in `ttlJitter`, key strategies, `global`, `principalScopeResolver`, the Redis namespace `keyPrefix`, and Redis options such as `redis.scanCount`.
  This is the primary package entrypoint for application modules.
- `CacheModule.forRootAsync({ inject, useFactory, global? })`: Resolves the same options through an injected factory for applications that build cache configuration from DI or asynchronous bootstrap work. `global` belongs to this registration call, and a rejected factory fails bootstrap.

### Public types
- `CacheModuleOptions`: Application-facing configuration accepted by `CacheModule.forRoot(...)`, including optional `ttlJitter` and `observer`.
- `CacheTtlJitterOptions` and `CacheTtlJitterMode`: Opt-in positive-TTL jitter bounds, direction, and deterministic randomness seam.
- `NormalizedCacheTtlJitterOptions`: Normalized TTL jitter configuration after defaults are applied.
- `CacheObserver`: Opt-in observation hook with a single `onCacheOperation(observation)` method.
- `CacheObservation`: Privacy-safe discriminated union coupling each operation category to its valid outcomes and carrying `durationMs`.
- `CacheAsyncModuleOptions`: Injected-factory configuration accepted by `CacheModule.forRootAsync(...)`. `useFactory` returns `CacheModuleOptions`; registration-level `global` alone controls module visibility.
- `NormalizedCacheModuleOptions`: Compatibility-only type export matching the normalized module configuration shape after defaults are applied. Prefer `CacheModuleOptions` for application code; this type remains public so consumers that referenced the previously shipped declaration surface can keep compiling.

### Services
- `CacheService`: Main API for manual cache operations (`get`, `set`, `update`, `del`, `remember`, `reset`, `close`). Application shutdown calls the same `close()` path, which forwards teardown to custom stores exposing `close()` or `dispose()` and shares the first teardown completion across concurrent or repeated callers.
- `CacheUpdateError`: Error with the stable `CacheUpdateErrorCode` categories described in [Atomic Updates](#atomic-updates); related reducer, capability, and Redis structural types are exported from the same package root.

### Decorators
- `@CacheTTL(seconds)`: Sets the TTL for a specific handler.
- `@CacheKey(key)`: Sets a custom cache key or key factory for a specific handler.
- `@CacheEvict(key)`: Stores HTTP route metadata that `CacheInterceptor` consumes after a successful non-GET controller handler completes; it does not intercept arbitrary service calls.
- `cacheRouteMetadataKey`, `getCacheKeyMetadata(...)`, `getCacheTtlMetadata(...)`, and `getCacheEvictMetadata(...)`: Low-level metadata helpers exported for first-party interceptor integration, diagnostics, and advanced tooling that needs to inspect cache decorator metadata without reimplementing the metadata keys.

### Interceptors
- `CacheInterceptor`: Handles automatic GET response caching and consumes `@CacheEvict(...)` metadata for non-GET HTTP handlers.

### Stores and status helpers
- `MemoryStore` and `RedisStore`: Built-in store implementations.
- `CACHE_OPTIONS` and `CACHE_STORE`: DI tokens for package internals and custom composition.
- `createCacheManagerPlatformStatusSnapshot(...)` and `createCacheManagerPlatformDiagnosticIssues(...)`: Platform status and diagnostic helpers.

## Related Packages

- `@fluojs/redis`: Optional lifecycle-managed Redis client integration. It is not required when `redis.client` supplies an application-owned `RedisCompatibleClient` directly.
- `@fluojs/http`: Required for HTTP interceptors and decorators.

## Example Sources

- `packages/cache-manager/src/module.test.ts`: Module configuration and provider tests.
- `packages/cache-manager/src/interceptor.test.ts`: HTTP caching and eviction tests.
- `packages/cache-manager/src/service.ts`: Core `CacheService` implementation.
- `packages/cache-manager/src/status.test.ts`: Status and diagnostic helper tests.
- `packages/cache-manager/src/cache-observer.test.ts`: Cache observation contract tests.
