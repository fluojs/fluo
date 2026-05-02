# @fluojs/cache-manager

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

General-purpose cache manager for fluo with pluggable memory and Redis stores. Provides both decorator-driven HTTP response caching and a standalone cache API for application-level caching.

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
- [Public API Overview](#public-api-overview)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @fluojs/cache-manager
```

The root `@fluojs/cache-manager` import stays safe for memory-only installs. You only need Redis peers when you explicitly select the Redis-backed store path.

For Redis-backed caching:

```bash
npm install @fluojs/cache-manager @fluojs/redis ioredis
```

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

class UserService {
  constructor(@Inject(CacheService) private readonly cache: CacheService) {}

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

To use Redis, ensure `@fluojs/redis` is configured and set the store to `'redis'`.

Memory-only consumers can keep importing from `@fluojs/cache-manager` without installing `@fluojs/redis` or `ioredis`; those optional peers are resolved only when the Redis store path is selected.

```typescript
CacheModule.forRoot({
  store: 'redis',
  ttl: 600,
})
```

If you registered multiple Redis clients, set `redis.clientName` to target a named `@fluojs/redis` connection.

Leave `redis.clientName` unset to keep using the default Redis client resolved through `REDIS_CLIENT`.

```typescript
CacheModule.forRoot({
  store: 'redis',
  redis: { clientName: 'cache' },
})
```

`redis.client` remains the highest-precedence override. Use it only when you need to bypass DI-based client selection entirely.

The built-in `RedisStore` persists entries with `JSON.stringify(...)`. Cache values therefore need to be JSON-compatible: plain objects, arrays, strings, numbers, booleans, and `null` round-trip cleanly, while values such as `Date` come back as JSON output (for example ISO strings), functions/`undefined`/symbols do not survive, and non-serializable values like `bigint` or cyclic graphs should be normalized before caching.

Redis reset ownership is scoped by `keyPrefix`, which defaults to `fluo:cache:`. `CacheService.reset()` deletes only keys under that prefix for Redis-backed stores, so application-owned Redis data outside the cache prefix is preserved. If you intentionally configure an empty `keyPrefix`, reset is limited to keys written by the current `RedisStore` instance instead of scanning `*`; use a non-empty, application-specific prefix when you need reset to cover cache entries across restarts or multiple processes.

### Query-Sensitive Caching

Built-in HTTP cache key strategies derive their path segment from the concrete request path (`requestContext.request.path`), not the route template metadata. That means requests such as `/users/1` and `/users/2` always resolve to different cache keys even when they hit the same `@Get('/:id')` handler.

By default, the cache key ignores query parameters and uses only the concrete request path. Enable `httpKeyStrategy: 'route+query'` (or `full`, which is equivalent for the built-in strategy set) to cache different responses for different search parameters. Query-aware keys canonicalize both parameter names and repeated values, so `/products?tag=a&tag=b` and `/products?tag=b&tag=a` share one cache entry.

```typescript
CacheModule.forRoot({
  store: 'memory',
  httpKeyStrategy: 'route+query',
})
```

### Cache Ownership and Reset Scope

`CacheService.reset()` clears entries owned by the configured store, not unrelated application state. It also drops in-flight `remember(...)` bookkeeping so loaders that started before the reset cannot repopulate stale entries after the reset completes. For the built-in memory store that means the in-process entries held by that store instance. For Redis, ownership is the configured `keyPrefix` namespace; keep the default `fluo:cache:` or choose a dedicated prefix such as `myapp:cache:` for shared Redis deployments.

```typescript
CacheModule.forRoot({
  store: 'redis',
  keyPrefix: 'myapp:cache:',
})
```

Avoid sharing a Redis cache prefix with non-cache data. `del(key)` removes the exact cache key resolved by this package, while `reset()` removes only the store-owned cache namespace described above.

When the application closes, `CacheService` forwards shutdown to custom stores that expose `close()` or `dispose()`. Use one of those optional hooks when a store owns sockets, pools, timers, or other external resources.

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

### Memory Store Operational Limits

The built-in memory store is designed for single-process, bounded caching:

- If you omit `ttl` on the default memory path, `CacheModule.forRoot()` uses a 300-second TTL.
- `ttl: 0` is still supported for no-expiry entries, but the memory store keeps only the most recent 1,000 live keys.
- High-cardinality or multi-instance deployments should use the Redis store instead of relying on process-local memory.

### Deferred eviction timing

For non-GET handlers decorated with `@CacheEvict(...)`, eviction is deferred until the response successfully commits. If an adapter path never calls `response.send(...)`, the interceptor still runs a bounded fallback timer so successful writes do not leave stale entries behind indefinitely. Deferred eviction failures stay contained inside the interceptor, so cache-key factories or cache-store deletes cannot surface as post-response unhandled promise rejections.

## Public API Overview

### Modules
- `CacheModule.forRoot(options)`: Configures the cache store (memory/redis), default TTL, and key strategies.
  This is the primary package entrypoint for application modules.


### Services
- `CacheService`: Main API for manual cache operations (`get`, `set`, `del`, `remember`, `reset`).

### Decorators
- `@CacheTTL(seconds)`: Sets the TTL for a specific handler.
- `@CacheKey(key)`: Sets a custom cache key for a specific handler.
- `@CacheEvict(key)`: Clears specific cache keys after a successful mutation (POST/PUT/DELETE).

### Interceptors
- `CacheInterceptor`: Handles automatic GET response caching and eviction logic.

## Related Packages

- `@fluojs/redis`: Required for Redis storage.
- `@fluojs/http`: Required for HTTP interceptors and decorators.

## Example Sources

- `packages/cache-manager/src/module.test.ts`: Module configuration and provider tests.
- `packages/cache-manager/src/interceptor.test.ts`: HTTP caching and eviction tests.
- `packages/cache-manager/src/service.ts`: Core `CacheService` implementation.
