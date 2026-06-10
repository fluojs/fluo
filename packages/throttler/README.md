# @fluojs/throttler

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Decorator-based rate limiting for fluo applications with in-memory and Redis store adapters.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
  - [Redis Storage](#redis-storage)
  - [Custom Key Generation](#custom-key-generation)
- [NestJS Migration Boundaries](#nestjs-migration-boundaries)
- [Public API Overview](#public-api-overview)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @fluojs/throttler
```

## When to Use

- To prevent brute-force attacks on sensitive endpoints (e.g., login, registration).
- To protect your API from being overwhelmed by too many requests from a single client.
- To implement usage quotas or tiered rate limits for different types of users.
- When you need a simple way to apply rate limits using decorators on controllers or methods.

## Quick Start

Register the `ThrottlerModule`, wire `ThrottlerGuard` with `@UseGuards(...)`, and apply the `Throttle` decorator to controllers or methods that need route-specific limits.

```typescript
import { Module } from '@fluojs/core';
import { ThrottlerGuard, ThrottlerModule, Throttle, SkipThrottle } from '@fluojs/throttler';
import { Controller, Post, UseGuards } from '@fluojs/http';

@Module({
  imports: [
    ThrottlerModule.forRoot({
      ttl: 60,   // 60 seconds
      limit: 10, // 10 requests
    }),
  ],
})
class AppModule {}

@Controller('/auth')
@UseGuards(ThrottlerGuard)
class AuthController {
  @Post('/login')
  @Throttle({ ttl: 60, limit: 5 }) // Override: 5 requests per minute
  login() {
    return { success: true };
  }

  @Post('/public-info')
  @SkipThrottle() // Bypass throttling
  getInfo() {
    return { info: '...' };
  }
}
```

## Common Patterns

### Redis Storage

For multi-instance deployments, use `RedisThrottlerStore` to share the rate limit state across all instances. Redis-backed windows are anchored to Redis server time, so distributed app nodes with clock skew still enforce one shared reset boundary.

`RedisThrottlerStore` accepts the package-local structural `RedisThrottlerClient` contract: a Redis command client with an `eval(script, numberOfKeys, ...args)` method. `@fluojs/redis`, `ioredis`, and compatible custom clients can be passed without making the root `@fluojs/throttler` import depend on a concrete `ioredis` constructor type.

```typescript
import { ThrottlerModule, RedisThrottlerStore } from '@fluojs/throttler';
import { REDIS_CLIENT } from '@fluojs/redis';

// Inside a provider or module factory
const redisClient = await container.resolve(REDIS_CLIENT);
const redisStore = new RedisThrottlerStore(redisClient);

ThrottlerModule.forRoot({
  ttl: 60,
  limit: 100,
  store: redisStore,
});
```

You can also pass any object that implements the `ThrottlerStore` contract through the `store` option.

### Custom Key Generation

By default, the throttler resolves client identity from the raw socket `remoteAddress` only. If your deployment sits behind a trusted reverse proxy that rewrites `Forwarded`, `X-Forwarded-For`, or `X-Real-IP`, opt in with `trustProxyHeaders: true`. If no trusted socket or proxy identity is available, it throws instead of collapsing unrelated callers into a shared bucket. You can also customize this to use API keys, user IDs, or other identifiers.

Counters are scoped by route identity and client identity. The route portion includes method, path, version, and handler identity so different handlers do not share buckets accidentally. When a request is rejected, `ThrottlerGuard` returns `429` and sets `Retry-After`.

```typescript
ThrottlerModule.forRoot({
  ttl: 60,
  limit: 100,
  trustProxyHeaders: true,
});
```

```typescript
ThrottlerModule.forRoot({
  ttl: 60,
  limit: 100,
  keyGenerator: (context) => {
    const apiKeyHeader = context.request.headers['x-api-key'];
    const apiKey = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader;

    if (!apiKey) {
      throw new Error('Missing API key for throttler tracking.');
    }

    return `api-key:${apiKey}`;
  },
});
```

## NestJS Migration Boundaries

When migrating from `@nestjs/throttler`, treat `@fluojs/throttler` as an explicit guard-stage package rather than a drop-in global limiter:

- `ThrottlerModule.forRoot(...)` registers validated options and providers, but it does not automatically enforce throttling on every route. Activate `ThrottlerGuard` with Fluo guard metadata such as `@UseGuards(ThrottlerGuard)` wherever enforcement is required.
- The public policy shape is one module default plus class- or method-level `@Throttle({ ttl, limit })` overrides. Named multi-window definitions such as burst plus sustained limits require explicit composition through HTTP middleware, a custom `ThrottlerStore`, or an application-owned guard wrapper.
- Forwarded client IP headers are ignored by default. Enable `trustProxyHeaders: true` only behind a trusted proxy that overwrites `Forwarded`, `X-Forwarded-For`, or `X-Real-IP`.
- The guaranteed limit-exceeded response contract is HTTP `429` with `Retry-After`. Additional rate-limit headers or response bodies should be added at the application boundary, for example with an exception filter.

## Public API Overview

### Modules
- `ThrottlerModule.forRoot(options)`: Provides validated throttler options and `ThrottlerGuard` to the module graph.
- Package-level registration is supported through `ThrottlerModule.forRoot(options)`. Internal provider-composition helpers and DI tokens are not part of the public contract.

`ttl` and `limit` must be positive finite integers. `global` defaults to `true`; set `global: false` when the throttler providers should stay scoped to the importing module. `trustProxyHeaders` and `keyGenerator` customize client identity. Module options are validated and captured by value when the guard is wired so later mutation of the caller's options object does not change live throttling policy. If no `store` option is supplied, each `ThrottlerGuard` instance owns its own in-memory store; pass a `ThrottlerStore` implementation such as `RedisThrottlerStore` when storage must be shared or externally managed.

### Decorators
- `@Throttle({ ttl, limit })`: Sets a specific rate limit for a class or method.
- `@SkipThrottle()`: Disables throttling for a class or method.
- `ThrottlerHandlerOptions`: Public `{ ttl, limit }` policy shape accepted by `@Throttle(...)`. Both values must be positive finite integers; method-level policies override class-level policies, which override module defaults.
- Existing root-barrel metadata helpers (`throttleRouteMetadataKey`, `getThrottleMetadata`, `getSkipThrottleMetadata`, `getClassThrottleMetadata`, and `getClassSkipThrottleMetadata`) remain exported for compatibility with advanced integrations that already inspect decorator metadata directly.

### Guards
- `ThrottlerGuard`: The guard responsible for enforcing rate limits. `ThrottlerModule.forRoot()` makes it injectable; route handlers still activate it through Fluo guard metadata such as `@UseGuards(ThrottlerGuard)`.

### Stores
- `createMemoryThrottlerStore()`: Creates a simple in-memory store (default).
- `RedisThrottlerStore`: Store adapter for Redis.
- `RedisThrottlerClient`: Structural Redis command client contract accepted by `RedisThrottlerStore`.
- `ThrottlerStore`: Public contract for custom stores.
- `ThrottlerConsumeInput`: Public input shape passed to `ThrottlerStore.consume(key, input)` so custom stores can share the guard's current time and TTL window.
- `ThrottlerStoreEntry`: Public result shape returned by `ThrottlerStore.consume(...)`; `count` is the post-consume request count for the active window and `resetAt` is the epoch-millisecond reset boundary used for `Retry-After` calculation.

### Status and diagnostics
- `createThrottlerPlatformStatusSnapshot(...)`: Creates a platform status snapshot.
- `createThrottlerPlatformDiagnosticIssues(...)`: Creates diagnostic issues for invalid throttler state.
- `ThrottlerStatusAdapterInput`: Public input shape for status and diagnostic helpers. It carries store kind, ownership mode, operation mode, backing-store readiness, dependency linkage, and readiness criticality hints collected during bootstrap.
- `ThrottlerPlatformStatusSnapshot`: Public output shape returned by `createThrottlerPlatformStatusSnapshot(...)`, containing readiness, health, ownership, and details sections compatible with runtime platform snapshots.
- `ThrottlerStoreKind`: Store categories recognized by the status adapter: `memory`, `redis`, or `custom`.
- `ThrottlerStoreOwnershipMode`: Ownership modes reported in status snapshots: `framework` for guard-owned resources or `external` for externally managed stores.
- `ThrottlerOperationMode`: Operation modes reported in status details: `local-only`, `distributed`, `local-fallback`, or `custom`.

Method-level `@Throttle(...)` overrides class-level settings, class-level settings override module defaults, and `@SkipThrottle()` bypasses throttling at either class or method level.

## Related Packages

- `@fluojs/http`: Required for HTTP context and Exception handling.
- `@fluojs/redis`: Official Redis client integration for `RedisThrottlerStore`; `ioredis` and compatible structural clients are also supported.

## Example Sources

- `packages/throttler/src/module.test.ts`: Tests for module configuration, decorator overrides, and HTTP guard integration through `createTestApp(...)`.
- `packages/throttler/src/guard.ts`: The core logic for request throttling and header management.
- `packages/throttler/src/redis-store.test.ts`: Redis store contract and server-time behavior.
- `packages/throttler/src/status.test.ts`: Status and diagnostic helper behavior.
