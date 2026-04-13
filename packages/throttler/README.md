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

Register the `ThrottlerModule` and apply the `Throttle` decorator to your controllers or methods.

```typescript
import { Module } from '@fluojs/core';
import { ThrottlerModule, Throttle, SkipThrottle } from '@fluojs/throttler';
import { Controller, Post } from '@fluojs/http';

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

For multi-instance deployments, use `RedisThrottlerStore` to share the rate limit state across all instances.

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

By default, the throttler resolves client identity from `Forwarded`, `X-Forwarded-For`, `X-Real-IP`, and finally the raw socket `remoteAddress`. If none are available, it throws instead of collapsing unrelated callers into a shared bucket. You can customize this to use API keys, user IDs, or other identifiers.

```typescript
ThrottlerModule.forRoot({
  ttl: 60,
  limit: 100,
  keyGenerator: (context) => {
    const request = context.switchToHttp().getRequest();
    return request.headers['x-api-key'] || request.ip;
  },
});
```

## Public API Overview

### Modules
- `ThrottlerModule.forRoot(options)`: Configures the global throttling behavior and storage.

### Decorators
- `@Throttle({ ttl, limit })`: Sets a specific rate limit for a class or method.
- `@SkipThrottle()`: Disables throttling for a class or method.

### Guards
- `ThrottlerGuard`: The guard responsible for enforcing the rate limits. Automatically registered when using `ThrottlerModule.forRoot()`.

### Stores
- `createMemoryThrottlerStore()`: Creates a simple in-memory store (default).
- `RedisThrottlerStore`: Store adapter for Redis.

## Related Packages

- `@fluojs/http`: Required for HTTP context and Exception handling.
- `@fluojs/redis`: Required when using `RedisThrottlerStore`.

## Example Sources

- `packages/throttler/src/module.test.ts`: Tests for module configuration and decorator overrides.
- `packages/throttler/src/guard.ts`: The core logic for request throttling and header management.
