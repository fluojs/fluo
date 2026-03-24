# @konekti/cache-manager

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

General-purpose cache manager for Konekti with pluggable memory and Redis stores. Provides both decorator-driven HTTP response caching and a standalone cache API for application-level caching.

## Installation

```bash
npm install @konekti/cache-manager
```

For Redis-backed caching:

```bash
npm install @konekti/cache-manager @konekti/redis ioredis
```

## Quick Start — HTTP Response Caching

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

## Quick Start — Application-Level Caching

Use `CacheService` directly for non-HTTP caching needs such as external API responses, computed results, or session data.

```ts
import { Inject } from '@konekti/core';
import { Module } from '@konekti/runtime';
import { CACHE_MANAGER, createCacheModule, type CacheService } from '@konekti/cache-manager';

const EXTERNAL_API = Symbol.for('EXTERNAL_API');

interface UserProfile {
  id: string;
  name: string;
  email: string;
}

@Inject([CACHE_MANAGER])
class UserService {
  constructor(private readonly cache: CacheService) {}

  async getUserProfile(userId: string): Promise<UserProfile> {
    const cacheKey = `user:profile:${userId}`;

    return this.cache.remember(cacheKey, async () => {
      const response = await fetch(`https://api.example.com/users/${userId}`);
      return response.json() as Promise<UserProfile>;
    }, 300); // 5-minute TTL
  }

  async invalidateUser(userId: string): Promise<void> {
    await this.cache.del(`user:profile:${userId}`);
  }

  async clearAllCache(): Promise<void> {
    await this.cache.reset();
  }
}

@Module({
  imports: [createCacheModule({ store: 'memory', ttl: 60 })],
  providers: [UserService],
})
class AppModule {}
```

## API

### Core Cache Contract

- `CacheStore` — low-level store interface with `get`, `set`, `del`, `reset`.
- `CacheService` — application-level cache API wrapping a store:
  - `get<T>(key)` — retrieve a cached value.
  - `set<T>(key, value, ttlSeconds?)` — store a value with optional TTL override.
  - `remember<T>(key, loader, ttlSeconds?)` — read-through cache: returns cached value or loads, caches, and returns.
  - `del(key)` — remove a single cache entry.
  - `reset()` — clear all entries managed by the store.
- `MemoryStore` — in-process cache with lazy TTL expiration.
- `RedisStore` — Redis-backed cache with JSON codec and scoped `SCAN` + `DEL` reset.

### HTTP Interceptor API

- `CacheInterceptor` — HTTP interceptor for GET response caching with decorator-driven configuration.
- `@CacheKey(value)` — custom cache key (string or resolver function).
- `@CacheTTL(seconds)` — method-level TTL override.
- `@CacheEvict(value)` — evict key(s) after successful non-GET handlers.

### Module Setup

- `createCacheModule(options)` — registers cache providers (default `isGlobal: false`).
- `createCacheProviders(options)` — returns providers for manual composition.
- `CACHE_MANAGER` — DI token for `CacheService`.
- `CACHE_OPTIONS` — DI token for normalized module options.

`CacheModuleOptions` primary fields are `store`, `ttl`, and `isGlobal`.

## Behavior

### HTTP Interceptor Behavior (CacheInterceptor)

- Cache reads are **GET-only** by default.
- Default cache key is the matched route path (`handler.metadata.effectivePath`).
- Example: `GET /products?sort=asc` => default cache key `/products`.
- Use `@CacheKey(...)` when query-string-aware or fully custom cache keys are required.
- `@CacheEvict(...)` runs after the response write of successful non-GET handlers.

### General Cache Behavior (CacheService / CacheStore)

- `CacheService` is independent of HTTP context — use it anywhere via DI.
- TTL semantics are consistent across stores: `0` or omitted means no expiry; positive values set expiration.
- `MemoryStore` uses lazy TTL expiration (expired entries cleaned on next read or sweep).
- `RedisStore` stores JSON-encoded entries with application-level expiry tracking.
- `remember()` provides read-through caching pattern for computed or fetched values.
- Store implementations are interchangeable — both `MemoryStore` and `RedisStore` satisfy the `CacheStore` contract.
- Default module TTL is `0` (no expiry).

## Redis bootstrap behavior

- `createCacheModule({ store: 'memory' })` works without `@konekti/redis`/`ioredis` installed.
- `createCacheModule({ store: 'redis' })` requires either:
  - `createRedisModule(...)` imported in the app (providing `REDIS_CLIENT`), or
  - `options.redis.client` with a raw ioredis-style client.

If Redis mode is selected and no client is available, bootstrap fails with an explicit error.

## Cross-store consistency

Both `MemoryStore` and `RedisStore` implement the `CacheStore` interface with identical semantics:

- `get(key)` returns `undefined` for missing or expired entries.
- `set(key, value, ttl?)` stores the value; `ttl=0` means no expiry.
- `del(key)` removes a single entry.
- `reset()` clears all managed entries.

This allows swapping stores without changing application code — use `MemoryStore` for development/testing and `RedisStore` for production.

## Related packages

- `@konekti/http` — interceptor contracts and route execution
- `@konekti/runtime` — module bootstrap
- `@konekti/redis` — optional Redis client module for DI wiring
