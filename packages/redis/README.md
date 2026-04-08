# @konekti/redis

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Shared Redis connection layer for Konekti. It provides a singleton `ioredis` client managed by the application lifecycle.

## Table of Contents

- [Installation](#installation)
- [When to use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
- [Public API](#public-api)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @konekti/redis ioredis
```

## When to Use

- When you need a shared Redis connection across multiple modules (caching, queues, throttlers).
- When you want automatic connection management (connect on bootstrap, quit on shutdown).
- When you need a JSON-aware facade for common key-value operations.

## Quick Start

### Register the Module

```typescript
import { Module } from '@konekti/core';
import { RedisModule } from '@konekti/redis';

@Module({
  imports: [
    RedisModule.forRoot({
      host: 'localhost',
      port: 6379,
    }),
  ],
})
export class AppModule {}
```

### Use the Redis Service

Inject `RedisService` for high-level operations or `REDIS_CLIENT` for the raw `ioredis` instance.

```typescript
import { Inject } from '@konekti/core';
import { RedisService } from '@konekti/redis';

export class CacheRepository {
  @Inject([RedisService])
  private readonly redis: RedisService;

  async saveUser(id: string, user: object) {
    await this.redis.set(`user:${id}`, user, 3600);
  }

  async getUser(id: string) {
    return await this.redis.get(`user:${id}`);
  }
}
```

## Common Patterns

### Raw Client Access

If you need advanced Redis commands (pipelines, lua scripts, pub/sub), inject the raw client directly.

```typescript
import { Inject } from '@konekti/core';
import { REDIS_CLIENT } from '@konekti/redis';
import type Redis from 'ioredis';

export class AdvancedService {
  @Inject([REDIS_CLIENT])
  private readonly client: Redis;

  async executeComplex() {
    return await this.client.pipeline().set('foo', 'bar').get('foo').exec();
  }
}
```

## Public API Overview

### Core
- `RedisModule`: Registers the global Redis client and lifecycle hooks.
- `RedisService`: Facade with JSON codec support and `get`/`set`/`del` methods.
- `REDIS_CLIENT`: DI token for the underlying `ioredis` instance.

### Types
- `RedisModuleOptions`: Configuration options passed directly to the `ioredis` constructor.

## Related Packages

- `@konekti/cache-manager`: Uses this package for Redis-backed caching.
- `@konekti/queue`: Uses this package for distributed job processing.
- `@konekti/throttler`: Uses this package for distributed rate limiting.

## Example Sources

- `packages/redis/src/module.test.ts`: Module lifecycle and DI wiring.
- `packages/redis/src/redis-service.ts`: Facade implementation and codec logic.
