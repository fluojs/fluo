# @konekti/throttler

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Decorator-based rate limiting for Konekti applications with in-memory and Redis store adapters.

## Installation

```bash
npm install @konekti/throttler
```

## Quick Start

```typescript
import { Module } from '@konekti/core';
import { ThrottlerModule, Throttle, SkipThrottle } from '@konekti/throttler';
import { Controller, Get, Post } from '@konekti/http';

@Module({
  imports: [
    ThrottlerModule.forRoot({
      ttl: 60,
      limit: 100,
    }),
  ],
})
class AppModule {}

@Controller('/auth')
class AuthController {
  @Post('/login')
  @Throttle({ ttl: 60, limit: 5 })
  login() {}

  @Post('/refresh')
  @SkipThrottle()
  refresh() {}
}
```

## API

### `ThrottlerModule.forRoot(options)`

Registers a global throttler guard. Options:

| Option | Type | Description |
|---|---|---|
| `ttl` | `number` | Window length in seconds |
| `limit` | `number` | Max requests per window |
| `keyGenerator` | `(ctx) => string` | Custom key function. Defaults to remote IP |
| `store` | `ThrottlerStore` | Store adapter. Defaults to in-memory |

### `@Throttle({ ttl, limit })`

Overrides module-level defaults for a specific controller class or handler method.

### `@SkipThrottle()`

Bypasses throttling entirely for a specific controller class or handler method.

### `ThrottlerGuard`

Primary class-first guard identity exported by `@konekti/throttler`.

```typescript
import { Controller, UseGuards } from '@konekti/http';
import { ThrottlerGuard } from '@konekti/throttler';

@UseGuards(ThrottlerGuard)
@Controller('/api')
class ApiController {}
```

### `THROTTLER_OPTIONS`

Module-options DI token used by `ThrottlerGuard` construction and module wiring.

## 0.x migration notes

- `THROTTLER_GUARD` compatibility alias was removed from the public API.
- Use `ThrottlerGuard` directly in `@UseGuards(...)` and DI registrations.
- Migrate module setup from `createThrottlerModule(options)` to `ThrottlerModule.forRoot(options)`.
- Runtime throttling behavior and module options semantics are unchanged.

### `createThrottlerPlatformStatusSnapshot(input)` / `createThrottlerPlatformDiagnosticIssues(input)`

Status adapters (`src/status.ts`) that map throttler store mode and backing-store readiness to shared platform snapshot/diagnostic shapes.

## Redis store

```typescript
import { RedisThrottlerStore, ThrottlerModule } from '@konekti/throttler';
import { REDIS_CLIENT } from '@konekti/redis';
import type Redis from 'ioredis';

@Inject([REDIS_CLIENT])
class AppBootstrap {
  constructor(private readonly redis: Redis) {}

  buildModule() {
    return ThrottlerModule.forRoot({
      ttl: 60,
      limit: 100,
      store: new RedisThrottlerStore(this.redis),
    });
  }
}
```

## Behavior

- Rate limit key defaults to `socket.remoteAddress`. Provide `keyGenerator` for header-based keying (e.g. `x-api-key`).
- Store keys are composed as `throttler:<encoded-handler-key>:<encoded-client-key>`. Both key segments are encoded with `encodeURIComponent(...)`, so client keys containing `:` (for example IPv6 addresses) cannot collide with separator boundaries. The decoded `<handler-key>` is composed from route `method`, `path`, `version`, and `handler` method name — all stable under minification, since they are data values rather than class-name identifiers.
- When the limit is exceeded, `ThrottlerGuard` throws `TooManyRequestsException` (HTTP 429) and sets the `Retry-After` response header to the seconds remaining in the current window.
- Method-level `@Throttle` overrides class-level `@Throttle`, which overrides module-level defaults — in that priority order.
- `@SkipThrottle()` at either level wins unconditionally.
- `@Throttle()` options are copied when metadata is written/read, so mutating a shared options object later does not alter registered throttle policy.
- The in-memory store sweeps expired keys whenever the earliest known reset time is reached, then updates the next sweep deadline from remaining active windows.
- The in-memory store is per-`ThrottlerGuard` instance and is not shared across clustered workers. Use `RedisThrottlerStore` for cross-instance enforcement.

## Platform status snapshot semantics

Use `createThrottlerPlatformStatusSnapshot(...)` to emit ownership/readiness/health output aligned with the shared platform contract.

- `storeKind` and `operationMode` distinguish local-only, distributed, and fallback operation.
- `readinessCritical` controls readiness impact when the backing store is unavailable:
  - `false` (default): readiness is `degraded` (request traffic can continue).
  - `true`: readiness is `not-ready`.
- `ownership` is derived from `storeOwnershipMode` (`framework` vs `external`).
- `details.telemetry.labels` follows shared label keys (`component_id`, `component_kind`, `operation`, `result`).

Use `createThrottlerPlatformDiagnosticIssues(...)` to emit stable diagnostic issues with package-prefixed code and actionable `fixHint` text.

## Related packages

- `@konekti/http` — provides `Guard`, `GuardContext`, `TooManyRequestsException`
- `@konekti/redis` — Redis client, pass `REDIS_CLIENT` to `RedisThrottlerStore`
