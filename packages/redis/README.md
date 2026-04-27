# @fluojs/redis

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Shared Redis connection layer for fluo. It provides a singleton `ioredis` client managed by the application lifecycle.

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
npm install @fluojs/redis ioredis
```

## When to Use

- When you need a shared Redis connection across multiple modules (caching, queues, throttlers).
- When you want automatic connection management (connect on bootstrap, quit on shutdown).
- When you need a JSON-aware facade for common key-value operations.

## Quick Start

### Register the Module

Use `RedisModule.forRoot(options)` to register the default Redis client and `RedisService` facade.

```typescript
import { Module } from '@fluojs/core';
import { RedisModule } from '@fluojs/redis';

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
import { Inject } from '@fluojs/core';
import { RedisService } from '@fluojs/redis';

@Inject(RedisService)
export class CacheRepository {
  constructor(private readonly redis: RedisService) {}

  async saveUser(id: string, user: object) {
    await this.redis.set(`user:${id}`, user, 3600);
  }

  async getUser(id: string) {
    return await this.redis.get(`user:${id}`);
  }
}
```

## Common Patterns

### Lifecycle Ownership

`@fluojs/redis` owns the lifecycle of every client it creates, including clients registered through `RedisModule.forRootNamed(...)`.

- Fluo always forces `lazyConnect: true`, even if callers cast options manually, so sockets open during application bootstrap instead of import time.
- During bootstrap, the lifecycle service only calls `connect()` while the client is still in ioredis `wait` state.
- During shutdown, ready/connecting clients attempt `quit()` first for graceful teardown, while wait/closed-transition states use `disconnect()` directly.
- If `quit()` fails, Fluo falls back to `disconnect()` and only rethrows when the client still remains open afterward.

### Named Clients

Use `RedisModule.forRootNamed(name, options)` when one application needs more than one Redis connection. `RedisModule.forRoot(options)` provides the default `REDIS_CLIENT` and `RedisService` aliases, and named registrations are resolved with `getRedisClientToken(name)` and `getRedisServiceToken(name)`.

- Omit `name` when you want the default aliases: `REDIS_CLIENT` / `RedisService`.
- Pass `name` when you want the named helpers: `getRedisClientToken(name)` / `getRedisServiceToken(name)`.
- Named clients follow the same bootstrap/shutdown contract as the default client; only the default registration exports the `REDIS_CLIENT` / `RedisService` aliases.

```typescript
import { Module, Inject } from '@fluojs/core';
import type Redis from 'ioredis';
import {
  getRedisClientToken,
  getRedisServiceToken,
  RedisModule,
  RedisService,
} from '@fluojs/redis';

const ANALYTICS_REDIS = getRedisServiceToken('analytics');
const ANALYTICS_REDIS_CLIENT = getRedisClientToken('analytics');

@Module({
  imports: [
    RedisModule.forRoot({ host: 'localhost', port: 6379 }),
    RedisModule.forRootNamed('analytics', { host: 'localhost', port: 6380 }),
  ],
})
export class AppModule {}

@Inject(RedisService, ANALYTICS_REDIS, ANALYTICS_REDIS_CLIENT)
export class AnalyticsStore {
  constructor(
    private readonly defaultRedis: RedisService,
    private readonly analyticsRedis: RedisService,
    private readonly analyticsClient: Redis,
  ) {}
}
```

### Raw Client Access

If you need advanced Redis commands (pipelines, lua scripts, pub/sub), inject the raw client directly.

```typescript
import { Inject } from '@fluojs/core';
import { REDIS_CLIENT } from '@fluojs/redis';
import type Redis from 'ioredis';

@Inject(REDIS_CLIENT)
export class AdvancedService {
  constructor(private readonly client: Redis) {}

  async executeComplex() {
    return await this.client.pipeline().set('foo', 'bar').get('foo').exec();
  }
}
```

## Public API Overview

### Core
- `RedisModule`: Registers the global Redis client and lifecycle hooks.
- `RedisModule.forRoot(options)`: Registers the default Redis client plus `RedisService` facade, with `lazyConnect` lifecycle ownership kept inside Fluo.
- `RedisModule.forRootNamed(name, options)`: Registers an additional named Redis client without replacing the default aliases, using the same lifecycle contract.
- `RedisService`: Facade with JSON codec support and `get`/`set`/`del` methods.
- `REDIS_CLIENT`: DI token for the underlying `ioredis` instance.
- `getRedisClientToken(name)`: DI token helper for a named raw client. Omitting `name` returns the default `REDIS_CLIENT` token.
- `getRedisServiceToken(name)`: DI token helper for a named `RedisService` facade. Omitting `name` returns the default `RedisService` token.
- `getRedisComponentId(name)`: Status/dependency id helper used by Redis-consuming packages (`redis.default`, `redis.cache`, etc.).
- `createRedisPlatformStatusSnapshot(input)`: Adapts Redis connection state into Fluo's platform health/readiness snapshot contract.

### Types
- `RedisModuleOptions`: Configuration options passed directly to the `ioredis` constructor.

## Related Packages

- `@fluojs/cache-manager`: Uses this package for Redis-backed caching.
- `@fluojs/queue`: Uses this package for distributed job processing.
- `@fluojs/throttler`: Uses this package for distributed rate limiting.

## Example Sources

- `packages/redis/src/module.test.ts`: Module lifecycle and DI wiring.
- `packages/redis/src/public-api.test.ts`: Root-barrel export guard for the documented Redis surface.
- `packages/redis/src/redis-service.ts`: Facade implementation and codec logic.
