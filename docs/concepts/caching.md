# caching

<p><strong><kbd>English</kbd></strong> <a href="./caching.ko.md"><kbd>한국어</kbd></a></p>

This guide explains Konekti's HTTP response caching model powered by `@konekti/cache-manager`.

### related documentation

- `./http-runtime.md`
- `../../packages/cache-manager/README.md`
- `../../packages/redis/README.md`

## overview

`@konekti/cache-manager` provides:

- a cache service (`CACHE_MANAGER`) and module options token (`CACHE_OPTIONS`)
- memory and Redis cache stores
- route decorators (`@CacheKey`, `@CacheTTL`, `@CacheEvict`)
- a cache interceptor (`CACHE_INTERCEPTOR`) for read-through and eviction behavior

## request behavior

- **Read-through cache is GET-only by default**.
- The default key is the matched route path (`handler.metadata.effectivePath`), so different query strings share the same key unless you override it.
- `@CacheKey(...)` overrides the key for a handler.
- `@CacheTTL(...)` overrides module-level default TTL for a handler.
- `@CacheEvict(...)` runs after the response write of successful non-GET handlers and can evict one or many keys.

## stores

### memory store

- In-process map-based cache.
- TTL expiry is lazy and enforced on reads/writes.
- Best for tests, local development, and single-process deployments.

### redis store

- Uses raw ioredis-style client methods (`get`, `set`, `del`, `scan`).
- Stores JSON-coded cache entries with expiration timestamps.
- Uses scoped `SCAN` + `DEL` reset strategy (prefix-bound) rather than destructive global flush.

## module wiring

- `CacheModuleOptions` primary public fields are:
  - `store?: 'memory' | 'redis' | CacheStore`
  - `ttl?: number` (default `0`, no expiry)
  - `isGlobal?: boolean` (default `false`)

### global interceptor registration

```ts
import { CacheInterceptor, createCacheModule } from '@konekti/cache-manager';
import { Module } from '@konekti/core';
import { bootstrapApplication } from '@konekti/runtime';

@Module({
  imports: [createCacheModule({ store: 'memory' })],
})
class AppModule {}

await bootstrapApplication({
  interceptors: [CacheInterceptor],
  rootModule: AppModule,
});
```

When you register `CacheInterceptor` globally, only GET handlers are read-through cached by default. Use `@CacheKey(...)` to opt into query-aware keys.

### memory-only setup

```ts
import { createCacheModule } from '@konekti/cache-manager';

createCacheModule({ store: 'memory' });
```

This mode does not require `@konekti/redis` or `ioredis`.

### redis-backed setup

```ts
import { createRedisModule } from '@konekti/redis';
import { createCacheModule } from '@konekti/cache-manager';

createRedisModule({ host: '127.0.0.1', port: 6379 });
createCacheModule({ store: 'redis' });
```

When Redis mode is selected without a resolvable Redis client, bootstrap fails early with an explicit configuration error.

## design boundaries

- Cache metadata uses the same standard route metadata map convention consumed from `handler.controllerToken` + `methodName`.
- Cache invalidation behavior is explicit; framework code does not infer domain-level dependencies.
- For multi-instance deployments, prefer Redis store over in-memory store.
