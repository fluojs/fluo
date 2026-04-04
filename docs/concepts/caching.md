# caching

<p><strong><kbd>English</kbd></strong> <a href="./caching.ko.md"><kbd>한국어</kbd></a></p>

This guide explains Konekti's HTTP response caching model powered by `@konekti/cache-manager`.

### related documentation

- `./http-runtime.md`
- `../../packages/cache-manager/README.md`
- `../../packages/redis/README.md`

## overview

`@konekti/cache-manager` provides:

- class-first DI entry points (`CacheService`, `CacheInterceptor`) for cache facade/interceptor usage
- memory and Redis cache stores
- route decorators (`@CacheKey`, `@CacheTTL`, `@CacheEvict`)
- token seams (`CACHE_OPTIONS`, `CACHE_STORE`) for module/store wiring

### 0.x migration note

In the current `0.x` line, compatibility aliases `CACHE_MANAGER` and `CACHE_INTERCEPTOR` are removed from the public package surface.

- Migrate DI to class-first entry points:
  - `CACHE_MANAGER` -> `CacheService`
  - `CACHE_INTERCEPTOR` -> `CacheInterceptor`
- Internal token seams remain token-based and unchanged:
  - `CACHE_OPTIONS`
  - `CACHE_STORE`

## request behavior

- **Read-through cache is GET-only by default**.
- The default key starts from the matched route path (`handler.metadata.effectivePath`). If `RequestContext.principal` is present, built-in string strategies append `principal.issuer` + `principal.subject` so authenticated responses are isolated by user. Different query strings still share the same key unless you opt into a query-aware strategy.
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
- In `store: 'redis'` mode, runtime client lifecycle is owned by `@konekti/redis` (lazy bootstrap connect + graceful shutdown semantics) rather than by cache-manager itself.

## module wiring

- `CacheModuleOptions` primary public fields are:
  - `store?: 'memory' | 'redis' | CacheStore`
  - `ttl?: number` (default `0`, no expiry)
  - `isGlobal?: boolean` (default `false`)

### global interceptor registration

```ts
import { CacheInterceptor, CacheModule } from '@konekti/cache-manager';
import { Module } from '@konekti/core';
import { bootstrapApplication } from '@konekti/runtime';

@Module({
  imports: [CacheModule.forRoot({ store: 'memory' })],
})
class AppModule {}

await bootstrapApplication({
  interceptors: [CacheInterceptor],
  rootModule: AppModule,
});
```

When you register `CacheInterceptor` globally, only GET handlers are read-through cached by default. Built-in string strategies isolate authenticated principals automatically, but query-sensitive routes still need `httpKeyStrategy: 'route+query'` or an explicit `@CacheKey(...)` override.

### memory-only setup

```ts
import { CacheModule } from '@konekti/cache-manager';

CacheModule.forRoot({ store: 'memory' });
```

This mode does not require `@konekti/redis` or `ioredis`.

### redis-backed setup

```ts
import { RedisModule } from '@konekti/redis';
import { CacheModule } from '@konekti/cache-manager';

RedisModule.forRoot({ host: '127.0.0.1', port: 6379 });
CacheModule.forRoot({ store: 'redis' });
```

When Redis mode is selected without a resolvable Redis client, bootstrap fails early with an explicit configuration error.

When the backing Redis module is present, bootstrap connects in `wait` state and fails fast on connection errors; shutdown prefers `quit()` with `disconnect()` fallback.

## design boundaries

- Cache metadata uses the same standard route metadata map convention consumed from `handler.controllerToken` + `methodName`.
- Cache invalidation behavior is explicit; framework code does not infer domain-level dependencies.
- For multi-instance deployments, prefer Redis store over in-memory store.
