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
  - [Query-Sensitive Caching](#query-sensitive-caching)
  - [Cache Ownership and Reset Scope](#cache-ownership-and-reset-scope)
  - [Manual Module Composition](#manual-module-composition)
  - [NestJS Cache Migration](#nestjs-cache-migration)
- [Public API Overview](#public-api-overview)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @fluojs/cache-manager
```

`@fluojs/cache-manager` supports Node.js `>=20.19.3 <21 || >=22.2.0 <27` and declares that exact range through `engines.node`. Its mandatory `@fluojs/runtime` dependency owns that Node listener boundary, so Node 21, Node 22 before 22.2.0, and unverified Node 27+ are excluded. Earlier 1.x releases advertised `engines.node >=20.0.0`, which never matched the effective dependency floor.

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

Positive Redis TTL values are accepted in seconds and may be fractional. Redis expiry is rounded up to the next whole second because Redis `EX` uses integer seconds, while fluo also records the millisecond-precision expiry timestamp in the stored entry and treats the value as expired once that timestamp is reached. Use `ttl: 0` when you intentionally want no Redis expiry.

Redis reset ownership is scoped by the top-level `keyPrefix` option, which defaults to `fluo:cache:` and is passed through to the built-in `RedisStore` namespace. `CacheService.reset()` deletes only keys under that prefix for Redis-backed stores, so application-owned Redis data outside the cache prefix is preserved. Redis glob metacharacters in a non-empty prefix (`*`, `?`, `[`, `]`, and `\`) are escaped before `SCAN`, so the configured prefix remains a literal namespace instead of broadening reset ownership. If you intentionally configure an empty `keyPrefix`, reset is limited to keys written by the current `RedisStore` instance instead of scanning `*`; use a non-empty, application-specific prefix when you need reset to cover cache entries across restarts or multiple processes.

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

Lifecycle diagnostics report the same teardown owner that shutdown actually uses. `createCacheManagerPlatformStatusSnapshot(...)` resolves ownership from lifecycle responsibility rather than treating every non-memory store alike:

- The built-in memory store is `framework`-owned because the framework creates and holds it in-process.
- A custom store is `framework`-owned by default because `CacheService.close()` owns teardown dispatch to its optional `close()` or `dispose()` hook.
- The Redis store is `external` to `CacheService`, which never closes the client. When the cache module resolves a client through `@fluojs/redis`, that integration owns its lifecycle; when `redis.client` supplies a client directly, the application owns its lifecycle.

An explicit `storeOwnershipMode` still wins over the store default. Set it to `external` when the application intentionally retains lifecycle responsibility for a custom store.

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
| `ttl` in milliseconds | `ttl` in seconds | Divide NestJS v5 millisecond values by 1000. Omitting `ttl` applies `300` seconds on the memory path and `0` for the `redis` and custom-store paths. |
| `ttl: 0` | `ttl: 0` | Means no expiry, not "do not cache". Negative or non-finite values are invalid: `CacheService.set(...)` drops the write, and `CacheInterceptor` skips both the cache read and write for that handler. |
| `@CacheTTL(...)` | `@CacheTTL(ttlSeconds: number)` | Accepts one static number only. Move per-request lifetimes to `CacheService.set(key, value, ttlSeconds)`. |
| implicit query-sensitive keys | `httpKeyStrategy` | Defaults to path-only `'route'`. Select `'route+query'` (or `'full'`), a function strategy, or `@CacheKey(...)` when a response varies by query parameters. |
| `isGlobal: true` | `global: true` | Both NestJS `isGlobal` and fluo `global` default to `false`, so both cache modules are module-local unless you opt in or import the module everywhere it is resolved. |
| NestJS store adapters such as `cache-manager-redis-store` | `store: 'redis'` or a `CacheStore` object | NestJS adapters do not satisfy the `CacheStore` contract; use the built-in Redis path or wrap the adapter so callback/options completion becomes a Promise, `ttlSeconds` maps to the legacy TTL in seconds, and `reset()` clears only the cache namespace. Never forward `reset()` blindly to a whole-database `flushDb`. |
| adapter-owned client teardown | `close()` / `dispose()` on the store | Application shutdown forwards teardown only to those optional hooks. A raw client passed through `redis.client` stays application-owned and must be closed from the application lifecycle. |

```typescript
CacheModule.forRoot({
  // NestJS `ttl: 60_000` (milliseconds) becomes 60 seconds.
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
- `CacheModule.forRoot(options)`: Configures the cache store (memory/redis/custom), default TTL, key strategies, `global`, `principalScopeResolver`, the Redis namespace `keyPrefix`, and Redis options such as `redis.scanCount`.
  This is the primary package entrypoint for application modules.

### Public types
- `CacheModuleOptions`: Application-facing configuration accepted by `CacheModule.forRoot(...)`.
- `NormalizedCacheModuleOptions`: Compatibility-only type export matching the normalized configuration shape after defaults are applied. Prefer `CacheModuleOptions` for application code; this type remains public so consumers that referenced the previously shipped declaration surface can keep compiling.

### Services
- `CacheService`: Main API for manual cache operations (`get`, `set`, `del`, `remember`, `reset`, `close`). Application shutdown calls the same `close()` path, which forwards teardown to custom stores exposing `close()` or `dispose()` and shares the first teardown completion across concurrent or repeated callers.

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
