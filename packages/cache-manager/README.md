# @konekti/cache-manager

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Decorator-driven HTTP response caching for Konekti with pluggable memory and Redis stores.

## Installation

```bash
npm install @konekti/cache-manager
```

For Redis-backed caching:

```bash
npm install @konekti/cache-manager @konekti/redis ioredis
```

## Quick Start

```ts
import { Module } from '@konekti/core';
import { Controller, Get, Post, UseInterceptor } from '@konekti/http';
import { CacheEvict, CacheInterceptor, CacheTTL, createCacheModule } from '@konekti/cache-manager';

@Controller('/products')
class ProductController {
  @Get('/')
  @UseInterceptor(CacheInterceptor)
  @CacheTTL(30)
  list() {
    return { ok: true };
  }

  @Post('/refresh')
  @UseInterceptor(CacheInterceptor)
  @CacheEvict('/products')
  refresh() {
    return { refreshed: true };
  }
}

@Module({
  imports: [createCacheModule({ store: 'memory' })],
  controllers: [ProductController],
})
class AppModule {}
```

## API

- `createCacheModule(options)` — registers cache providers (default `isGlobal: false`).
- `createCacheProviders(options)` — returns providers for manual composition.
- `CACHE_MANAGER` — DI token for `CacheService`.
- `CACHE_OPTIONS` — DI token for normalized module options.
- `CacheService` manual API — `get`, `set`, `del`, `reset` (`remember` is additive).
- `CacheStore` contract — `get`, `set`, `del`, `reset`.
- `MemoryStore` / `RedisStore` — cache store adapters.
- `@CacheKey(value)` — custom cache key (string or resolver function).
- `@CacheTTL(seconds)` — method-level TTL override.
- `@CacheEvict(value)` — evict key(s) after successful non-GET handlers.

`CacheModuleOptions` primary fields are `store`, `ttl`, and `isGlobal`.

## Behavior

- Cache reads are **GET-only** by default.
- Default cache key is the matched route path (`handler.metadata.effectivePath`).
- Example: `GET /products?sort=asc` => default cache key `/products`.
- Use `@CacheKey(...)` when query-string-aware or fully custom cache keys are required.
- `@CacheEvict(...)` runs after the response write of successful non-GET handlers.
- `MemoryStore` uses lazy TTL expiration.
- Default module TTL is `0` (no expiry).
- `RedisStore` stores JSON codec entries and resets keys via scoped `SCAN` + `DEL` (no global flush).

## Redis bootstrap behavior

- `createCacheModule({ store: 'memory' })` works without `@konekti/redis`/`ioredis` installed.
- `createCacheModule({ store: 'redis' })` requires either:
  - `createRedisModule(...)` imported in the app (providing `REDIS_CLIENT`), or
  - `options.redis.client` with a raw ioredis-style client.

If Redis mode is selected and no client is available, bootstrap fails with an explicit error.

## Related packages

- `@konekti/http` — interceptor contracts and route execution
- `@konekti/runtime` — module bootstrap
- `@konekti/redis` — optional Redis client module for DI wiring
