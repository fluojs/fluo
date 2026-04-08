# @konekti/cache-manager

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

General-purpose cache manager for Konekti with pluggable memory and Redis stores. Provides both decorator-driven HTTP response caching and a standalone cache API for application-level caching.

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
npm install @konekti/cache-manager
```

For Redis-backed caching:

```bash
npm install @konekti/cache-manager @konekti/redis ioredis
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
import { Module } from '@konekti/core';
import { Controller, Get, UseInterceptors } from '@konekti/http';
import { CacheModule, CacheInterceptor, CacheTTL } from '@konekti/cache-manager';

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
import { Inject } from '@konekti/core';
import { CacheService } from '@konekti/cache-manager';

class UserService {
  constructor(@Inject([CacheService]) private readonly cache: CacheService) {}

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

To use Redis, ensure `@konekti/redis` is configured and set the store to `'redis'`.

```typescript
CacheModule.forRoot({
  store: 'redis',
  ttl: 600,
})
```

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

- `@konekti/redis`: Required for Redis storage.
- `@konekti/http`: Required for HTTP interceptors and decorators.

## Example Sources

- `packages/cache-manager/src/module.test.ts`: Module configuration and provider tests.
- `packages/cache-manager/src/interceptor.test.ts`: HTTP caching and eviction tests.
- `packages/cache-manager/src/service.ts`: Core `CacheService` implementation.
