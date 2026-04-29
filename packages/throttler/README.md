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

```typescript
import { ThrottlerModule, RedisThrottlerStore } from '@fluojs/throttler';
import { REDIS_CLIENT } from '@fluojs/redis';

// Inside a provider or module factory
const redisStore = new RedisThrottlerStore(redisClient);

ThrottlerModule.forRoot({
  ttl: 60,
  limit: 100,
  store: redisStore,
});
```

### Custom Key Generation

By default, the throttler resolves client identity from the raw socket `remoteAddress` only. If your deployment sits behind a trusted reverse proxy that rewrites `Forwarded`, `X-Forwarded-For`, or `X-Real-IP`, opt in with `trustProxyHeaders: true`. If no trusted socket or proxy identity is available, it throws instead of collapsing unrelated callers into a shared bucket. You can also customize this to use API keys, user IDs, or other identifiers.

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

## Public API Overview

### Modules
- `ThrottlerModule.forRoot(options)`: Provides throttler options, storage, and `ThrottlerGuard` to the module graph.
- Package-level registration is supported through `ThrottlerModule.forRoot(options)`. Internal provider-composition helpers are not part of the public contract.

### Decorators
- `@Throttle({ ttl, limit })`: Sets a specific rate limit for a class or method.
- `@SkipThrottle()`: Disables throttling for a class or method.

### Guards
- `ThrottlerGuard`: The guard responsible for enforcing rate limits. `ThrottlerModule.forRoot()` makes it injectable; route handlers still activate it through Fluo guard metadata such as `@UseGuards(ThrottlerGuard)`.

### Stores
- `createMemoryThrottlerStore()`: Creates a simple in-memory store (default).
- `RedisThrottlerStore`: Store adapter for Redis.

## Related Packages

- `@fluojs/http`: Required for HTTP context and Exception handling.
- `@fluojs/redis`: Required when using `RedisThrottlerStore`.

## Example Sources

- `packages/throttler/src/module.test.ts`: Tests for module configuration and decorator overrides.
- `packages/throttler/src/guard.ts`: The core logic for request throttling and header management.
