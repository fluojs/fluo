# @konekti/redis

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>


Shared Redis connection layer for Konekti. Register it once, inject the raw `ioredis` client anywhere.

## See also

- `../../docs/concepts/lifecycle-and-shutdown.md`
- `../../docs/reference/package-surface.md`

## What this package does

`@konekti/redis` owns the app-scoped Redis client lifecycle for Konekti. It creates a singleton `ioredis` client, exposes it through the `REDIS_CLIENT` DI token, connects it during module initialization, and closes it during application shutdown.

The package does **not** wrap Redis commands behind another abstraction. You still use the raw `ioredis` client API.

## Installation

```bash
npm install @konekti/redis ioredis
```

## Quick Start

### 1. Register the module

```typescript
import { Module } from '@konekti/core';
import { createRedisModule } from '@konekti/redis';

@Module({
  imports: [
    createRedisModule({
      host: process.env.REDIS_HOST,
      port: Number(process.env.REDIS_PORT ?? 6379),
      password: process.env.REDIS_PASSWORD,
    }),
  ],
})
export class AppModule {}
```

### 2. Inject the raw Redis client

```typescript
import { Inject } from '@konekti/core';
import { REDIS_CLIENT } from '@konekti/redis';
import type Redis from 'ioredis';

@Inject([REDIS_CLIENT])
export class CacheService {
  constructor(private readonly redis: Redis) {}

  async remember(key: string, value: string) {
    await this.redis.set(key, value);
  }
}
```

## Key API

| Export | Location | Description |
|---|---|---|
| `createRedisModule(options)` | `src/module.ts` | Registers a global singleton Redis client module |
| `createRedisProviders(options)` | `src/module.ts` | Returns the raw provider list for manual composition |
| `REDIS_CLIENT` | `src/tokens.ts` | DI token for the shared raw `ioredis` client |
| `RedisModuleOptions` | `src/types.ts` | `ioredis` options without `lazyConnect` |

## Lifecycle behavior

- `createRedisModule()` always creates the client with `lazyConnect: true`.
- `onModuleInit()` calls `connect()` when the client is still in `wait` state, so bootstrap fails early if Redis is required.
- `onApplicationShutdown()` prefers `quit()` for graceful shutdown and falls back to `disconnect()` if `quit()` fails.

## Architecture

```text
createRedisModule(options)
  -> registers REDIS_CLIENT as a global singleton token
  -> registers lifecycle provider that manages connect/quit

service/repository code
  -> @Inject([REDIS_CLIENT])
  -> raw ioredis client

app bootstrap
  -> onModuleInit()
  -> redis.connect()

app.close()
  -> onApplicationShutdown()
  -> redis.quit() or redis.disconnect()
```

## Related packages

- `@konekti/runtime` - runs module init and shutdown hooks
- `@konekti/di` - resolves the `REDIS_CLIENT` token
- `@konekti/core` - provides `@Inject()` metadata

## One-liner mental model

```text
@konekti/redis = one app-scoped ioredis client wired into Konekti DI and lifecycle hooks
```
