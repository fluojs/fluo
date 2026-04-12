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
- [Public API Overview](#public-api-overview)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @fluojs/cache-manager
```

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

### Query-Sensitive Caching

By default, the cache key ignores query parameters. Enable `httpKeyStrategy: 'route+query'` to cache different responses for different search parameters.

```typescript
CacheModule.forRoot({
  store: 'memory',
  httpKeyStrategy: 'route+query',
})
```

## Public API Overview

### Modules
- `CacheModule.forRoot(options)`: Configures the cache store (memory/redis), default TTL, and key strategies.

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
