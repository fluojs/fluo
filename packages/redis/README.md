# @konekti/redis

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>


Shared Redis connection layer for Konekti. Register it once, inject either the raw `ioredis` client or the optional Redis facade.

## See also

- `../../docs/concepts/lifecycle-and-shutdown.md`
- `../../docs/reference/package-surface.md`

## What this package does

`@konekti/redis` owns the app-scoped Redis client lifecycle for Konekti. It creates a singleton `ioredis` client, exposes it through the `REDIS_CLIENT` DI token, connects it during module initialization, and closes it during application shutdown.

The package exposes `RedisService` as the primary facade injection identity for JSON-friendly `get`/`set`/`del` usage while still allowing direct raw `ioredis` access.

## Installation

```bash
npm install @konekti/redis ioredis
```

## Quick Start

### 1. Register the module

```typescript
import { Module } from '@konekti/core';
import { RedisModule, type RedisModuleOptions } from '@konekti/redis';

type RedisConfig = {
  host: string;
  port: number;
  password?: string;
};

declare const redisConfig: RedisConfig; // resolved once at the application boundary

const redisOptions: RedisModuleOptions = {
  host: redisConfig.host,
  port: redisConfig.port,
  password: redisConfig.password,
};

@Module({
  imports: [
    RedisModule.forRoot(redisOptions),
  ],
})
export class AppModule {}
```

> Config-first: Konekti resolves environment values at the application boundary and passes typed module options into `RedisModule.forRoot(...)`. See `../../docs/concepts/config-and-environments.md`.

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
| `RedisModule.forRoot(options)` | `src/module.ts` | Registers a global singleton Redis client module |
| `createRedisProviders(options)` | `src/module.ts` | Returns the raw provider list for manual composition |
| `REDIS_CLIENT` | `src/tokens.ts` | DI token for the shared raw `ioredis` client |
| `RedisService` | `src/redis-service.ts` | Facade with JSON codec `get`/`set`/`del` helpers + `getRawClient()` escape hatch |
| `createRedisPlatformStatusSnapshot(input)` | `src/status.ts` | Maps Redis connection state to shared ownership/readiness/health/details snapshot shape |
| `RedisModuleOptions` | `src/types.ts` | `ioredis` options without `lazyConnect` |

## RedisService codec behavior

- `get(key)` returns `null` when the key does not exist.
- `get(key)` returns parsed JSON for valid JSON payloads.
- `get(key)` returns the raw stored string for non-JSON or malformed JSON payloads.
- `set(key, value)` always stores `JSON.stringify(value)` and uses Redis `EX` when `ttlSeconds > 0`.
- `getRawClient()` returns the shared raw `ioredis` client for commands outside the facade surface.

## Lifecycle behavior

- `RedisModule.forRoot()` always creates the client with `lazyConnect: true`.
- `onModuleInit()` calls `connect()` only in `wait` state, so bootstrap fails early if Redis is required and connect fails.
- `onApplicationShutdown()` skips work when already `end`, disconnects directly for non-quittable states, and otherwise prefers `quit()` with `disconnect()` fallback.
- If `quit()` fails and the client still does not close, the original quit error is rethrown.

## 0.x migration note

- `REDIS_SERVICE` compatibility alias was removed from `@konekti/redis` in the `0.x` line.
- Migrate DI usage from `@Inject([REDIS_SERVICE])` to `@Inject([RedisService])`.
- `REDIS_CLIENT` remains the supported raw-client DI token.

## Platform status snapshot semantics

Use `createRedisPlatformStatusSnapshot({ status })` to emit runtime-safe ownership/readiness/health details in the shared platform contract shape.

- `ownership`: Redis is framework-owned (`ownsResources: true`, `externallyManaged: false`).
- `readiness`: `ready` only when client status is `ready`; `wait` is `not-ready`; connect/reconnect phases are `degraded`.
- `health`: `healthy` when ready, `degraded` while connecting/reconnecting/waiting, `unhealthy` for closed states (`close`/`end`).
- `details`: includes stable diagnostics (`connectionState`, `lazyConnect`) without credentials.

## Architecture

```text
RedisModule.forRoot(options)
  -> registers REDIS_CLIENT as a global singleton token
  -> registers lifecycle provider that manages connect/quit

service/repository code
  -> @Inject([REDIS_CLIENT]) or @Inject([RedisService])
  -> raw client or facade codec helpers

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
